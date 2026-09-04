'use client';
/**
 * 뉴스 다이제스트 — Inter 탭 도메인 버튼과 조회 조건 사이.
 *
 * 소스별로 칸을 나누던 방식을 버렸다. X는 무료 경로가 없고 Reddit은 점수도 없이 429가
 * 잦아, 실제로 데이터를 주는 건 한 곳뿐이었다. 지금은 "어느 커뮤니티에서 떴나"가 아니라
 * "신뢰할 수 있는 매체들이 지금 뭘 다루나"를 보여준다.
 *
 * 각 항목은 제목 · 쉬운 말 요약 · 출처 링크로 이뤄진다. 요약은 업계 약어를 풀어 써서
 * 그 분야를 모르는 사람도 읽을 수 있게 한다.
 */
import { useEffect, useState } from 'react';
import { useT, useLocale } from '@/lib/i18n/client';
import type { DigestItem } from '@/lib/sparkscope/news-digest';

type Resp = {
  domain: 'ai' | 'bio';
  days: number;
  items: DigestItem[];
  feeds: { name: string; ok: boolean; count: number }[];
};

const RANGES = [
  { days: 1, label: '오늘' },
  { days: 7, label: '이번 주' },
  { days: 30, label: '이번 달' },
] as const;

export function NewsDigest({ domain }: { domain: 'bio' | 'ai' }) {
  const t = useT();
  const locale = useLocale();
  const [data, setData] = useState<Resp | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  // 기본 5건만 보여준다. 이 섹션은 Inter 탭 맨 위의 요약 배너라서
  // 12건을 다 펼치면 아래 조회 조건·본문이 한 화면에서 밀려난다.
  const [showAll, setShowAll] = useState(false);
  const [days, setDays] = useState<number>(7);

  useEffect(() => {
    let alive = true;
    setData(null);
    fetch(`/api/inter/digest?domain=${domain}&days=${days}`)
      .then(r => r.json())
      .then(d => { if (alive) setData(d); })
      .catch(() => { if (alive) setData({ domain, days, items: [], feeds: [] }); });
    return () => { alive = false; };
  }, [domain, days]);

  const live = (data?.feeds ?? []).filter(f => f.ok && f.count > 0);
  const down = (data?.feeds ?? []).filter(f => !f.ok);

  return (
    <div className="bg-white border border-spark-border rounded-2xl p-5 mb-6">
      <div className="flex flex-wrap items-baseline gap-2.5">
        <h2 className="text-[19px] font-extrabold tracking-tight">📰 {t('지금 주목받는 뉴스')}</h2>
        <span className="text-[13px] text-spark-muted">
          {t('여러 매체가 함께 다룬 순서로. 각 기사는 쉬운 말 요약과 원문 링크를 함께 보여줍니다.')}
        </span>
      </div>

      {/* 기간 */}
      <div className="flex flex-wrap items-center gap-1.5 mt-3">
        {RANGES.map(r => (
          <button
            key={r.days}
            type="button"
            onClick={() => setDays(r.days)}
            aria-pressed={days === r.days}
            className={`rounded-lg border px-3 py-1 text-[12.5px] font-semibold transition-colors ${
              days === r.days
                ? 'bg-spark-purple border-spark-purple text-white'
                : 'bg-white border-spark-border text-spark-muted hover:text-spark-ink-soft'
            }`}
          >
            {t(r.label)}
          </button>
        ))}
        {data && (
          <span className="text-[11.5px] text-spark-muted ml-1">
            {t('매체 {n}곳에서 수집', { n: live.length })}
            {down.length > 0 && ` · ${t('{n}곳 응답 없음', { n: down.length })}`}
          </span>
        )}
      </div>

      {data === null ? (
        <div className="mt-4 space-y-2">
          {[0, 1, 2, 3].map(i => <div key={i} className="h-20 rounded-xl bg-spark-subtle animate-pulse" />)}
        </div>
      ) : data.items.length === 0 ? (
        <p className="mt-4 text-[13px] text-spark-muted">{t('이 기간에 표시할 기사가 없습니다.')}</p>
      ) : (
        <ol className="mt-3 border border-spark-border rounded-xl overflow-hidden">
          {(showAll ? data.items : data.items.slice(0, 5)).map((it, i) => (
            <li key={it.url} className="border-b border-spark-border last:border-b-0 bg-white px-4 py-2.5">
              <div className="flex items-center gap-2 text-[11.5px] text-spark-muted mb-1">
                <span className="font-extrabold text-orange-600 tabular-nums">{i + 1}</span>
                <span className="font-semibold text-spark-ink-soft">{it.source}</span>
                {/* 개인 블로그·뉴스레터는 매체와 구분해 준다 — 편집을 거친 보도인지 아닌지 다르다. */}
                {it.independent && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded border border-spark-border text-spark-muted">
                    {t('개인·뉴스레터')}
                  </span>
                )}
                <span className="tabular-nums">{it.publishedAt}</span>
                {/* 여러 매체가 다뤘다는 것 자체가 중요도 신호다. */}
                {it.alsoIn.length > 0 && (
                  <span className="text-emerald-700 font-semibold">
                    {t('+{n}개 매체', { n: it.alsoIn.length })}
                  </span>
                )}
              </div>

              {/* 제목을 누르면 그 자리에서 펼쳐진다. 새 창으로 나가지 않고 먼저 읽어 보게 —
                  유료 매체가 많아 링크를 바로 누르면 페이월을 만나기 때문이다. */}
              <button
                type="button"
                onClick={() => setOpen(open === it.url ? null : it.url)}
                aria-expanded={open === it.url}
                className="block w-full text-left text-[14px] font-semibold leading-snug hover:text-spark-purple"
              >
                {/* 제목은 오른쪽 위 KO/EN 토글을 따라간다. 원문 제목은 원문 링크를 열면 보인다. */}
                {locale === 'ko' && it.summary?.titleKo ? it.summary.titleKo : it.title}
                <span className="ml-1.5 text-[11px] text-spark-muted font-normal">
                  {open === it.url ? '▲' : '▼'}
                </span>

              </button>

              {!it.summary ? (
                <p className="mt-1.5 text-[12px] text-spark-muted">{t('요약 준비 중 — 다음 조회에서 채워집니다.')}</p>
              ) : open === it.url ? (
                <div className="mt-2.5 rounded-xl bg-spark-subtle border border-spark-border p-4">
                  {/* 자세히 읽기 — 지금 언어를 먼저 보여주고, 다른 언어도 접어서 함께 둔다. */}
                  <div className="space-y-2.5">
                    {(locale === 'en' ? it.summary.enLong : it.summary.koLong).map((para, k) => (
                      <p key={k} className="text-[13.5px] leading-[1.78] text-spark-ink">{para}</p>
                    ))}
                  </div>
                  {it.blurb && (
                    <p className="mt-3 pt-3 border-t border-spark-border text-[11.5px] text-spark-muted">
                      <span className="font-semibold">{t('매체 요약')}</span> · {it.blurb}
                    </p>
                  )}
                  <p className="mt-3 text-[11px] text-spark-muted">
                    {t('원문이 아니라 이해를 돕는 설명입니다. 전문은 원문에서 확인하세요.')}
                    {/* 근거가 얇으면 숨기지 않고 밝힌다 — 유료 매체는 RSS에 티저만 준다. */}
                    {it.grounding === 'headline' && ` · ${t('이 매체는 제목과 짧은 소개만 공개해, 아래 설명은 일반적인 배경 위주입니다.')}`}
                  </p>
                </div>
              ) : (
                <p className="mt-1.5 text-[13px] leading-relaxed text-spark-ink-soft">
                  {locale === 'en' ? it.summary.en : it.summary.ko}
                </p>
              )}

              {/* 영향받을 만한 포트폴리오사 — 이 섹션이 사내에서 갖는 실제 쓸모다.
                  접힌 상태에서는 회사명만, 펼치면 이유까지 보여준다.
                  판정 결과가 빈 배열이면 아무것도 그리지 않는다(해당 없음이 정상). */}
              {it.portfolio && it.portfolio.length > 0 && (
                open === it.url ? (
                  <div className="mt-2 space-y-1.5">
                    {it.portfolio.map(h => (
                      <div key={h.company} className="text-[12px] leading-relaxed">
                        <span className="inline-block rounded bg-spark-light-purple text-spark-purple font-bold px-1.5 py-0.5 mr-1.5">
                          {h.company}
                        </span>
                        <span className="text-spark-ink-soft">{h.reason}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1">
                    <span className="text-[11px] text-spark-muted mr-0.5">{t('영향 가능')}</span>
                    {it.portfolio.map(h => (
                      <span key={h.company} className="text-[11px] font-bold rounded bg-spark-light-purple text-spark-purple px-1.5 py-0.5">
                        {h.company}
                      </span>
                    ))}
                  </div>
                )
              )}

              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px]">
                <a href={it.url} target="_blank" rel="noopener noreferrer" className="text-spark-purple hover:underline font-semibold">
                  {t('원문 보기')} ↗
                </a>
                {it.alsoIn.map(a => (
                  <a key={a.url} href={a.url} target="_blank" rel="noopener noreferrer"
                     className="text-spark-muted hover:text-spark-purple hover:underline">
                    {a.source} ↗
                  </a>
                ))}
              </div>
            </li>
          ))}
        </ol>
      )}

      {data && data.items.length > 5 && (
        <button
          type="button"
          onClick={() => setShowAll(v => !v)}
          className="mt-2.5 w-full rounded-lg border border-spark-border py-2 text-[12.5px] font-semibold text-spark-muted hover:text-spark-ink-soft hover:bg-spark-subtle"
        >
          {showAll ? t('접기') : t('{n}건 더 보기', { n: data.items.length - 5 })}
        </button>
      )}
    </div>
  );
}
