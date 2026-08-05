'use client';

// 경쟁사 모니터링 패널 — 상단에 전체 총평 + 통합 막대 비교, 하단에 경쟁사별 카드.
// 막대의 회사명을 누르면 아래 해당 카드가 파란색으로 하이라이트되고 화면에 잡힌다.
import { useState } from 'react';
import type { CompetitorFundSummary } from '@/lib/sparkscope/fund-db';
import type { FundItem } from '@/lib/sparkscope/fund-db';
import { safeArticleHref } from '@/lib/sparkscope/article-link';
import { clusterArticles } from '@/lib/sparkscope/cluster';

export interface CompetitorArticleView {
  id: string;
  title: string;
  source: string;
  pubDate: string | Date;
  link: string;
  neg: boolean;
}

export interface CompetitorStatView {
  name: string;
  english: string;
  count: number;
  negCount: number;
  articles: CompetitorArticleView[];
  negatives: CompetitorArticleView[];
  /** AI 트렌드 3줄 (실패 시 null) */
  trend: string[] | null;
  /** SLAB DB 펀드 요약 (매핑 없으면 null) */
  fundSummary?: CompetitorFundSummary | null;
}

function computeDday(maturityDateIso: string): number {
  const mat = new Date(maturityDateIso);
  mat.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.ceil((mat.getTime() - today.getTime()) / 86400000);
}

function cardId(name: string) {
  // 한글·공백이 섞인 회사명을 DOM id로 쓰기 위해 인코딩
  return `comp-card-${encodeURIComponent(name)}`;
}

