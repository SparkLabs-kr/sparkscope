'use client';
// 상단 바 우측의 한국어/English 토글. 쿠키에 저장하고 새로고침해서
// 서버 컴포넌트가 그린 문구까지 같이 바뀌게 한다.
import { useState } from 'react';
import { LOCALES, LOCALE_COOKIE, LOCALE_LABELS, type Locale } from '@/lib/i18n/locales';
import { useLocale } from '@/lib/i18n/client';

export function LanguageSwitcher({ className = '' }: { className?: string }) {
  const current = useLocale();
  const [pending, setPending] = useState<Locale | null>(null);

  const pick = (next: Locale) => {
    if (next === current) return;
    setPending(next);
    // 1년 유지. path=/ 로 두면 대시보드·챗봇·다이제스트가 같은 값을 읽는다.
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    // router.refresh()로는 서버 컴포넌트가 그린 문구가 갱신되지 않는 경우가 있어(라우터 캐시)
    // 언어 전환만은 전체 새로고침으로 확실하게 바꾼다 — 자주 누르는 버튼이 아니다.
    window.location.reload();
  };

  return (
    <div
      className={`inline-flex items-center rounded-md border border-spark-border bg-white overflow-hidden ${className}`}
      role="group"
      aria-label="Language"
    >
      {LOCALES.map((loc) => {
        const active = loc === current;
        return (
          <button
            key={loc}
            type="button"
            onClick={() => pick(loc)}
            aria-pressed={active}
            title={LOCALE_LABELS[loc]}
            className={`px-2 py-0.5 text-[11px] font-bold tracking-wide transition ${
              active
                ? 'bg-spark-purple text-white'
                : 'text-spark-muted hover:text-spark-purple hover:bg-spark-subtle'
            } ${pending === loc ? 'opacity-60' : ''}`}
          >
            {loc.toUpperCase()}
          </button>
        );
      })}
    </div>
  );
}
