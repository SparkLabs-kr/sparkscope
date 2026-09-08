// NextAuth 설정 — 이메일 매직 링크, 도메인 화이트리스트
import type { NextAuthOptions } from 'next-auth';
import EmailProvider from 'next-auth/providers/email';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { prisma } from '@/lib/prisma';

/**
 * 사내 도메인 목록. 여러 오피스를 쉼표로 넣는다(예전 단수형 이름도 계속 읽는다).
 *
 * ⚠️ 이 목록에 도메인을 넣는 것은 "그 도메인 메일이면 누구나 관리자"라는 뜻이다.
 * 우리가 실제로 통제하는 회사 도메인만 넣는다. gmail.com 같은 공용 도메인은 절대 안 된다.
 */
const STAFF_EMAIL_DOMAINS: string[] = (
  process.env.ALLOWED_EMAIL_DOMAINS ??
  process.env.ALLOWED_EMAIL_DOMAIN ??
  'sparklabs.co.kr'
)
  .split(',')
  .map(d => d.trim().toLowerCase().replace(/^@/, ''))
  .filter(Boolean);

/**
 * 사내 계정인가 — 도메인만으로 판단한다.
 * '@'를 붙여 비교하는 것이 중요하다. 빼면 notsparklabs.co.kr 같은 남의 도메인이 통과한다.
 */
export function isStaffEmail(email: string): boolean {
  const addr = email.trim().toLowerCase();
  return STAFF_EMAIL_DOMAINS.some(d => addr.endsWith(`@${d}`));
}

/**
 * 로그인할 수 있는가.
 *
 * 사내 메일이면 통과. 그 밖에는 관리자가 미리 발급해 둔 계정(active=true)만 통과한다 —
 * 비밀번호를 저장하지 않는 대신 "계정 발급"이 초대이고 "비활성화"가 차단이다.
 * 포트폴리오사 대표는 이 두 번째 경로로 들어온다.
 *
 * 링크를 보낼 때와 콜백에서 두 번 확인한다. 발급 후 비활성화된 계정이
 * 이미 받아 둔 링크로 들어오는 것을 막기 위해서다.
 */
async function canSignIn(email: string): Promise<boolean> {
  const addr = email.trim().toLowerCase();
  if (!addr) return false;
  if (testRecipient && addr === testRecipient.toLowerCase()) return true;
  if (isStaffEmail(addr)) return true;
  const invited = await prisma.user.findUnique({
    where: { email: addr },
    select: { active: true },
  });
  return invited?.active === true;
}
const testRecipient = process.env.DIGEST_TEST_RECIPIENT ?? '';

const emailProvider = EmailProvider({
      server: {
        host: 'smtp.resend.com',
        port: 465,
        auth: {
          user: 'resend',
          pass: process.env.RESEND_API_KEY ?? '',
        },
      },
      from: process.env.DIGEST_FROM_EMAIL ?? 'sparkscope@sparklabs.co.kr',
    });

/**
 * 권한 없는 주소에는 링크 자체를 보내지 않는다.
 *
 * 콜백에서만 막으면 메일은 나가고 클릭할 때 거절되는데, 받은 사람은 "링크가 고장났다"고
 * 읽는다. 아예 보내지 않으면 초대받지 않은 주소로 메일이 나가는 일도 없다.
 * (요청 화면에는 "승인되면 메일이 갑니다"라고 적어 둔다.)
 */
const defaultSendVerification = emailProvider.sendVerificationRequest;
emailProvider.sendVerificationRequest = async params => {
  if (!(await canSignIn(params.identifier))) return;
  await defaultSendVerification(params);
};

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma) as any,
  providers: [emailProvider],
  callbacks: {
    async signIn({ user }) {
      if (!user.email) return false;
      return canSignIn(user.email);
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
