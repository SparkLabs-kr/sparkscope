'use client';
// 로그인 실패 안내 — NextAuth의 pages.error 가 여기를 가리킨다.
//
// 이 화면은 "링크를 눌렀는데 통과하지 못한" 경우에만 보인다. 즉 여기까지 온 사람은
// 우리가 그 주소로 보낸 메일을 실제로 열어본 사람이다. 그래서 로그인 폼과 달리
// "권한이 없다"를 분명히 말해도 정보가 새지 않는다 —
// 메일함을 쓸 수 있다는 것이 이미 증명됐기 때문이다.
//
// (반대로 로그인 폼에서 이걸 구분해 보여주면, 아무나 주소를 넣어보며
//  어떤 메일이 등록돼 있는지 확인할 수 있게 된다. 그래서 그쪽은 항상 같은 화면이다.)
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useT } from '@/lib/i18n/client';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';

function ErrorBody() {
  const t = useT();
  const params = useSearchParams();
  const code = params.get('error') ?? '';

  // AccessDenied — signIn 콜백이 거절한 경우(발급되지 않았거나, 발급 후 비활성화된 계정).
  // Verification — 링크가 만료됐거나 이미 한 번 쓰인 경우.
  const expired = code === 'Verification';

  if (expired) {
    return (
      <div className="max-w-md w-full text-center">
        <div className="text-5xl mb-4">⌛</div>
        <h1 className="text-2xl font-bold mb-3">{t('링크가 만료되었습니다')}</h1>
        <p className="text-gray-600 leading-relaxed mb-6">
          {t('로그인 링크는 한 번만 쓸 수 있고, 시간이 지나면 만료됩니다. 새 링크를 받아 다시 시도해주세요.')}
        </p>
        <a
          href="/login"
          className="inline-block w-full py-3 bg-spark-purple text-white font-semibold rounded-lg hover:opacity-90"
        >
          {t('새 링크 받기')}
        </a>
      </div>
    );
  }

  return (
    <div className="max-w-md w-full text-center">
      <div className="text-5xl mb-4">🔒</div>
      <h1 className="text-2xl font-bold mb-3">{t('접근 권한이 없습니다')}</h1>
      <p className="text-gray-600 leading-relaxed mb-4">
        {t('이 이메일에는 SparkScope 접근 권한이 없습니다. 계정이 발급되지 않았거나, 발급된 계정이 해지된 상태입니다.')}
      </p>
      <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-left text-[13px] text-gray-600 leading-relaxed mb-6">
        <div className="font-semibold text-gray-800 mb-1">{t('어떻게 하면 되나요?')}</div>
        {t('SparkScope 계정은 스파크랩스에서 발급합니다. 담당 매니저에게 계정 발급을 요청해주세요. 직접 가입하는 절차는 없습니다.')}
      </div>
      <a
        href="/login/portfolio"
        className="inline-block w-full py-3 border border-gray-200 text-gray-600 font-semibold rounded-lg hover:bg-gray-50"
      >
        {t('로그인 화면으로 돌아가기')}
      </a>
    </div>
  );
}

export default function LoginErrorPage() {
  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="absolute top-5 right-6">
        <LanguageSwitcher />
      </div>
      <Suspense fallback={<div className="text-gray-400">···</div>}>
        <ErrorBody />
      </Suspense>
    </main>
  );
}
