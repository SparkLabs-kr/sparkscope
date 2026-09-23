/**
 * 로그인 화면 — 서버 컴포넌트.
 *
 * 하는 일은 하나뿐이다: "구글 로그인을 쓸 수 있는 환경인가"를 판단해 폼에 내려준다.
 * 폼은 클라이언트라 process.env 를 읽을 수 없고, NEXT_PUBLIC_ 으로 노출할 것도
 * 아니다 — 키 자체가 아니라 켜져 있는지 여부만 필요하기 때문이다.
 */
import { GOOGLE_ENABLED } from '@/lib/auth';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { LoginForm } from '@/components/LoginForm';

export const dynamic = 'force-dynamic';

export default function LoginPage() {
  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="absolute top-5 right-6">
        <LanguageSwitcher />
      </div>
      <LoginForm googleEnabled={GOOGLE_ENABLED} />
    </main>
  );
}
