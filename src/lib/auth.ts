// NextAuth 설정 — 이메일 매직 링크, 도메인 화이트리스트
import type { NextAuthOptions } from 'next-auth';
import EmailProvider from 'next-auth/providers/email';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { prisma } from '@/lib/prisma';

const allowedDomain = process.env.ALLOWED_EMAIL_DOMAIN ?? 'sparklabs.co.kr';
const testRecipient = process.env.DIGEST_TEST_RECIPIENT ?? '';

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma) as any,
  providers: [
    EmailProvider({
      server: {
        host: 'smtp.resend.com',
        port: 465,
        auth: {
          user: 'resend',
          pass: process.env.RESEND_API_KEY ?? '',
        },
      },
      from: process.env.DIGEST_FROM_EMAIL ?? 'sparkscope@sparklabs.co.kr',
    }),
  ],
  callbacks: {
    async signIn({ user }) {
      if (!user.email) return false;
      // 시범 운영 단계에서 본인 메일도 허용
      if (user.email === testRecipient) return true;
      return user.email.toLowerCase().endsWith(`@${allowedDomain.toLowerCase()}`);
    },
    async session({ session, user }) {
      if (session.user) (session.user as any).id = user.id;
      return session;
    },
  },
  pages: {
    signIn: '/login',
    verifyRequest: '/login?check=email',
    // 에러도 우리 화면에서 받는다. 지정하지 않으면 NextAuth 기본 에러 페이지가
    // 403으로 뜨는데, 영어 일반 문구뿐이라 "링크를 이미 썼다"인지 "계정이 없다"인지
    // 알 수 없다. 매직 링크는 한 번 쓰면 소진되므로 이 화면을 제일 자주 만난다.
    error: '/login',
  },
  session: { strategy: 'database' },
};
