'use client';
/**
 * 소셜 시그널 — Inter 탭 도메인 버튼과 조회 기간 사이에 들어가는 섹션.
 *
 * 소스마다 "인기순인지 최신순인지"를 배지로 드러낸다. Reddit은 자격증명이 없으면
 * 점수를 못 받아 최신순이 되는데, 그걸 숨기면 순위가 아닌 목록을 순위로 오해하게 된다.
 */
import { useEffect, useState } from 'react';
import { useT } from '@/lib/i18n/client';
import type { SocialSource } from '@/lib/sparkscope/social-collect';

const ICON: Record<string, string> = { x: '𝕏', hn: 'Y', reddit: '👽' };

export function SocialSignals({ domain, from }: { domain: 'bio' | 'ai'; from: string }) {
  const t = useT();
  const [sources, setSources] = useState<SocialSource[] | null>(null);

  useEffect(() => {
    let alive = true;
    setSources(null);
    fetch(`/api/inter/social?domain=${domain}&from=${from}`)
      .then(r => r.json())
      .then(d => { if (alive) setSources(d.sources ?? []); })
      .catch(() => { if (alive) setSources([]); });
    return () => { alive = false; };
  }, [domain, from]);

  return (
    <div className="bg-white border border-spark-border rounded-2xl p-5 mb-6">
      <div className="flex flex-wrap items-baseline gap-2.5 mb-1">
        <h2 className="text-[19px] font-extrabold tracking-tight">🔥 {t('소셜 시그널')}</h2>
        <span className="text-[13px] text-spark-muted">
          {t('X · Reddit · Hacker News에서 이 분야에서 가장 화제인 글')}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5 mt-4">
        {sources === null
          ? [0, 1, 2].map(i => (
              <div key={i} className="h-64 rounded-xl border border-spark-border bg-spark-subtle animate-pulse" />
            ))
          : sources.map(s => (
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
                <div className="px-4 py-2.5 text-[12px] leading-relaxed text-spark-ink-soft border-b border-spark-border">
                  {s.note}
                </div>

                {s.posts.length === 0 ? (
                  <div className="px-4 py-10 text-center text-[13px] text-spark-muted bg-white">
                    {s.connected ? t('해당 기간 글이 없습니다.') : t('연결되면 여기에 표시됩니다.')}
                  </div>
                ) : (
                  s.posts.map((p, i) => (
                    <a key={p.url} href={p.url} target="_blank" rel="noopener noreferrer"
                       className="block px-4 py-2.5 border-b border-spark-border last:border-b-0 bg-white hover:bg-spark-subtle">
                      <div className="flex items-center gap-2 text-[11.5px] text-spark-muted mb-0.5">
                        <span className="font-extrabold text-orange-600">{i + 1}</span>
                        {p.origin && <span>{p.origin}</span>}
                        <span className="tabular-nums">{p.date}</span>
                      </div>
                      <div className="text-[13.5px] font-semibold leading-snug line-clamp-2">{p.title}</div>
                      {typeof p.points === 'number' && (
                        <div className="flex items-center gap-2 mt-1 text-[11.5px] text-spark-muted">
                          <span>▲ <b className="text-orange-600 tabular-nums">{p.points}</b></span>
                          <span>💬 <span className="tabular-nums">{p.comments ?? 0}</span></span>
                        </div>
                      )}
                    </a>
                  ))
                )}
              </div>
            ))}
      </div>
    </div>
  );
}
