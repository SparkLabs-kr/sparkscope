// /dashboard/* 보호. NextAuth가 미인증 사용자를 /login으로 리다이렉트
// 단, OPEN_ACCESS(협업 개발 단계)면 로그인 검사를 건너뜀. (src/lib/flags.ts)
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import authMiddleware from 'next-auth/middleware';
import { OPEN_ACCESS } from '@/lib/flags';

export default function middleware(req: NextRequest, ev: any) {
  if (OPEN_ACCESS) return NextResponse.next();
  return (authMiddleware as any)(req, ev);
}

export const config = {
  matcher: ['/dashboard/:path*', '/digest/:path*'],
};