export function CompetitorPanel({
  competitors,
  cardCompetitors,
  sparklabsMentions,
  rangeLabel,
  overallTrend,
  sparkLabsAum,
}: {
  competitors: CompetitorStatView[];
  cardCompetitors?: CompetitorStatView[];
  sparklabsMentions: number;
  rangeLabel: string;
  overallTrend: string[] | null;
  sparkLabsAum?: number;
}) {
  const cards = cardCompetitors ?? competitors;
  const [selected, setSelected] = useState<string | null>(null);
  const max = Math.max(sparklabsMentions, ...competitors.map(c => c.count), 1);
  const totalComp = competitors.reduce((s, c) => s + c.count, 0);

  const handleSelect = (name: string) => {
    setSelected(prev => (prev === name ? null : name));
    // 카드가 화면 밖이면 스크롤로 끌어온다
    const el = document.getElementById(cardId(name));
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  return (
    <div className="bg-white p-5 rounded-2xl border border-spark-border shadow-card">
      <div className="flex flex-wrap justify-between items-center gap-2 mb-1">
        <div className="font-bold text-xl">🏁 경쟁사 모니터링 — 언론 노출 상위</div>
        <span className="px-2.5 py-1 bg-spark-light-purple/50 text-spark-purple rounded-full text-sm font-semibold whitespace-nowrap">
          TOP {cards.length} · {rangeLabel}
        </span>
      </div>
      <p className="text-base text-gray-500 mb-4">
        스파크랩과 실제 수집된 경쟁 하우스의 언론 노출량·최근 이슈를 한눈에 비교합니다.
      </p>

      {/* 전체 총평 — 경쟁사들이 전반적으로 어떻게 움직이는지 */}
      {overallTrend && overallTrend.length > 0 && (
        <div className="mb-5 rounded-xl border-l-4 border-spark-purple bg-spark-light-purple/30 px-5 py-4">
          <div className="text-sm font-bold text-spark-purple mb-2">📌 이 기간 경쟁사 총평</div>
          <div className="space-y-1.5">
            {overallTrend.map((line, i) => (
              <p key={i} className="text-base leading-relaxed text-spark-ink">{line}</p>
            ))}
          </div>
        </div>
      )}

      {/* 통합 막대 비교 — 스파크랩 기준선 아래에 경쟁사 막대를 모두 붙여 한 축에서 비교 */}
      <div className="mb-5">
        <CompareRow label="스파크랩 (기준)" count={sparklabsMentions} max={max} color="bg-spark-purple" strong />
        <div className="mt-1.5 space-y-1">
          {competitors.map(c => (
            <CompareRow
              key={c.name}
              label={c.name}
              count={c.count}
              max={max}
              color="bg-slate-400"
              selected={selected === c.name}
              onSelect={() => handleSelect(c.name)}
            />
          ))}
        </div>
      </div>

      {totalComp > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-start">
          {cards.map(c => (
            <CompetitorCard key={c.name} c={c} selected={selected === c.name} />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-8 text-center text-base text-gray-500">
          선택 기간에 집계된 경쟁사 기사가 아직 없습니다. 뉴스 수집이 진행되면 경쟁사별 언급량과 최근 이슈가 여기에 표시됩니다.
        </div>
      )}

      {/* AUM 비교 — 스파크랩 기준 + 카드 경쟁사 펀드 AUM */}
      {(() => {
        const aumItems = [
          ...(sparkLabsAum !== undefined ? [{ name: '스파크랩', aum: sparkLabsAum, isSelf: true }] : []),
          ...cards
            .filter(c => c.fundSummary && c.fundSummary.totalAum > 0)
            .map(c => ({ name: c.name, aum: c.fundSummary!.totalAum, isSelf: false }))
            .sort((a, b) => b.aum - a.aum),
        ];
        const maxAum = Math.max(...aumItems.map(i => i.aum), 1);
        if (aumItems.length === 0) return null;
        return (
          <div className="mt-6 pt-5 border-t border-spark-border">
            <div className="font-bold mb-3">📊 경쟁사 AUM 비교</div>
            <div className="space-y-1.5">
              {aumItems.map(item => (
                <div key={item.name} className="flex items-center gap-2 text-sm min-w-0">
                  <div className={`flex-shrink-0 w-28 sm:w-44 truncate text-left ${item.isSelf ? 'font-bold text-spark-purple' : 'text-gray-600'}`}>
                    {item.name}
                  </div>
                  <div className="flex-1 h-5 rounded overflow-hidden min-w-0 bg-gray-100">
                    <div
                      className={`h-full rounded ${item.isSelf ? 'bg-spark-purple' : 'bg-slate-400'}`}
                      style={{ width: `${Math.round((item.aum / maxAum) * 100)}%` }}
                    />
                  </div>
                  <div className="flex-shrink-0 w-20 text-right tabular-nums font-semibold text-spark-muted">
                    {item.aum.toLocaleString()}억
                  </div>
                </div>
              ))}
              {cards.filter(c => !c.fundSummary || c.fundSummary.totalAum === 0).map(c => (
                <div key={c.name} className="flex items-center gap-2 text-sm min-w-0 opacity-50">
                  <div className="flex-shrink-0 w-28 sm:w-44 truncate text-gray-400">{c.name}</div>
                  <div className="flex-1 text-xs text-gray-400 italic">미등록</div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function CompareRow({
  label, count, max, color, strong, selected, onSelect,
}: {
  label: string;
  count: number;
  max: number;
  color: string;
  strong?: boolean;
  selected?: boolean;
  onSelect?: () => void;
}) {
  const pct = Math.round((count / max) * 100);
  const clickable = !!onSelect;

  const row = (
    <>
      <div
        className={`flex-shrink-0 w-24 sm:w-44 truncate text-left transition-colors ${
          strong ? 'font-bold text-spark-purple' : selected ? 'font-bold text-spark-purple' : 'text-gray-600'
        }`}
      >
        {label}
      </div>
      <div className={`flex-1 h-6 rounded overflow-hidden min-w-0 ${selected ? 'bg-spark-light-purple' : 'bg-gray-100'}`}>
        <div
          className={`h-full rounded transition-colors ${selected ? 'bg-spark-purple' : color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className={`flex-shrink-0 w-14 text-right font-semibold tabular-nums ${selected ? 'text-spark-purple' : ''}`}>
        {count}건
      </div>
    </>
  );

  if (!clickable) {
    return <div className="flex items-center gap-2 text-base min-w-0">{row}</div>;
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`w-full flex items-center gap-2 text-base min-w-0 rounded-lg px-1.5 py-1 -mx-1.5 transition-colors ${
        selected ? 'bg-spark-light-purple/40' : 'hover:bg-spark-subtle'
      }`}
    >
      {row}
    </button>
  );
}

type TabKey = '트렌드' | '기사' | '펀드';

function CompetitorCard({ c, selected }: { c: CompetitorStatView; selected: boolean }) {
  const [tab, setTab] = useState<TabKey>('트렌드');
  // "기사" 탭에서 같은 사건·다른 매체로 묶인 클러스터의 "+N개 매체 더보기" 펼침 상태.
  const [expandedArticles, setExpandedArticles] = useState<Set<string>>(new Set());
  const toggleArticleCluster = (id: string) => setExpandedArticles(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const hasNeg = c.negCount > 0;
  const hasFund = !!(c.fundSummary && c.fundSummary.fundCount > 0);

  const frame = selected
    ? 'border-spark-purple bg-spark-light-purple/30 ring-2 ring-spark-purple/30'
    : 'border-gray-400 bg-white';

  const tabs: TabKey[] = ['트렌드', '기사', '펀드'];

  return (
    <div id={cardId(c.name)} className={`rounded-xl border-2 p-4 scroll-mt-24 transition-colors ${frame}`}>
      {/* 헤더 */}
      <div className="flex items-center gap-2 mb-2 min-w-0">
        <div className="text-lg font-bold text-spark-ink flex-1 min-w-0 truncate">
          {c.name}{' '}
          {c.english && <span className="text-sm font-normal text-spark-muted">{c.english}</span>}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0 whitespace-nowrap">
          {hasNeg && (
            <span className="text-sm px-2 py-0.5 rounded-full bg-red-100 text-red-600 font-bold">
              부정 {c.negCount}
            </span>
          )}
          <span className="text-lg font-bold text-spark-ink tabular-nums">
            {c.count}<span className="text-sm text-spark-muted font-normal">건</span>
          </span>
        </div>
      </div>

      {/* 부정 기사 — 탭 위에 항상 표시 */}
      {hasNeg && c.negatives.length > 0 && (
        <div className="mb-3 rounded-lg border border-red-100 bg-red-50/50 px-3 py-2">
          <div className="text-xs font-semibold text-red-500 mb-1.5">⚠️ 부정 기사 {c.negCount}건</div>
          <div className="space-y-1.5 max-h-32 overflow-y-auto scroll-slim pr-1">
            {c.negatives.map((a, i) => {
              const d = new Date(a.pubDate);
              return (
                <a key={i} href={safeArticleHref(a.link, a.title, a.source)} target="_blank" rel="noopener noreferrer" className="block hover:opacity-80">
                  <div className="text-sm text-spark-ink leading-snug line-clamp-2">{a.title}</div>
                  <div className="text-xs text-spark-muted mt-0.5">{a.source} · {d.getMonth() + 1}.{d.getDate()}</div>
                </a>
              );
            })}
          </div>
        </div>
      )}

      {/* 탭 */}
      <div className="flex border-b border-spark-border mb-3">
        {tabs.map(t => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t
                ? 'border-spark-purple text-spark-purple'
                : 'border-transparent text-spark-muted hover:text-spark-ink'
            }`}
          >
            {t === '펀드' && hasFund ? `펀드 ${c.fundSummary!.fundCount}개` : t}
          </button>
        ))}
      </div>

      {/* 탭 콘텐츠 */}
      {tab === '트렌드' && (
        c.trend && c.trend.length > 0 ? (
          <ul className="space-y-1 rounded-lg bg-blue-50 px-3 py-2.5">
            {c.trend.map((t, i) => (
              <li key={i} className="text-sm leading-relaxed text-spark-ink-soft flex gap-1.5">
                <span className="text-blue-500 flex-shrink-0">•</span>
                <span>{t}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-spark-muted/70">트렌드 분석 없음</p>
        )
      )}

      {tab === '기사' && (
        c.articles.length > 0 ? (
          <div className="space-y-2 max-h-96 overflow-y-auto scroll-slim pr-1">
            {clusterArticles(c.articles).map(cl => {
              const a = cl.rep;
              const d = new Date(a.pubDate);
              const isOpen = expandedArticles.has(a.id);
              return (
                <div key={a.id}>
                  <a href={safeArticleHref(a.link, a.title, a.source)} target="_blank" rel="noopener noreferrer" className="block group">
                    <div className={`text-sm leading-snug line-clamp-2 group-hover:text-spark-purple ${a.neg ? 'text-red-700' : 'text-spark-ink-soft'}`}>
                      {a.title}
                    </div>
                    <div className="text-xs text-spark-muted mt-0.5">{a.source} · {d.getMonth() + 1}.{d.getDate()}</div>
                  </a>
                  {cl.others.length > 0 && (
                    <div className="mt-0.5">
                      <button
                        type="button"
                        onClick={() => toggleArticleCluster(a.id)}
                        className="text-xs font-semibold text-spark-purple hover:underline"
                      >
                        {isOpen ? '접기 ▲' : `+${cl.others.length}개 매체 더보기 ▼`}
                      </button>
                      {isOpen && (
                        <div className="mt-1 space-y-1 border-l-2 border-spark-border pl-2">
                          {cl.others.map(o => {
                            const od = new Date(o.pubDate);
                            return (
                              <a key={o.id} href={safeArticleHref(o.link, o.title, o.source)} target="_blank" rel="noopener noreferrer" className="block text-xs text-spark-muted hover:text-spark-ink">
                                {o.source} · {od.getMonth() + 1}.{od.getDate()}
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
        ) : (
          <p className="text-sm text-spark-muted/70">최근 기사 없음</p>
        )
      )}

      {tab === '펀드' && (
        hasFund ? (
          <div>
            <div className="flex gap-3 mb-2 text-sm">
              <span className="font-semibold text-spark-ink">{c.fundSummary!.fundCount}개 펀드</span>
              {c.fundSummary!.totalAum > 0 && (
                <span className="text-spark-muted">총 AUM {c.fundSummary!.totalAum.toLocaleString()}억</span>
              )}
            </div>
            <div className="space-y-1.5 max-h-52 overflow-y-auto pr-0.5">
              {c.fundSummary!.funds.map((f, i) => (
                <div key={i} className="rounded-lg bg-indigo-50 px-3 py-2">
                  <div className="text-sm text-spark-ink leading-snug">{f.name}</div>
                  <div className="flex gap-2 mt-0.5">
                    {f.vintage && <span className="text-xs text-indigo-500 font-medium tabular-nums">{f.vintage}년</span>}
                    {f.aum > 0 && <span className="text-xs text-indigo-500 tabular-nums">{f.aum.toLocaleString()}억</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-sm text-spark-muted/70">펀드 데이터 없음</p>
        )
      )}
    </div>
  );
}
