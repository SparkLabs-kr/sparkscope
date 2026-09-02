'use client';
// 로그인 폼 — 사내 입구(/login)와 포트폴리오사 입구(/login/portfolio)가 같이 쓴다.
//
// 두 입구는 문구와 안내만 다르고, 동작은 완전히 같다. 어느 문으로 들어왔는지는
// 권한에 아무 영향을 주지 않는다 — 계정 종류는 메일 주소로 정해진다(src/lib/auth.ts).
// 문을 고르는 것으로 권한이 달라지면, 누구나 원하는 문을 고를 수 있으니 그건 구멍이다.
//
// 이 폼이 구분해서 보여주는 것은 "문을 잘못 찾았다" 하나뿐이다. 그건 메일 주소의
// 도메인만 보고 판단하므로(DB를 보지 않는다) 밖에서 알 수 없는 정보가 새지 않는다 —
// 도메인 규칙 자체는 어차피 공개된 사실이다.
//
// 반대로 "발급되지 않은 주소"는 여기서 절대 구분해 보여주지 않는다. 그 순간 이 폼이
// "어떤 메일이 스파크랩스에 등록돼 있는지" 확인하는 도구가 된다. 그 안내는 링크를
// 누른 뒤(= 메일함을 실제로 쓸 수 있음이 증명된 뒤)에 /login/error 에서 보여준다.
import { signIn } from 'next-auth/react';
import { useState } from 'react';
import { useT } from '@/lib/i18n/client';

export type LoginVariant = 'staff' | 'portfolio';

/**
 * 사내 도메인 판단 — 서버(src/lib/auth.ts의 STAFF_EMAIL_DOMAINS)에서 목록을 받아 쓴다.
 * 여기에 목록을 또 적어두면 대만·호주 도메인을 추가했을 때 한쪽만 고쳐져서,
 * 실제로는 들어올 수 있는 사람이 "문을 잘못 찾았다"는 말을 듣게 된다.
 *
 * 이 판단은 안내 목적일 뿐이고, 실제 허용 여부는 언제나 서버가 정한다.
 */
function isStaffAddress(email: string, staffDomains: string[]): boolean {
  const addr = email.trim().toLowerCase();
  return staffDomains.some(d => addr.endsWith(`@${d}`));
}

