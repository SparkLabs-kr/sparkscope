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
  },
  session: { strategy: 'database' },
};
