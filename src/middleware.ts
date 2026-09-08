// /dashboard/* · /api/* 보호 — 미인증 사용자를 /login(화면) 또는 401(API)로 돌려보낸다.
// 단, OPEN_ACCESS(로컬 개발 우회)면 검사를 건너뜀. (src/lib/flags.ts)
//
// ⚠️ 여기서 next-auth/middleware(withAuth)를 쓰면 안 된다.
//
//    withAuth는 쿠키를 JWT로 보고 해독하는데, 이 앱은 session.strategy가 'database'라
//    쿠키에 JWT가 아니라 불투명한 세션 ID가 들어 있다. 그래서 로그인에 성공한 사용자도
//    해독에 실패해 미인증으로 판단되고, 메일 링크 → 콜백 → 다시 로그인 화면으로 되돌아온다.
//
//    실제로 그 일이 있었다(2026-09-02): 로그인은 성공해 Session 행이 4개나 생겼는데
//    화면은 계속 로그인으로 돌아갔고, 결국 게이트를 되돌려(a53d464) 대시보드를 다시
//    열어 둔 상태로 지냈다. 원 수정은 maxnambranch 69adb6a에 있었지만 main에 오지 않았다.
//
//    Edge 런타임에서는 Prisma를 못 쓰므로 여기서 세션을 DB로 확인할 수도 없다.
//    그래서 이 파일이 하는 일은 "세션 쿠키가 있는가"까지다 — 익명 사용자를 빨리
//    돌려보내기 위한 첫 겹일 뿐 보안 경계가 아니다. 위조·만료된 쿠키는 여기를 통과한다.
//    실제 판단은 nodejs 런타임에서 authz.ts의 requireUser()가 DB를 보고 한다.
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { OPEN_ACCESS } from '@/lib/flags';

/**
 * 로그인 없이 열려 있어야 하는 API.
 *  · /api/auth/*  — 로그인 자체를 처리한다. 막으면 아무도 못 들어온다.
 *  · /api/cron/*  — Vercel Cron·GitHub Actions가 세션 없이 부른다.
 *                   대신 각 라우트가 CRON_SECRET 헤더를 직접 검사한다.
 *  · /api/partner/* — 파트너 사이트(블루사이트)가 세션 없이 부른다.
 *                   대신 라우트가 PARTNER_API_KEY를 직접 검사한다. 키가 설정돼 있지
 *                   않으면 503으로 닫힌다 — 빈 값끼리 맞아 열리는 일이 없게.
 */
const PUBLIC_API = ['/api/auth', '/api/cron', '/api/partner'];

/**
 * 로그인 없이 부를 수 있는 정확한 경로. 접두사가 아니라 완전 일치다 —
 * '/api/access-request' 를 PUBLIC_API 에 넣으면 하위의
 * '/api/access-request/decide'(승인 API)까지 같이 열려 버린다.
 */
const PUBLIC_API_EXACT = ['/api/access-request'];

const SESSION_COOKIES = ['next-auth.session-token', '__Secure-next-auth.session-token'];

export default function middleware(req: NextRequest) {
  if (OPEN_ACCESS) return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (PUBLIC_API.some(p => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }
  if (PUBLIC_API_EXACT.includes(pathname)) return NextResponse.next();

  if (SESSION_COOKIES.some(name => req.cookies.has(name))) return NextResponse.next();

  // API는 리다이렉트가 아니라 401을 준다 — fetch가 로그인 HTML을 JSON으로 파싱하려다
  // 엉뚱한 오류를 내는 것보다 상태 코드로 말하는 편이 낫다.
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // 로그인 후 원래 가려던 곳으로 돌아올 수 있게 callbackUrl을 붙인다.
  const login = new URL('/login', req.url);
  login.searchParams.set('callbackUrl', req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ['/dashboard/:path*', '/digest/:path*', '/chat/:path*', '/api/:path*'],
};
