'use client';
/**
 * 로그인 화면 — 들어오는 길이 세 갈래라서, 먼저 어느 쪽인지 고르게 한다.
 *
 * 메일 한 칸만 두었더니 아무도 자기 경우인지 몰랐다. 사내 계정과
 * 포트폴리오사 계정은 같은 매직 링크 방식이지만 사람이 다르고, 실패했을 때
 * 해야 할 일도 다르다(사내는 담당자 문의, 포트폴리오사는 접근 요청).
 * 계정이 아직 없는 회사는 애초에 로그인할 수 없으므로 요청 화면으로 보낸다.
 */
import { signIn } from 'next-auth/react';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useT } from '@/lib/i18n/client';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';

type Mode = 'staff' | 'company';

function LoginForm() {
  const t = useT();
  const params = useSearchParams();
  const [mode, setMode] = useState<Mode | null>(null);
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const checkEmail = params.get('check') === 'email';
  // NextAuth가 실패를 ?error=로 실어 보낸다. 가장 흔한 건 Verification —
  // 매직 링크는 한 번 쓰면 소진되므로, 링크를 다시 누르거나 새로고침하면 여기로 온다.
  const error = params.get('error');

  if (checkEmail) {
    return (
      <div className="max-w-md text-center">
        <div className="text-5xl mb-4">📬</div>
        <h1 className="text-2xl font-bold mb-3">{t('메일을 확인하세요')}</h1>
        <p className="text-gray-600 leading-relaxed">
          {t('로그인 링크를 보냈습니다. 받은편지함에서 SparkScope 메일을 열어 링크를 클릭하세요.')}
        </p>
        {/* 실제로 걸린 곳이 여기다 — 받은편지함에 이전 링크가 여러 개 쌓여 있으면
            오래된 것을 누르게 되고, 링크는 한 번만 쓸 수 있어서 실패한다. */}
        <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[12.5px] leading-relaxed text-amber-800">
          {t('가장 최근에 온 메일의 링크를 눌러 주세요. 이전에 받은 링크는 더 이상 쓸 수 없습니다.')}
        </p>
        <span className="text-xs text-gray-400 mt-4 block">{t('(스팸함도 확인해주세요)')}</span>
      </div>
    );
  }

  const wasReset = params.get('reset') === '1';

  const errorBanner = error ? (
    <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] leading-relaxed text-amber-800">
      {error === 'Verification'
        ? t('이 로그인 링크는 이미 사용했거나 만료됐습니다. 링크는 한 번만 쓸 수 있어요 — 새로 받아 주세요.')
        : error === 'AccessDenied'
          ? t('이 메일 주소로는 아직 로그인할 수 없습니다. 포트폴리오사라면 먼저 접근 요청이 승인되어야 합니다.')
          : t('로그인에 실패했습니다. 링크를 새로 받아 주세요.')}
      {/* 원인 코드를 숨기면 지원할 때 추측밖에 할 수 없다. 실제로 오늘
          "sign in failed"만 보고 원인을 찾느라 오래 헤맸다. */}
      <div className="mt-1.5 text-[11px] font-mono text-amber-700/70">code: {error}</div>
    </div>
  ) : null;

  // ── 1단계: 어느 길인지 고른다 ──────────────────────────────────
  if (mode === null) {
    return (
      <div className="max-w-md w-full">
        <div className="text-xs font-bold tracking-wider text-spark-purple mb-2 text-center">SPARKSCOPE</div>
        <h1 className="text-2xl font-bold mb-1 text-center">{t('로그인')}</h1>
        <p className="text-sm text-gray-600 mb-6 text-center">{t('어느 쪽에 해당하시나요?')}</p>

        {errorBanner}
        {wasReset && !error && (
          <div className="mb-5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] text-emerald-800">
            {t('로그인 상태를 초기화했습니다. 다시 로그인해 주세요.')}
          </div>
        )}

        <div className="space-y-2.5">
          <button
            type="button"
            onClick={() => setMode('staff')}
            className="w-full text-left px-4 py-3.5 rounded-xl border border-gray-200 bg-white hover:border-spark-purple transition group"
          >
            <div className="font-semibold text-[15px] group-hover:text-spark-purple">
              {t('스파크랩 임직원')}
            </div>
            <div className="text-[12.5px] text-gray-500 mt-0.5">
              {t('@sparklabs.co.kr 계정으로 로그인합니다')}
            </div>
          </button>

          <button
            type="button"
            onClick={() => setMode('company')}
            className="w-full text-left px-4 py-3.5 rounded-xl border border-gray-200 bg-white hover:border-spark-purple transition group"
          >
            <div className="font-semibold text-[15px] group-hover:text-spark-purple">
              {t('포트폴리오사 로그인')}
            </div>
            <div className="text-[12.5px] text-gray-500 mt-0.5">
              {t('승인받은 회사 계정으로 자기 회사 보도를 봅니다')}
            </div>
          </button>

          <a
            href="/request-access"
            className="block w-full text-left px-4 py-3.5 rounded-xl border border-dashed border-gray-300 bg-transparent hover:border-spark-purple transition group"
          >
            <div className="font-semibold text-[15px] group-hover:text-spark-purple">
              {t('접근 요청하기')}
            </div>
            <div className="text-[12.5px] text-gray-500 mt-0.5">
              {t('아직 계정이 없는 포트폴리오사 — 마케팅팀 승인 후 로그인할 수 있습니다')}
            </div>
          </a>
        </div>

        {/* 죽은 세션 쿠키에 걸리면 사용자가 스스로 빠져나올 방법이 없다.
            쿠키는 httpOnly 라서 브라우저에서 지울 수 없으므로 서버에 맡긴다. */}
        <p className="mt-6 text-center text-[11.5px] text-gray-400">
          {t('로그인이 계속 안 되면')}{' '}
          <a href="/api/session-reset" className="underline hover:text-spark-purple">
            {t('로그인 상태 초기화')}
          </a>
        </p>
      </div>
    );
  }

  // ── 2단계: 고른 길에 맞는 메일 입력 ───────────────────────────
  const staff = mode === 'staff';
  return (
    <form
      onSubmit={async e => {
        e.preventDefault();
        setSubmitting(true);
        // 사내는 대시보드, 포트폴리오사는 자기 회사 화면으로.
        await signIn('email', { email, callbackUrl: staff ? '/dashboard' : '/portfolio' });
      }}
      className="max-w-md w-full"
    >
      <div className="text-xs font-bold tracking-wider text-spark-purple mb-2 text-center">SPARKSCOPE</div>
      <h1 className="text-2xl font-bold mb-1 text-center">
        {staff ? t('스파크랩 임직원') : t('포트폴리오사 로그인')}
      </h1>
      <p className="text-sm text-gray-600 mb-6 text-center">
        {t('이메일을 입력하면 로그인 링크를 보내드립니다')}
      </p>

      {errorBanner}

      <input
        type="email"
        required
        autoFocus
        placeholder={staff ? 'name@sparklabs.co.kr' : 'name@company.com'}
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

      {!staff && (
        <p className="mt-4 text-center text-[12.5px] text-gray-500">
          {t('아직 승인받지 못하셨나요?')}{' '}
          <a href="/request-access" className="text-spark-purple font-semibold hover:underline">
            {t('접근 요청하기')}
          </a>
        </p>
      )}

      <button
        type="button"
        onClick={() => { setMode(null); setEmail(''); }}
        className="mt-5 w-full text-center text-[12.5px] text-gray-400 hover:text-spark-purple"
      >
        ← {t('다른 방법으로 로그인')}
      </button>
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
