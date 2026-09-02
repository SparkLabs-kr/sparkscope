// 로그인 게이트 — 미인증 사용자를 /login으로 보낸다.
//
// 여기서 하는 일은 "로그인했는가"까지다. 역할(ADMIN/PORTFOLIO) 판단은 하지 않는다 —
// 세션 전략이 database라서 role을 알려면 DB를 봐야 하고, Edge 런타임에서는 Prisma를
// 쓸 수 없다. 그래서 역할 검사는 서버 컴포넌트·API 라우트(nodejs 런타임)에서
// src/lib/authz.ts의 requireAdmin()/adminOrNull()로 한다.
//
// 즉 이 파일은 방어선의 첫 겹일 뿐이고, 관리자 전용 화면의 실제 차단은 각 화면에 있다.
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import authMiddleware from 'next-auth/middleware';
import { OPEN_ACCESS } from '@/lib/flags';

export default function middleware(req: NextRequest, ev: any) {
  // 로컬 개발용 우회(.env.local의 DEV_AUTH_BYPASS=true). 배포 환경에서는 켜지 않는다.
  if (OPEN_ACCESS) return NextResponse.next();
  return (authMiddleware as any)(req, ev);
}

export const config = {
  matcher: ['/dashboard/:path*', '/digest/:path*', '/chat/:path*'],
};
