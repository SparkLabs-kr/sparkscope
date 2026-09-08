/**
 * 세션 확인 — 실제 보안 경계는 여기다.
 *
 * middleware는 Edge 런타임이라 Prisma를 못 쓴다. 그래서 거기서는 "세션 쿠키가
 * 있는가"까지만 보고, 위조·만료된 쿠키도 통과시킨다. 진짜 판단은 nodejs 런타임에서
 * 도는 이 파일이 한다 — getServerSession이 DB의 Session 행을 실제로 조회한다.
 *
 * 2026-09-08 이전에는 이 층이 아예 없었다. middleware가 next-auth/middleware(withAuth)를
 * 쓰고 있었는데, session.strategy가 'database'라 withAuth가 쿠키를 해독하지 못해
 * 로그인한 사용자도 로그인 화면으로 되돌려 보냈다. 그 동안 API 라우트에는 세션 검사가
 * 한 줄도 없었으므로, middleware를 쿠키 검사로 바꾸는 것만으로는 보호가 얇아진다.
 */
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { OPEN_ACCESS } from '@/lib/flags';
import { prisma } from '@/lib/prisma';
import { isStaffEmail } from '@/lib/auth';

export type Role = 'ADMIN' | 'PORTFOLIO';

export type SessionUser = {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  /** PORTFOLIO 계정이 소속된 회사 — MonitoringTarget.id */
  companyId: string | null;
  /** 화면·조회에 쓰는 회사명. companyId로 조인해 채운다. */
  companyName: string | null;
  active: boolean;
};

/** 로그인한 사용자, 없으면 null. 화면이 "로그인하세요"를 직접 그릴 때 쓴다. */
export async function getSessionUser(): Promise<SessionUser | null> {
  // 개발용 우회는 여기 한 곳에서만 본다. 이걸 빼먹으면 화면은 열려 있는데
  // 화면이 부르는 API만 401을 내서, 둘 중 하나만 막힌 것보다 나쁜 상태가 된다.
  if (OPEN_ACCESS) {
    return {
      id: 'dev',
      email: process.env.DEV_AUTH_EMAIL ?? 'dev@sparklabs.co.kr',
      name: 'dev',
      role: 'ADMIN',
      companyId: null,
      companyName: null,
      active: true,
    };
  }

  const session = await getServerSession(authOptions);
  const u = session?.user as { id?: string; email?: string | null } | undefined;
  if (!u?.email || !u.id) return null;

  const row = await prisma.user.findUnique({
    where: { id: u.id },
    select: {
      id: true, email: true, name: true, role: true, active: true, companyId: true,
      company: { select: { name: true } },
    },
  });
  if (!row) return null;

  // 비활성화된 계정은 세션이 남아 있어도 통과시키지 않는다 — 발급 취소가 즉시 먹어야 한다.
  if (!row.active) return null;

  // 사내 도메인 메일은 role 값과 무관하게 관리자로 본다.
  //
  // 마이그레이션이 role 기본값을 PORTFOLIO(최소 권한)로 넣기 때문에, 이 보정이 없으면
  // 기존 사내 계정이 전부 포트폴리오사로 강등된다. 여기서 행도 함께 고쳐 두면
  // 다음 로그인부터는 보정이 필요 없다.
  const staff = isStaffEmail(row.email);
  if (staff && row.role !== 'ADMIN') {
    await prisma.user.update({ where: { id: row.id }, data: { role: 'ADMIN' } }).catch(() => {});
  }

  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: staff ? 'ADMIN' : (row.role === 'ADMIN' ? 'ADMIN' : 'PORTFOLIO'),
    companyId: row.companyId,
    companyName: row.company?.name ?? null,
    active: true,
  };
}

/** 관리자만. 계정 발급·승인 같은 화면과 API에서 쓴다. */
export async function requireAdmin(): Promise<
  { ok: true; user: SessionUser } | { ok: false; response: Response }
> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  if (auth.user.role !== 'ADMIN') {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: 'forbidden' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      }),
    };
  }
  return { ok: true, user: auth.user };
}

/**
 * 이 사용자가 실제로 볼 수 있는 회사.
 *
 * 이게 이 파일의 핵심이다. 포트폴리오사 계정은 요청에 어떤 회사를 넣든 자기 회사로
 * 고정된다(locked). 이 함수를 거치지 않고 요청값을 그대로 쓰면 대표가 다른
 * 포트폴리오사 411곳의 보도와 내부 매칭까지 보게 된다.
 */
export function effectiveCompany(
  user: SessionUser,
  requested: string | undefined,
): { company: string | undefined; locked: boolean } {
  if (user.role === 'ADMIN') return { company: requested, locked: false };
  // 회사가 연결되지 않은 포트폴리오사 계정은 아무것도 못 보게 한다(빈 문자열이 아니라
  // 존재할 수 없는 값을 넣어, 실수로 전체 조회가 되는 것을 막는다).
  return { company: user.companyName ?? '__no_company__', locked: true };
}

/**
 * 로그인 필수. API 라우트에서 쓴다.
 * 통과하면 사용자를, 아니면 401 Response를 돌려준다 — throw하지 않는 건
 * 라우트마다 try/catch를 강요하지 않으려는 것이다.
 */
export async function requireUser(): Promise<
  { ok: true; user: SessionUser } | { ok: false; response: Response }
> {
  const user = await getSessionUser();
  if (user) return { ok: true, user };
  return {
    ok: false,
    response: new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    }),
  };
}
