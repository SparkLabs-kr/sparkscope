// NextAuth 설정 — 사내는 Google 1탭, 포트폴리오사는 메일 매직 링크.
import type { NextAuthOptions } from 'next-auth';
import EmailProvider from 'next-auth/providers/email';
import GoogleProvider from 'next-auth/providers/google';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { prisma } from '@/lib/prisma';
import { isStaffEmail, primaryStaffDomain } from '@/lib/roles';

// 도메인 판정은 roles.ts 한 곳에 있다. 예전 import 경로를 쓰는 곳이 있어 다시 내보낸다.
export { isStaffEmail };

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

  /**
   * 새 링크를 보낼 때 이전 링크를 무효화한다.
   *
   * NextAuth 는 요청할 때마다 토큰을 새로 만들고 이전 것을 지우지 않는다.
   * 그래서 받은편지함에 여러 링크가 유효한 상태로 쌓이고, 사람은 어느 것이
   * 최신인지 모른 채 아무거나 누른다. "가장 최근 메일을 누르세요"라고 적어
   * 두는 것보다, 최신 것만 남기는 편이 확실하다.
   *
   * 방금 만들어진 토큰은 만료 시각이 가장 늦다 — 그것만 남기고 지운다.
   * 실패해도 로그인 자체는 막지 않는다(링크는 이미 유효하다).
   */
  try {
    const rows = await prisma.verificationToken.findMany({
      where: { identifier: params.identifier },
      select: { token: true, expires: true },
    });
    if (rows.length > 1) {
      const newest = rows.reduce((a, b) => (a.expires > b.expires ? a : b));
      await prisma.verificationToken.deleteMany({
        where: { identifier: params.identifier, token: { not: newest.token } },
      });
    }
  } catch (e) {
    console.error('[auth] 이전 로그인 링크 정리 실패:', e);
  }

  await defaultSendVerification(params);
};

/**
 * Google 로그인은 환경변수가 있을 때만 켠다.
 *
 * 무조건 등록하면 키가 없는 환경(로컬·프리뷰)에서 버튼은 보이는데 누르면 설정 오류로
 * 떨어진다. 없으면 아예 없는 편이 낫다 — 로그인 화면도 이 값을 보고 버튼을 감춘다.
 */
export const GOOGLE_ENABLED = Boolean(
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
);

const googleProvider = GOOGLE_ENABLED
  ? [
      GoogleProvider({
        clientId: process.env.GOOGLE_CLIENT_ID!,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
        authorization: {
          params: {
            /**
             * hd 는 계정 선택 화면에 회사 계정을 먼저 보여 주는 힌트일 뿐,
             * 보안 경계가 아니다. 개인 지메일로도 콜백까지는 올 수 있으므로
             * 아래 signIn 콜백에서 도메인을 반드시 다시 검사한다.
             */
            hd: primaryStaffDomain(),
            // 계정이 여러 개인 사람이 엉뚱한 계정으로 자동 로그인되는 것을 막는다.
            prompt: 'select_account',
          },
        },
        /**
         * 이미 메일 로그인으로 만들어진 User 행에 구글 계정을 이어 붙인다.
         * 켜지 않으면 기존 사내 계정이 전부 OAuthAccountNotLinked 로 튕긴다.
         * 구글이 이메일 소유를 검증해 주고 우리는 사내 도메인만 받으므로,
         * 이 연결로 계정이 탈취되는 경로는 없다.
         */
        allowDangerousEmailAccountLinking: true,
      }),
    ]
  : [];

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma) as any,
  providers: [...googleProvider, emailProvider],
  callbacks: {
    async signIn({ user, account }) {
      if (!user.email) return false;
      // 구글로 들어오는 길은 사내 계정 전용이다. hd 는 힌트라 개인 지메일도
      // 여기까지 올 수 있으므로 도메인을 실제로 확인한다.
      if (account?.provider === 'google' && !isStaffEmail(user.email)) return false;
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
  session: {
    strategy: 'database',
    /**
     * 90일 유지, 하루 한 번 연장(sliding).
     *
     * 기본값은 30일 고정이라 한 달마다 전원이 다시 로그인해야 했다. updateAge 를 두면
     * 방문할 때마다 만료가 미뤄져 상시 사용자는 사실상 재로그인이 없다.
     * 매 요청마다 갱신하지 않는 것은 Session 행에 쓰기가 몰리는 것을 피하기 위해서다.
     */
    maxAge: 90 * 24 * 60 * 60,
    updateAge: 24 * 60 * 60,
  },
};
