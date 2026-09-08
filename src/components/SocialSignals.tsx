'use client';
/**
 * 소셜 시그널 — Inter 탭 상단, '지금 주목받는 뉴스'와 2분할로 나란히 놓인다.
 *
 * 소스마다 "인기순인지 최신순인지"를 배지로 드러낸다. Reddit은 자격증명이 없으면
 * 점수를 못 받아 최신순이 되는데, 그걸 숨기면 순위가 아닌 목록을 순위로 오해하게 된다.
 *
 * 각 커뮤니티가 왜 여기 있는지(why)도 함께 보여준다 — "왜 하필 이 매체냐"는 질문이
 * 반복돼서, 답을 화면에 붙여 뒀다(2026-09-04).
 */
import { useEffect, useState } from 'react';
import { useT, useLocale } from '@/lib/i18n/client';
import type { SocialSource } from '@/lib/sparkscope/social-collect';

const ICON: Record<string, string> = { hn: 'Y', reddit: '👽' };

/** 처음에 보여줄 글 수. (2026-09-08: 전체 폭을 쓰게 되면서 3건 → 5건) */
const PREVIEW = 5;

export function SocialSignals({ domain, from }: { domain: 'bio' | 'ai'; from: string }) {
  const t = useT();
  const locale = useLocale();
  const [sources, setSources] = useState<SocialSource[] | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let alive = true;
    setSources(null);
    fetch(`/api/inter/social?domain=${domain}&from=${from}&lang=${locale}`)
      .then(r => r.json())
      .then(d => { if (alive) setSources(d.sources ?? []); })
      .catch(() => { if (alive) setSources([]); });
    return () => { alive = false; };
  }, [domain, from, locale]);

  return (
    <div className="bg-white border border-spark-border rounded-2xl p-5 h-full">
      <div className="flex flex-wrap items-baseline gap-2.5 mb-1">
        <h2 className="text-[19px] font-extrabold tracking-tight">🔥 {t('소셜 시그널')}</h2>
        <span className="text-[13px] text-spark-muted">
          {t('지금 소셜 미디어에서 가장 주목해야 할 뉴스')}
        </span>
      </div>

      {/* 소스를 가로로 늘어놓아 전체 폭을 채운다 — 세로로 쌓으면 오른쪽이 통째로 비었다. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 mt-4 items-start">
        {sources === null
          ? [0, 1].map(i => (
              <div key={i} className="h-56 rounded-xl border border-spark-border bg-spark-subtle animate-pulse" />
            ))
          : sources.map(s => {
              const open = expanded[s.id] ?? false;
              const shown = open ? s.posts : s.posts.slice(0, PREVIEW);
              return (
                <div key={s.id} className="border border-spark-border rounded-xl overflow-hidden bg-spark-subtle">
                  <div className="flex items-center gap-2 px-4 py-3 border-b border-spark-border bg-white">
                    <b className="text-[15px] font-extrabold">{ICON[s.id] ?? ''} {s.label}</b>
                    <span className={`ml-auto text-[11px] font-bold px-2 py-0.5 rounded-md border ${
                      !s.connected ? 'bg-amber-50 text-amber-700 border-amber-200'
                      : s.ranked ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : 'bg-slate-50 text-slate-600 border-slate-200'}`}>
                      {s.connected ? (s.ranked ? t('인기순') : t('최신순')) : t('연결 필요')}
                    </span>
                  </div>

                  {/* 왜 이 커뮤니티인가 — 목록보다 먼저 읽히게 위에 둔다. */}
                  <div className="px-4 py-2.5 text-[12px] leading-relaxed text-spark-ink-soft border-b border-spark-border bg-white/60">
                    {t(s.why)}
                  </div>
                  <div className="px-4 py-2 text-[11.5px] leading-relaxed text-spark-muted border-b border-spark-border">
                    {t(s.note)}
                  </div>

                  {s.posts.length === 0 ? (
                    <div className="px-4 py-10 text-center text-[13px] text-spark-muted bg-white">
                      {s.connected ? t('해당 기간 글이 없습니다.') : t('연결되면 여기에 표시됩니다.')}
                    </div>
                  ) : (
                    <>
                      {shown.map((p, i) => (
                        <a key={p.url} href={p.url} target="_blank" rel="noopener noreferrer"
                           className="block px-4 py-2.5 border-b border-spark-border last:border-b-0 bg-white hover:bg-spark-subtle">
                          <div className="flex items-center gap-2 text-[11.5px] text-spark-muted mb-0.5">
                            <span className="font-extrabold text-orange-600">{i + 1}</span>
                            {p.origin && <span>{p.origin}</span>}
                            <span className="tabular-nums">{p.date}</span>
                          </div>
                          {/* 한국어 화면에서는 번역 제목을 쓰되, 원문도 작게 함께 둔다 —
                              검색하거나 원문을 찾을 때 영어 제목이 필요하다. */}
                          <div className="text-[14px] font-semibold leading-snug line-clamp-2">
                            {locale === 'ko' && p.titleKo ? p.titleKo : p.title}
                          </div>
                          {locale === 'ko' && p.titleKo && (
                            <div className="mt-0.5 text-[11px] text-spark-muted line-clamp-1">{p.title}</div>
                          )}
                          {typeof p.points === 'number' && (
                            <div className="flex items-center gap-2 mt-1 text-[11.5px] text-spark-muted">
                              <span>▲ <b className="text-orange-600 tabular-nums">{p.points}</b></span>
                              <span>💬 <span className="tabular-nums">{p.comments ?? 0}</span></span>
                            </div>
                          )}
                        </a>
                      ))}
                      {s.posts.length > PREVIEW && (
                        <button
                          type="button"
                          onClick={() => setExpanded(v => ({ ...v, [s.id]: !open }))}
                          className="w-full bg-white py-2 text-[12px] font-semibold text-spark-muted hover:text-spark-ink-soft hover:bg-spark-subtle border-t border-spark-border"
                        >
                          {open ? t('접기') : t('{n}건 더 보기', { n: s.posts.length - PREVIEW })}
                        </button>
                      )}
                    </>
                  )}
                </div>
              );
            })}
      </div>
    </div>
  );
}
