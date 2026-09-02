'use client';
import { articleTitle } from '@/lib/sparkscope/article-title';
// 톤 분석 — 클릭 없이 세 논조(긍정/중립/부정)의 비율과 기사 목록이 한 화면에 바로 보인다.
import { useState } from 'react';
import { useT, useLocale } from '@/lib/i18n/client';
import { RISK_FLAGS } from '@/lib/sparkscope/risk-flags';
import { clusterArticles } from '@/lib/sparkscope/cluster';
import { safeArticleHref } from '@/lib/sparkscope/article-link';

interface ToneArticle {
  id: string;
  title: string;
  link: string;
  source: string;
  pubDate: Date | string;
  tone: string;
  riskFlag?: string | null;
  titleEn?: string | null;
}

const TONES = [
  { key: 'POSITIVE', label: '긍정', dot: 'bg-emerald-600', bar: 'bg-emerald-600', border: 'border-emerald-200', head: 'text-emerald-700', soft: 'bg-emerald-50/60 hover:bg-emerald-50' },
  { key: 'NEUTRAL', label: '중립', dot: 'bg-slate-400', bar: 'bg-slate-400', border: 'border-spark-border', head: 'text-spark-ink-soft', soft: 'bg-spark-subtle hover:bg-spark-subtle/70' },
  { key: 'NEGATIVE', label: '부정', dot: 'bg-red-500', bar: 'bg-red-500', border: 'border-red-200', head: 'text-red-700', soft: 'bg-red-50/60 hover:bg-red-50' },
];

export function ToneBreakdown({ articles }: { articles: ToneArticle[] }) {
  const tr = useT();
  const locale = useLocale();
  // 펼쳐진 클러스터(대표 기사 id) 집합 — "+N개 매체 더보기" 토글 상태.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const total = articles.length || 1;
  const groups = TONES.map(t => ({
    ...t,
    label: tr(t.label),
    // 비율/건수는 클러스터링 전 전체 기사 수 기준 유지 — "몇 건이 보도됐는지"라는 의미가 왜곡되지 않게.
    list: articles.filter(a => (a.tone || 'NEUTRAL') === t.key),
  }));

  return (
    <div className="space-y-4 mt-1">
      {/* 한눈에 보는 비율 — 하나의 막대에 세 논조를 이어붙여 전체 대비를 바로 비교 */}
      <div>
        <div className="flex h-3 w-full overflow-hidden rounded-full bg-spark-subtle">
          {groups.map(g => (
            g.list.length > 0 && (
              <span key={g.key} className={g.bar} style={{ width: `${(g.list.length / total) * 100}%` }} title={tr('{label} {n}건', { label: g.label, n: g.list.length })} />
            )
          ))}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs">
          {groups.map(g => (
            <span key={g.key} className="inline-flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${g.dot}`} />
              <span className="text-spark-ink-soft">{g.label}</span>
              <span className="font-semibold tabular-nums text-spark-ink">{g.list.length}</span>
              <span className="text-spark-muted">({Math.round((g.list.length / total) * 100)}%)</span>
            </span>
          ))}
        </div>
      </div>

      {/* 논조별 기사 — 클릭 없이 3열로 항상 펼쳐서 표시 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {groups.map(g => (
          <div key={g.key} className={`rounded-xl border ${g.border} overflow-hidden`}>
            <div className={`flex items-center justify-between px-3 py-2 text-xs font-bold ${g.head} bg-white`}>
              <span className="inline-flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${g.dot}`} />
                {g.label}
              </span>
              <span className="tabular-nums">{tr('{n}건', { n: g.list.length })}</span>
            </div>
            <div className="p-2 space-y-1.5 max-h-72 overflow-y-auto scroll-slim">
              {g.list.length === 0 ? (
                <p className="text-[11px] text-spark-muted px-1 py-2">{tr('해당 논조 기사 없음')}</p>
              ) : clusterArticles(g.list).map(c => {
                const d = new Date(c.rep.pubDate);
                const isOpen = expanded.has(c.rep.id);
                return (
                  <div key={c.rep.id} className={`rounded-lg border border-transparent ${g.soft} transition`}>
                    <a href={safeArticleHref(c.rep.link, c.rep.title, c.rep.source)} target="_blank" rel="noopener noreferrer" className="block p-2">
                      {c.rep.riskFlag && RISK_FLAGS[c.rep.riskFlag] && (
                        <span className={`inline-block mb-1 px-1.5 py-0.5 rounded text-[9px] font-semibold ${RISK_FLAGS[c.rep.riskFlag].cls}`}>
                          {tr(RISK_FLAGS[c.rep.riskFlag].label)}
                        </span>
                      )}
                      <div className="text-xs text-spark-ink leading-snug line-clamp-2">{articleTitle(c.rep, locale)}</div>
                      <div className="text-[10px] text-spark-muted mt-0.5">{tr(c.rep.source)} · {d.getMonth() + 1}.{d.getDate()}</div>
                    </a>
                    {c.others.length > 0 && (
                      <div className="px-2 pb-1.5 -mt-1">
                        <button
                          type="button"
                          onClick={() => toggle(c.rep.id)}
                          className="text-[10px] font-semibold text-spark-purple hover:underline"
                        >
                          {isOpen ? tr('접기 ▲') : tr('+{n}개 매체 더보기 ▼', { n: c.others.length })}
                        </button>
                        {isOpen && (
                          <div className="mt-1 space-y-1 border-l-2 border-spark-border pl-2">
                            {c.others.map(o => {
                              const od = new Date(o.pubDate);
                              return (
                                <a key={o.id} href={safeArticleHref(o.link, o.title, o.source)} target="_blank" rel="noopener noreferrer" className="block text-[10px] text-spark-muted hover:text-spark-ink">
                                  {tr(o.source)} · {od.getMonth() + 1}.{od.getDate()}
                                </a>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
