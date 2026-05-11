// /dashboard/* 보호. NextAuth가 미인증 사용자를 /login으로 리다이렉트
export { default } from 'next-auth/middleware';

export const config = {
  matcher: ['/dashboard/:path*'],
};
