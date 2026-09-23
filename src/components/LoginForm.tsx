'use client';
/**
 * 로그인 화면 — 들어오는 길이 세 갈래라서, 먼저 어느 쪽인지 고르게 한다.
 *
 * 사내 두 갈래(관리자·임직원)는 인증 수단이 똑같이 Google 이다. 그런데도 버튼을
 * 나눠 둔 이유는 **권한을 눈에 보이게** 하기 위해서다. 관리자는 바뀌는 자리라서
 * (담당 교체, 인턴 종료) 권한을 내려야 할 때가 오는데, 입구가 하나면 "누가
 * 관리자인지"가 화면 어디에도 드러나지 않아 회수 시점을 놓친다. 입구를 나누면
 * 명단(ADMIN_EMAILS)에서 빠진 사람이 그 자리에서 알게 된다 —
 * 관리자 입구만 막히고 임직원 입구로는 그대로 들어가진다.
 *
 * 포트폴리오사는 도메인이 제각각이라 Google 을 쓸 수 없어 매직 링크를 그대로 둔다.
 */
import { signIn } from 'next-auth/react';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useT } from '@/lib/i18n/client';

type Mode = 'company' | null;

/** 구글 로고 — 브랜드 가이드상 색을 임의로 바꾸지 않는다. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true">
      <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h11.8c-.5 2.7-2 5-4.3 6.6v5.500h7c4.1-3.8 6.6-9.4 6.6-16.1z" />
      <path fill="#34A853" d="M24 46c5.8 0 10.7-1.9 14.3-5.2l-7-5.4c-1.9 1.3-4.4 2.1-7.3 2.1-5.6 0-10.4-3.8-12.1-8.9H4.7v5.6C8.3 41.4 15.6 46 24 46z" />
      <path fill="#FBBC05" d="M11.9 28.6c-.4-1.3-.7-2.7-.7-4.1s.2-2.8.7-4.1v-5.6H4.7C3.2 17.7 2.4 20.7 2.4 24s.8 6.3 2.3 9.1l7.2-5.5z" />
      <path fill="#EA4335" d="M24 10.9c3.2 0 6 1.1 8.2 3.2l6.2-6.2C34.7 4.4 29.8 2.4 24 2.4 15.6 2.4 8.3 7 4.7 14.8l7.2 5.6c1.7-5.1 6.5-8.9 12.1-8.9z" />
    </svg>
  );
}

export function LoginForm({ googleEnabled }: { googleEnabled: boolean }) {
  // useSearchParams 는 Suspense 경계가 필요하다(정적 렌더링 경고 방지).
  return (
    <Suspense fallback={<div className="text-gray-400">···</div>}>
      <LoginFormInner googleEnabled={googleEnabled} />
    </Suspense>
  );
}

function LoginFormInner({ googleEnabled }: { googleEnabled: boolean }) {
  const t = useT();
  const params = useSearchParams();
  // 화면에는 버튼이 없지만, /login?mode=company 로 들어오면 포트폴리오사 폼이 열린다.
  // 지원할 때 링크 하나로 안내할 수 있게 남겨 둔 통로다.
  const [mode, setMode] = useState<Mode>(null);
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const checkEmail = params.get('check') === 'email';
  // NextAuth가 실패를 ?error=로 실어 보낸다. 가장 흔한 건 Verification —
  // 매직 링크는 한 번 쓰면 소진되므로, 링크를 다시 누르거나 새로고침하면 여기로 온다.
  const error = params.get('error');
  // 관리자 입구로 들어왔는데 명단에 없었던 경우. 서버가 이 값을 붙여 되돌려 보낸다.
  const notAdmin = params.get('denied') === 'admin';
  const deniedEmail = params.get('email') ?? '';

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
          ? t('이 메일 주소로는 로그인할 수 없습니다. 스파크랩 계정이거나, 승인된 포트폴리오사 계정이어야 합니다.')
          : t('로그인에 실패했습니다. 다시 시도해 주세요.')}
      {/* 원인 코드를 숨기면 지원할 때 추측밖에 할 수 없다. 실제로
          "sign in failed"만 보고 원인을 찾느라 오래 헤맨 적이 있다. */}
      <div className="mt-1.5 text-[11px] font-mono text-amber-700/70">code: {error}</div>
    </div>
  ) : null;

  /**
   * 관리자 명단에서 빠졌을 때의 안내.
   *
   * "로그인 실패"로 뭉뚱그리지 않는 것이 중요하다. 계정은 멀쩡하고 권한만 없는
   * 상태이므로, 무엇이 없는지와 지금 무엇을 할 수 있는지를 같이 알려 준다.
   */
  const adminDeniedBanner = notAdmin ? (
    <div className="mb-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3.5 text-[13px] leading-relaxed text-rose-800">
      <div className="font-semibold">{t('관리자 권한이 없는 계정입니다')}</div>
      <p className="mt-1 text-[12.5px]">
        {deniedEmail && <span className="font-mono">{deniedEmail}</span>}
        {deniedEmail && ' — '}
        {t('임직원으로는 로그인할 수 있습니다. 권한이 필요하면 커뮤니케이션본부에 요청하세요.')}
      </p>
    </div>
  ) : null;

  // ── 포트폴리오사: 메일 입력 화면 ───────────────────────────────
  if (mode === 'company' || params.get('mode') === 'company') {
    return (
      <form
        onSubmit={async e => {
          e.preventDefault();
          setSubmitting(true);
          await signIn('email', { email, callbackUrl: '/portfolio' });
        }}
        className="max-w-md w-full"
      >
        <div className="text-xs font-bold tracking-wider text-spark-purple mb-2 text-center">SPARKSCOPE</div>
        <h1 className="text-2xl font-bold mb-1 text-center">{t('포트폴리오사 로그인')}</h1>
        <p className="text-sm text-gray-600 mb-6 text-center">
          {t('이메일을 입력하면 로그인 링크를 보내드립니다')}
        </p>

        {errorBanner}

        <input
          id="login-email"
          type="email"
          required
          autoFocus
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

        <p className="mt-4 text-center text-[12.5px] text-gray-500">
          {t('아직 승인받지 못하셨나요?')}{' '}
          <a href="/request-access" className="text-spark-purple font-semibold hover:underline">
            {t('접근 요청하기')}
          </a>
        </p>

        {/* 쿼리(?mode=company)까지 지워야 한다 — state 만 되돌리면 같은 폼이 다시 열린다. */}
        <a
          href="/login"
          className="mt-5 block w-full text-center text-[12.5px] text-gray-400 hover:text-spark-purple"
        >
          ← {t('다른 방법으로 로그인')}
        </a>
      </form>
    );
  }

  // ── 첫 화면: 어느 길인지 고른다 ────────────────────────────────
  /**
   * 사내 두 입구 모두 같은 provider 를 부른다. 다른 것은 callbackUrl 뿐이고,
   * 관리자 여부는 서버가 명단을 보고 판정한다 — 버튼을 누른 사람이 스스로
   * 관리자라고 주장하는 것으로는 아무것도 얻지 못한다.
   */
  const googleSignIn = (callbackUrl: string) => {
    setSubmitting(true);
    signIn('google', { callbackUrl });
  };

  // 로그인 전에 보고 있던 곳으로 돌려보낸다(middleware 가 붙여 준다).
  const callbackUrl = params.get('callbackUrl');

  return (
    <div className="max-w-md w-full">
      <div className="text-xs font-bold tracking-wider text-spark-purple mb-2 text-center">SPARKSCOPE</div>
      <h1 className="text-2xl font-bold mb-1 text-center">{t('로그인')}</h1>
      <p className="text-sm text-gray-600 mb-6 text-center">{t('어느 쪽에 해당하시나요?')}</p>

      {adminDeniedBanner}
      {errorBanner}
      {wasReset && !error && (
        <div className="mb-5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] text-emerald-800">
          {t('로그인 상태를 초기화했습니다. 다시 로그인해 주세요.')}
        </div>
      )}

      <div className="space-y-2.5">
        {/* 구글 키가 없는 환경(로컬·프리뷰)에서는 사내 입구를 감춘다.
            버튼만 보이고 누르면 설정 오류로 떨어지는 것보다, 없는 편이 낫다. */}
        {googleEnabled && (
          <>
            <button
              type="button"
              disabled={submitting}
              onClick={() => googleSignIn('/login/admin-check')}
              className="w-full flex items-center gap-3 text-left px-4 py-3.5 rounded-xl border border-spark-purple bg-spark-light-purple hover:opacity-90 transition disabled:opacity-50 group"
            >
              <span className="flex-none w-8 h-8 rounded-lg bg-white grid place-items-center shadow-sm">
                <GoogleMark />
              </span>
              <span className="min-w-0">
                <span className="block font-semibold text-[15px] text-spark-purple">{t('관리자 로그인')}</span>
                <span className="block text-[12.5px] text-gray-500 mt-0.5">{t('Google 계정으로 로그인합니다')}</span>
              </span>
            </button>

            <button
              type="button"
              disabled={submitting}
              onClick={() => googleSignIn(callbackUrl || '/dashboard')}
              className="w-full flex items-center gap-3 text-left px-4 py-3.5 rounded-xl border border-gray-200 bg-white hover:border-spark-purple transition disabled:opacity-50 group"
            >
              <span className="flex-none w-8 h-8 rounded-lg bg-spark-subtle border border-spark-border grid place-items-center">
                <GoogleMark />
              </span>
              <span className="min-w-0">
                <span className="block font-semibold text-[15px] group-hover:text-spark-purple">{t('스파크랩 임직원')}</span>
                <span className="block text-[12.5px] text-gray-500 mt-0.5">{t('Google 계정으로 로그인합니다')}</span>
              </span>
            </button>
          </>
        )}

        {/* 포트폴리오사 입구와 접근 요청 버튼은 2026-09-23에 화면에서 뺐다.
            그쪽 로그인 방식을 다시 정하기로 해서, 정해지기 전까지 안내하지 않는다.
            기능 자체는 살아 있다 — /login?mode=company 와 /request-access 로
            여전히 닿을 수 있어서, 이미 계정을 받은 대표가 완전히 막히지는 않는다. */}
        {!googleEnabled && (
          <p className="rounded-xl border border-dashed border-gray-300 px-4 py-5 text-center text-[13px] text-gray-500">
            {t('지금은 로그인할 수 없습니다. 담당자에게 문의해 주세요.')}
          </p>
        )}
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