export function LoginForm({
  variant,
  staffDomains,
  initialSent = false,
}: {
  variant: LoginVariant;
  /** 사내 도메인 목록 — 서버에서 내려준다(ALLOWED_EMAIL_DOMAINS). */
  staffDomains: string[];
  /** NextAuth의 verifyRequest 리다이렉트(/login?check=email)로 들어온 경우 */
  initialSent?: boolean;
}) {
  const t = useT();
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(initialSent);
  // 문을 잘못 찾은 경우. 제출을 막고 맞는 입구로 보낸다.
  const [wrongDoor, setWrongDoor] = useState(false);

  const isPortfolio = variant === 'portfolio';

  // ── 문을 잘못 찾은 경우 ──────────────────────────────────────────────
  // 주소의 도메인만 보고 판단한 것이라, 계정이 있는지 없는지는 아무것도 말하지 않는다.
  if (wrongDoor) {
    return (
      <div className="max-w-md w-full text-center">
        <div className="text-5xl mb-4">🚫</div>
        <h1 className="text-2xl font-bold mb-3">{t('이 입구로는 들어올 수 없습니다')}</h1>
        {isPortfolio ? (
          <>
            <p className="text-gray-600 leading-relaxed mb-6">
              {t('입력하신 주소는 스파크랩스 임직원 메일입니다. 여기는 포트폴리오사 전용 입구라, 임직원 로그인으로 가셔야 합니다.')}
            </p>
            <a
              href="/login"
              className="inline-block w-full py-3 bg-spark-purple text-white font-semibold rounded-lg hover:opacity-90"
            >
              {t('임직원 로그인으로 이동')}
            </a>
          </>
        ) : (
          <>
            <p className="text-gray-600 leading-relaxed mb-6">
              {t('여기는 스파크랩스 임직원 전용 입구입니다. 포트폴리오사 계정은 포트폴리오사 로그인으로 들어오셔야 합니다.')}
            </p>
            <a
              href="/login/portfolio"
              className="inline-block w-full py-3 bg-spark-purple text-white font-semibold rounded-lg hover:opacity-90"
            >
              {t('포트폴리오사 로그인으로 이동')}
            </a>
          </>
        )}
        <button
          type="button"
          onClick={() => {
            setWrongDoor(false);
            setEmail('');
          }}
          className="mt-3 w-full py-2.5 text-sm font-semibold text-gray-500 hover:text-spark-purple"
        >
          {t('다른 주소로 다시 입력')}
        </button>
      </div>
    );
  }

  if (sent) {
    // 이 화면은 발급된 주소든 아닌 주소든 똑같이 보인다(의도된 것 — 파일 상단 주석 참고).
    //
    // 그래서 "메일이 안 오는" 경우를 이 화면 안에서 스스로 해결할 수 있어야 한다.
    // 가장 흔한 실패는 공격이 아니라, 실제 담당자가 발급받은 주소가 아닌 다른 회사 주소를
    // 넣는 것이다(pr@ 로 발급했는데 본인 이름 주소를 넣는 식). 그때 "메일을 확인하세요"만
    // 남겨두면 오지 않는 메일을 무한정 기다리게 된다.
    return (
      <div className="max-w-md text-center">
        <div className="text-5xl mb-4">📬</div>
        <h1 className="text-2xl font-bold mb-3">{t('메일을 확인하세요')}</h1>
        <p className="text-gray-600 leading-relaxed">
          {/* NextAuth의 verifyRequest로 넘어온 경우엔 주소가 state에 없다 — 그때는 주소 없이 안내한다. */}
          {email.trim()
            ? t('{email} 주소로 로그인 링크를 보냈습니다. 받은편지함에서 SparkScope 메일을 열어 링크를 클릭하세요.', {
                email: email.trim(),
              })
            : t('로그인 링크를 보냈습니다. 받은편지함에서 SparkScope 메일을 열어 링크를 클릭하세요.')}
          <br />
          <span className="text-xs text-gray-400 mt-4 block">{t('(스팸함도 확인해주세요)')}</span>
        </p>

        <div className="mt-6 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-left text-[13px] leading-relaxed text-gray-600">
          <div className="mb-1.5 font-semibold text-gray-800">{t('몇 분 안에 메일이 오지 않으면')}</div>
          {isPortfolio ? (
            <ul className="list-disc space-y-1 pl-4">
              <li>{t('발급받은 주소와 정확히 같은지 확인해주세요. 회사 도메인이라도 다른 주소로는 로그인되지 않습니다.')}</li>
              <li>{t('어느 주소로 발급됐는지 모르면 담당 스파크랩스 매니저에게 확인해주세요.')}</li>
            </ul>
          ) : (
            <ul className="list-disc space-y-1 pl-4">
              <li>{t('사내 메일 주소를 정확히 입력했는지 확인해주세요.')}</li>
              <li>{t('그래도 오지 않으면 커뮤니케이션 본부에 알려주세요.')}</li>
            </ul>
          )}
        </div>

        <button
          type="button"
          onClick={() => setSent(false)}
          className="mt-3 w-full py-2.5 text-sm font-semibold text-gray-500 hover:text-spark-purple"
        >
          {t('다른 주소로 다시 시도')}
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={async e => {
        e.preventDefault();

        // 문이 맞는지 먼저 본다. 도메인만 보는 검사라 DB를 건드리지 않는다.
        const staffAddress = isStaffAddress(email, staffDomains);
        if (isPortfolio ? staffAddress : !staffAddress) {
          setWrongDoor(true);
          return;
        }

        setSubmitting(true);
        // redirect: false — NextAuth의 공용 verifyRequest 페이지로 튕기지 않고 이 자리에서
        // 안내로 바꾼다. 그래야 포트폴리오사가 사내 문구가 섞인 화면을 보지 않는다.
        // 발급되지 않은 메일이어도 결과가 같으므로(메일만 안 나간다) 화면은 동일하다.
        await signIn('email', { email, redirect: false, callbackUrl: '/dashboard' });
        setSubmitting(false);
        setSent(true);
      }}
      className="max-w-md w-full"
    >
      <div className="text-xs font-bold tracking-wider text-spark-purple mb-2 text-center">SPARKSCOPE</div>

      {isPortfolio ? (
        <>
          <h1 className="text-2xl font-bold mb-2 text-center">{t('포트폴리오사 로그인')}</h1>
          <p className="text-sm text-gray-600 mb-6 text-center leading-relaxed">
            {t('스파크랩스가 제공하는 우리 회사 언론 보도 현황입니다. 발급받은 이메일을 입력하면 로그인 링크를 보내드립니다.')}
          </p>
        </>
      ) : (
        <>
          <h1 className="text-2xl font-bold mb-2 text-center">{t('로그인')}</h1>
          <p className="text-sm text-gray-600 mb-6 text-center leading-relaxed">
            {t('스파크랩스 이메일을 입력하면 로그인 링크를 보내드립니다')}
            <br />
            <span className="text-xs text-gray-400">
              {staffDomains.map(d => `@${d}`).join(' · ')}
            </span>
          </p>
        </>
      )}

      <input
        type="email"
        required
        autoComplete="email"
        placeholder={isPortfolio ? 'name@company.com' : `name@${staffDomains[0] ?? 'sparklabs.co.kr'}`}
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

      {/* 문을 잘못 찾은 사람을 위한 안내. 권한과는 무관하고, 맞는 문구가 있는 화면으로만 보낸다. */}
      <p className="text-xs text-gray-400 mt-5 text-center leading-relaxed">
        {isPortfolio ? (
          <>
            {t('스파크랩스 임직원이신가요?')}{' '}
            <a href="/login" className="font-semibold text-spark-purple hover:underline">
              {t('임직원 로그인')}
            </a>
          </>
        ) : (
          <>
            {t('포트폴리오사이신가요?')}{' '}
            <a href="/login/portfolio" className="font-semibold text-spark-purple hover:underline">
              {t('포트폴리오사 로그인')}
            </a>
          </>
        )}
      </p>

      {isPortfolio && (
        <p className="text-[11px] text-gray-400 mt-4 text-center leading-relaxed">
          {t('계정은 스파크랩스에서 발급합니다. 직접 가입하는 절차는 없습니다.')}
        </p>
      )}
    </form>
  );
}
