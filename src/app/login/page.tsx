'use client';
import { signIn } from 'next-auth/react';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useT } from '@/lib/i18n/client';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';

function LoginForm() {
  const t = useT();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const checkEmail = params.get('check') === 'email';
  // NextAuth가 실패를 ?error=로 실어 보낸다. 가장 흔한 건 Verification —
  // 매직 링크는 한 번 쓰면 소진되므로, 링크를 다시 누르거나 새로고침하면 여기로 온다.
  // 이걸 "로그인 실패"로 보여주면 잠긴 줄 알게 된다. 실제로는 다시 받으면 그만이다.
  const error = params.get('error');

  if (checkEmail) {
    return (
      <div className="max-w-md text-center">
        <div className="text-5xl mb-4">📬</div>
        <h1 className="text-2xl font-bold mb-3">{t('메일을 확인하세요')}</h1>
        <p className="text-gray-600 leading-relaxed">
          {t('로그인 링크를 보냈습니다. 받은편지함에서 SparkScope 메일을 열어 링크를 클릭하세요.')}
          <br />
          <span className="text-xs text-gray-400 mt-4 block">{t('(스팸함도 확인해주세요)')}</span>
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={async e => {
        e.preventDefault();
        setSubmitting(true);
        await signIn('email', { email, callbackUrl: '/dashboard' });
      }}
      className="max-w-md w-full"
    >
      <div className="text-xs font-bold tracking-wider text-spark-purple mb-2 text-center">SPARKSCOPE</div>
      <h1 className="text-2xl font-bold mb-2 text-center">{t('로그인')}</h1>

      {/* 실패 안내 — 무엇이 잘못됐고 무엇을 하면 되는지 한 줄로. 아래 폼이 그대로 있어
          같은 화면에서 바로 다시 받을 수 있다. */}
      {error && (
        <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] leading-relaxed text-amber-800">
          {error === 'Verification'
            ? t('이 로그인 링크는 이미 사용했거나 만료됐습니다. 링크는 한 번만 쓸 수 있어요 — 아래에서 새로 받아 주세요.')
            : error === 'AccessDenied'
              ? t('이 메일 주소로는 접근할 수 없습니다. 사내 계정이거나 승인된 포트폴리오사 계정이어야 합니다.')
              : t('로그인에 실패했습니다. 아래에서 링크를 새로 받아 주세요.')}
        </div>
      )}

      <p className="text-sm text-gray-600 mb-6 text-center">
        {t('이메일을 입력하면 로그인 링크를 보내드립니다')}
      </p>
      <input
        type="email"
        required
        placeholder="name@company.com"
        value={email}
        onChange={e => setEmail(e.target.value)}
        className="w-full px-4 py-3 border border-gray-200 rounded-lg mb-3 focus:outline-none focus:border-spark-purple"
      />
      <button
        type="submit"
        disabled={submitting}
        className="w-full py-3 bg-spark-purple text-white font-semibold rounded-lg hover:opacity-90 disabled:opacity-50"
      >
        {submitting ? t('전송 중...') : t('로그인 링크 받기')}
      </button>

      {/* 포트폴리오사 대표는 계정이 없으므로 여기서 요청 화면으로 보낸다.
          이 링크가 없으면 /request-access 에 도달할 방법이 없다. */}
      <p className="mt-5 text-center text-[12.5px] text-gray-500">
        {t('스파크랩 포트폴리오사이신가요?')}{' '}
        <a href="/request-access" className="text-spark-purple font-semibold hover:underline">
          {t('접근 요청하기')}
        </a>
      </p>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="absolute top-5 right-6">
        <LanguageSwitcher />
      </div>
      <Suspense fallback={<div className="text-gray-400">···</div>}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
