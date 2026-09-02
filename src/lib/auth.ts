// NextAuth 설정 — 이메일 매직 링크.
//
// 로그인이 허용되는 경우는 딱 두 가지다.
//   1. 사내 도메인 메일 — 스파크랩 각 오피스(한국·대만·호주 등). 첫 로그인 시 ADMIN으로 만들어진다.
//      도메인 목록은 ALLOWED_EMAIL_DOMAINS 환경변수로 관리한다.
//   2. 관리자가 미리 발급해둔 포트폴리오사 계정 — User 레코드가 이미 있고 active=true인 경우만.
//
// 초대장이 없는 외부 메일에는 애초에 링크를 보내지 않고, 혹시 받아둔 링크로 들어와도
// signIn 콜백에서 다시 막는다. 두 지점 모두 canSignIn() 하나를 쓴다.
// (비밀번호를 저장하지 않는 대신, "계정 발급"이 곧 초대이고 "비활성화"가 곧 차단이다.)
import type { NextAuthOptions } from 'next-auth';
import EmailProvider from 'next-auth/providers/email';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { prisma } from '@/lib/prisma';

// 사내 도메인 목록 — 한국뿐 아니라 대만·호주 등 각 오피스 도메인을 모두 넣는다.
// ALLOWED_EMAIL_DOMAINS 에 쉼표로 구분해 설정한다. (예전 단수형 ALLOWED_EMAIL_DOMAIN 도
// 계속 읽어서, 환경변수를 아직 안 바꾼 배포가 갑자기 잠기지 않게 한다.)
//
// ⚠️ 이 목록에 도메인을 넣는다는 것은 "그 도메인 메일을 가진 사람은 누구나 관리자"라는 뜻이다.
// 우리가 실제로 통제하는 회사 도메인만 넣는다. gmail.com 같은 공용 도메인은 절대 넣지 않는다.
export const STAFF_EMAIL_DOMAINS: string[] = (
  process.env.ALLOWED_EMAIL_DOMAINS ??
  process.env.ALLOWED_EMAIL_DOMAIN ??
  'sparklabs.co.kr'
)
  .split(',')
  .map(d => d.trim().toLowerCase().replace(/^@/, ''))
  .filter(Boolean);

const testRecipient = process.env.DIGEST_TEST_RECIPIENT ?? '';

/**
 * 사내 계정인가 — 도메인만으로 판단한다.
 *
 * endsWith('@' + domain) 로 비교하는 것이 중요하다. '@'를 빼고 비교하면
 * notsparklabs.co.kr 같은 남의 도메인이 통과한다.
 */
export function isStaffEmail(email: string): boolean {
  const addr = email.trim().toLowerCase();
  return STAFF_EMAIL_DOMAINS.some(d => addr.endsWith(`@${d}`));
}

/**
 * 이 메일이 로그인할 수 있는가 — 링크를 보내기 전과 링크를 누른 뒤 모두 같은 기준을 쓴다.
 *
 * 사내 도메인이거나, 관리자가 발급해둔 활성 계정이면 통과.
 */
async function canSignIn(email: string): Promise<boolean> {
  const addr = email.toLowerCase();
  if (addr === testRecipient.toLowerCase() && testRecipient) return true;
  if (isStaffEmail(addr)) return true;
  const invited = await prisma.user.findUnique({
    where: { email: addr },
    select: { active: true },
  });
  return invited?.active === true;
}

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
 * 로그인할 수 없는 메일에는 링크를 아예 보내지 않는다.
 *
 * 기본 동작은 주소 형식만 맞으면 누구에게나 링크를 보내고, 링크를 누른 뒤에야
 * signIn 콜백에서 막는다 — 발급받지 않은 사람이 "메일은 왔는데 안 들어가진다"를
 * 겪게 되고, 우리 도메인으로 아무 주소에나 메일을 쏘게 된다.
 *
 * 대신 화면은 어느 경우에나 똑같이 "메일을 확인하세요"로 끝낸다. 여기서 결과를
 * 다르게 보여주면, 어떤 메일이 계정으로 등록돼 있는지 밖에서 확인할 수 있게 된다.
 *
 * 기본 발송 함수는 모듈에서 내보내지 않고 provider 안에 들어 있으므로,
 * 만들어진 provider에서 꺼내 감싼다.
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
      // 링크를 보낼 때와 같은 기준(canSignIn)으로 한 번 더 확인한다 —
      // 발급 후 비활성화된 계정이 이미 받아둔 링크로 들어오는 것을 막는다.
      return canSignIn(user.email);
    },
    async session({ session, user }) {
      if (session.user) {
        const u = session.user as any;
        u.id = user.id;
        // 화면에서 매번 DB를 보지 않아도 되게 세션에 실어둔다. 다만 비활성화를
        // 즉시 반영해야 하는 판단은 authz.getSessionUser()가 DB를 다시 본다.
        u.role = (user as any).role ?? 'PORTFOLIO';
        u.companyId = (user as any).companyId ?? null;
      }
      return session;
    },
  },
  events: {
    /**
     * 계정이 자동 생성되는 경로는 사내 메일 첫 로그인뿐이다(외부 메일은 signIn에서 막히고,
     * 포트폴리오사 계정은 관리자가 먼저 만든다). 그래서 여기서 만들어지는 계정은 ADMIN이다.
     *
     * schema의 role 기본값을 PORTFOLIO(최소 권한)로 두고 여기서 올리는 이유는,
     * 어떤 경로로든 예상치 못하게 생긴 계정이 관리자 권한을 갖지 않게 하기 위해서다.
     */
    async createUser({ user }) {
      if (user.email && isStaffEmail(user.email)) {
        await prisma.user.update({ where: { id: user.id }, data: { role: 'ADMIN' } });
      }
    },
    async signIn({ user }) {
      if (user?.id) {
        await prisma.user
          .update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
          .catch(() => {});
      }
    },
  },
  pages: {
    signIn: '/login',
    verifyRequest: '/login?check=email',
    // 링크를 눌렀지만 통과하지 못한 경우(발급 안 됨 · 해지됨 · 링크 만료).
    // 로그인 폼과 달리 여기서는 "권한 없음"을 분명히 말한다 — 메일함을 쓸 수 있다는
    // 것이 이미 증명된 사람만 이 화면에 도달하기 때문이다.
    error: '/login/error',
  },
  session: {
    strategy: 'database',
    // 90일. NextAuth의 maxAge는 역할별로 나눌 수 없어서 전체에 적용한다.
    //
    // 기본값 30일은 포트폴리오사 대표에게 짧다 — 분기에 한 번 보는 사람은 올 때마다
    // 새 링크를 받아야 한다. 반대로 임직원은 매일 쓰니 30일이든 90일이든 체감이 없다.
    //
    // 길게 잡아도 안전한 이유: 계정을 해지하면 Session 행을 지우고(api/accounts),
    // authz.getSessionUser()가 요청마다 active를 다시 확인한다. 즉 만료를 기다리지 않고
    // 즉시 끊을 수 있다.
    maxAge: 90 * 24 * 60 * 60,
    // 방문할 때마다(하루 한 번까지) 만료를 밀어준다 — 꾸준히 쓰면 재로그인이 없다.
    updateAge: 24 * 60 * 60,
  },
};
