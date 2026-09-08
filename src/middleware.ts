// 화면(/dashboard·/digest·/chat)과 API(/api/*) 보호. NextAuth가 미인증 사용자를 막는다.
// 단, OPEN_ACCESS(로컬 개발 우회)면 검사를 건너뜀. (src/lib/flags.ts)
//
// 2026-09-08: matcher에 /api를 추가했다.
//   그전에는 화면만 막고 API는 통째로 열려 있었다. 실측하면 미인증 요청에
//   /api/inter 가 264KB를 돌려줬고, 그 안에 포트폴리오사 매칭(어느 회사가 어떤
//   해외 트렌드에 연결됐는지)이 그대로 들어 있었다. /api/digest/preview는
//   그날의 다이제스트 본문 전체를 줬다.
//
//   라우트마다 가드를 하나씩 붙이는 대신 여기 한 곳에서 막는다 — 라우트는 계속
//   늘어나는데, 새로 만들 때 가드를 빠뜨리면 그대로 구멍이 되기 때문이다.
//   막는 것이 기본이고, 열어야 하는 것만 아래에 명시한다.
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import authMiddleware from 'next-auth/middleware';
import { OPEN_ACCESS } from '@/lib/flags';

/**
 * 로그인 없이 열려 있어야 하는 API.
 *  · /api/auth/*  — 로그인 자체를 처리한다. 막으면 아무도 못 들어온다.
 *  · /api/cron/*  — Vercel Cron·GitHub Actions가 세션 없이 부른다.
 *                   대신 각 라우트가 CRON_SECRET 헤더를 직접 검사한다(전 라우트 확인함).
 */
const PUBLIC_API = ['/api/auth', '/api/cron'];

export default function middleware(req: NextRequest, ev: any) {
  if (OPEN_ACCESS) return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (PUBLIC_API.some(p => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  return (authMiddleware as any)(req, ev);
}

export const config = {
  matcher: ['/dashboard/:path*', '/digest/:path*', '/chat/:path*', '/api/:path*'],
};
