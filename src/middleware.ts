// 로그인 게이트 — 세션 쿠키가 아예 없는 요청만 /login으로 돌려보낸다.
//
// ⚠️ 여기서 next-auth/middleware(withAuth)를 쓰면 안 된다.
//    withAuth는 쿠키를 JWT로 보고 해독하는데, 이 앱은 session.strategy가 'database'라
//    쿠키에 JWT가 아니라 불투명한 세션 ID가 들어 있다. 그래서 withAuth는 로그인에
//    성공한 사용자도 해독에 실패해 미인증으로 판단하고, 로그인 → 콜백 → 다시 로그인으로
//    무한히 되돌린다. (OPEN_ACCESS가 켜져 있던 동안에는 이 줄까지 오지 않아 드러나지 않았다.)
//
//    Edge 런타임에서는 Prisma를 쓸 수 없어 세션을 DB로 확인할 수도 없다.
//
// 그래서 이 파일이 하는 일은 "쿠키가 있는가"까지다. 쿠키가 위조됐거나 만료됐거나
// 계정이 해지된 경우는 통과시키고, 실제 판단은 서버 컴포넌트·API 라우트(nodejs 런타임)의
// src/lib/authz.ts — requireUser() / requireAdmin() / adminOrNull() — 가 DB를 보고 한다.
// 즉 여기는 익명 사용자를 빨리 돌려보내기 위한 첫 겹일 뿐, 보안 경계가 아니다.
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { OPEN_ACCESS } from '@/lib/flags';

// NextAuth 세션 쿠키 이름. https 환경에서는 __Secure- 접두사가 붙는다.
const SESSION_COOKIES = ['next-auth.session-token', '__Secure-next-auth.session-token'];

export default function middleware(req: NextRequest) {
  // 로컬 개발용 우회(.env.local의 DEV_AUTH_BYPASS=true). 배포 환경에서는 켜지 않는다.
  if (OPEN_ACCESS) return NextResponse.next();

  const hasSession = SESSION_COOKIES.some(name => req.cookies.has(name));
  if (hasSession) return NextResponse.next();

  // 로그인 후 원래 가려던 곳으로 돌아올 수 있게 callbackUrl을 붙인다.
  const login = new URL('/login', req.url);
  login.searchParams.set('callbackUrl', req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ['/dashboard/:path*', '/digest/:path*', '/chat/:path*'],
};
