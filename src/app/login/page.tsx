// 사내 임직원 입구. 포트폴리오사 입구는 /login/portfolio.
// NextAuth의 pages.signIn이 여기를 가리키므로, 인증이 필요한 화면은 모두 이 문으로 온다.
//
// 서버 컴포넌트인 이유는 사내 도메인 목록(ALLOWED_EMAIL_DOMAINS)을 폼에 내려주기 위해서다.
// 목록을 클라이언트에 또 적어두면 오피스를 추가했을 때 한쪽만 고쳐진다.
import { LoginForm } from '@/components/LoginForm';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { STAFF_EMAIL_DOMAINS } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default function LoginPage({ searchParams }: { searchParams: { check?: string } }) {
  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="absolute top-5 right-6">
        <LanguageSwitcher />
      </div>
      <LoginForm
        variant="staff"
        staffDomains={STAFF_EMAIL_DOMAINS}
        // NextAuth가 verifyRequest로 여기 보낼 때가 있어(설정상 /login?check=email) 그 경우도 받아준다.
        initialSent={searchParams.check === 'email'}
      />
    </main>
  );
}
