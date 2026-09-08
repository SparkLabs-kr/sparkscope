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

export type SessionUser = { id: string; email: string; name: string | null };

/** 로그인한 사용자, 없으면 null. 화면이 "로그인하세요"를 직접 그릴 때 쓴다. */
export async function getSessionUser(): Promise<SessionUser | null> {
  // 개발용 우회는 여기 한 곳에서만 본다. 이걸 빼먹으면 화면은 열려 있는데
  // 화면이 부르는 API만 401을 내서, 둘 중 하나만 막힌 것보다 나쁜 상태가 된다
  // (실제로 그렇게 만들었다가 잡았다 — 2026-09-08).
  if (OPEN_ACCESS) {
    // main의 flags.ts에는 DEV_AUTH_EMAIL이 없다 — 환경변수를 직접 본다.
    return { id: 'dev', email: process.env.DEV_AUTH_EMAIL ?? 'dev@sparklabs.co.kr', name: 'dev' };
  }

  const session = await getServerSession(authOptions);
  const u = session?.user as { id?: string; email?: string | null; name?: string | null } | undefined;
  if (!u?.email) return null;
  return { id: u.id ?? '', email: u.email, name: u.name ?? null };
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
