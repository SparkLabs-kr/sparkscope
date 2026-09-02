// 포트폴리오사 입구.
//
// 별도 주소로 둔 이유는 계정 발급 안내에서 이 주소로 바로 링크를 걸 수 있게 하기 위해서다.
// 사내 입구(/login)는 자리표시자와 문구가 임직원용이라, 포트폴리오사 담당자가 그 화면에
// 도착하면 "여긴 내가 쓸 데가 아닌가" 하고 되돌아가게 된다.
//
// 권한은 이 주소로 들어왔다고 달라지지 않는다 — 문구만 다른 같은 폼이다.
import { LoginForm } from '@/components/LoginForm';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { STAFF_EMAIL_DOMAINS } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default function PortfolioLoginPage({
  searchParams,
}: {
  searchParams: { check?: string };
}) {
  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="absolute top-5 right-6">
        <LanguageSwitcher />
      </div>
      <LoginForm
        variant="portfolio"
        staffDomains={STAFF_EMAIL_DOMAINS}
        initialSent={searchParams.check === 'email'}
      />
    </main>
  );
}
