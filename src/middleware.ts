// /dashboard/* 보호. NextAuth가 미인증 사용자를 /login으로 리다이렉트
// 단, 로컬 개발 중 DEV_AUTH_BYPASS=true 이면 로그인 검사를 건너뜀.
// (이 변수는 .env.local 에만 있고 Vercel 배포에는 없으므로 실서비스는 영향 없음)
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import authMiddleware from 'next-auth/middleware';

export default function middleware(req: NextRequest, ev: any) {
  if (process.env.DEV_AUTH_BYPASS === 'true') return NextResponse.next();
  return (authMiddleware as any)(req, ev);
}

export const config = {
  matcher: ['/dashboard/:path*'],
};
