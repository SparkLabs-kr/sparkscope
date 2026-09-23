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
import { resolveRole, isInternal, type Role } from '@/lib/roles';

export type { Role };

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
  //
  // DEV_AUTH_ROLE 로 등급을 골라 볼 수 있다(기본 ADMIN). 등급마다 화면이 달라진 뒤로
  // 이게 없으면 임직원·포트폴리오사 화면을 로컬에서 확인할 방법이 아예 없다 —
  // 포트폴리오사 화면을 보려면 DEV_AUTH_COMPANY_ID 에 MonitoringTarget.id 도 넣는다.
  // OPEN_ACCESS 는 프로덕션 빌드에서 어떤 환경변수로도 켜지지 않는다(flags.ts 참고).
  if (OPEN_ACCESS) {
    const devRole = (process.env.DEV_AUTH_ROLE ?? 'ADMIN').toUpperCase();
    const role: Role =
      devRole === 'PORTFOLIO' ? 'PORTFOLIO' : devRole === 'STAFF' ? 'STAFF' : 'ADMIN';
    const companyId = role === 'PORTFOLIO' ? process.env.DEV_AUTH_COMPANY_ID ?? null : null;
    const company = companyId
      ? await prisma.monitoringTarget
          .findUnique({ where: { id: companyId }, select: { name: true } })
          .catch(() => null)
      : null;
    return {
      id: 'dev',
      email: process.env.DEV_AUTH_EMAIL ?? 'dev@sparklabs.co.kr',
      name: 'dev',
      role,
      companyId,
      companyName: company?.name ?? null,
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

  // 등급 판정은 roles.ts 한 곳에서 한다.
  //
  // 2026-09-22 이전에는 여기서 "사내 도메인 = ADMIN"으로 덮어쓰고 DB 행까지 ADMIN 으로
  // 고쳐 버렸다. 그래서 인턴을 포함한 모든 사내 계정이 관리자였고, 그 흔적이 User.role 에
  // 그대로 남아 있다. 이제 관리자 명단은 ADMIN_EMAILS 이고 DB 의 role 은 보지 않는다 —
  // 옛 데이터를 마이그레이션하지 않아도 명단에 없는 사내 계정은 STAFF 로 내려온다.
  const role = resolveRole(row.email, row.role);

  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role,
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
 * 사내 사람만(ADMIN·STAFF). 전사 데이터를 다루지만 관리 기능은 아닌 곳에 쓴다 —
 * 북마크, 시너지 피드백, 다이제스트 미리보기, 키워드 조회 같은 것들.
 *
 * requireAdmin 과 나눠 쓰는 것이 이 설계의 핵심이다. 전부 requireAdmin 으로 막으면
 * 임직원이 북마크조차 못 하고, 전부 requireUser 로 열면 포트폴리오사 대표가
 * 우리 내부 판단을 건드린다.
 */
export async function requireInternal(): Promise<
  { ok: true; user: SessionUser } | { ok: false; response: Response }
> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  if (!isInternal(auth.user.role)) {
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
  // 사내 계정(ADMIN·STAFF)은 전사 열람이다 — STAFF 를 여기서 막으면 임직원이
  // 대시보드에서 아무 회사도 못 보게 된다. 등급 차이는 "쓰기"에서만 난다.
  if (isInternal(user.role)) return { company: requested, locked: false };
  // 회사가 연결되지 않은 포트폴리오사 계정은 아무것도 못 보게 한다(빈 문자열이 아니라
  // 존재할 수 없는 값을 넣어, 실수로 전체 조회가 되는 것을 막는다).
  //
  // ⚠️ 잠금을 푸는 것(포트폴리오사도 기사 전체를 보게 하는 안)은 아직 적용하지 않았다.
  //    푸는 순간 ourTake·riskFlag 같은 내부 판단이 같이 나가므로, sanitizeForRole() 을
  //    포트폴리오사가 읽는 모든 경로에 먼저 붙여야 한다. 그 작업은 /portfolio 화면
  //    개편과 함께 한다 — 여기만 고치고 끝내면 가장 나쁜 조합이 된다.
  return { company: user.companyName ?? '__no_company__', locked: true };
}

/**
 * 포트폴리오사에게 가려야 하는 컬럼들 — 우리가 "판단한" 것.
 *
 * 경계는 "어느 회사 기사냐"가 아니라 "기사냐, 우리 판단이냐"다. 제목·매체·링크·발행일은
 * 이미 인터넷에 공개돼 있어 가릴 이유가 없고, 가려야 하는 것은 그 기사를 보고 우리가
 * 적어 둔 관점이다. 파트너사(블루사이트)에 DB 를 열 때 이미 같은 기준을 쓰고 있다 —
 * CLAUDE.md 의 "포트폴리오사 매칭·내부 분석은 창업자 관련 비공개 정보" 규칙과 같은 목록이다.
 *
 * 자기 회사 기사라고 예외를 두지 않는다. 대표에게 우리 위험 판단을 보여 주는 것이
 * 남의 회사 것을 보여 주는 것보다 오히려 곤란하다.
 */
const INTERNAL_ONLY_FIELDS = [
  // CLAUDE.md 가 파트너 공개 뷰에 넣지 말라고 못 박은 네 가지. 같은 기준을 화면에도 쓴다.
  'ourTake',
  'riskFlag',
  'relatedCompanies',
  'pitchScore',
  'pitchTopic',
  'pitchTopicEn',
  // 화면에 뜨지는 않지만 서버가 클라이언트로 내려보내는 값들 — 내부 랭킹·운영 흔적이다.
  'priorityScore',
  'noiseReason',
  'scrappedBy',
] as const;

/**
 * ⚠️ importance 와 tone 은 일부러 넣지 않았다.
 *
 * 둘은 "그 기사가 어떤 기사인가"(중요도·논조)이지 "그 회사를 어떻게 볼 것인가"가 아니다.
 * CLAUDE.md 의 파트너 공개 규칙도 이 둘은 제외하지 않는다. 무엇보다 포트폴리오사 화면은
 * 논조 통계(긍정/부정)가 본문의 절반이라, 여기에 넣으면 그 화면이 통째로 비어 버린다.
 * 가려야 하는 것은 우리가 내린 판단(riskFlag·pitchScore·ourTake)이지 기사의 성격이 아니다.
 */

/**
 * 이 등급이 봐도 되는 형태로 기사를 깎는다.
 *
 * select 로 컬럼을 빼는 대신 조회 후에 지우는 이유: 화면·API 마다 select 목록이 제각각이라
 * 한 곳을 고쳐도 다른 곳이 그대로 남는다. 나가는 길목 하나에서 지우면 빠뜨릴 수 없다.
 * 사내 계정은 원본을 그대로 받는다.
 */
export function sanitizeForRole<T extends Record<string, any>>(rows: T[], role: Role): T[] {
  if (isInternal(role)) return rows;
  return rows.map(row => {
    const copy: Record<string, any> = { ...row };
    for (const f of INTERNAL_ONLY_FIELDS) delete copy[f];
    return copy as T;
  });
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
