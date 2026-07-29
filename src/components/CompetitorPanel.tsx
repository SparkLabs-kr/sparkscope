'use client';

// 경쟁사 모니터링 패널 — 상단에 전체 총평 + 통합 막대 비교, 하단에 경쟁사별 카드.
// 막대의 회사명을 누르면 아래 해당 카드가 파란색으로 하이라이트되고 화면에 잡힌다.
import { useState } from 'react';

export interface CompetitorArticleView {
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
  top3: CompetitorArticleView[];
  negatives: CompetitorArticleView[];
  /** AI 트렌드 3줄 (실패 시 null) */
  trend: string[] | null;
}

function cardId(name: string) {
  // 한글·공백이 섞인 회사명을 DOM id로 쓰기 위해 인코딩
  return `comp-card-${encodeURIComponent(name)}`;
}

export function CompetitorPanel({
  competitors,
  sparklabsMentions,
  rangeLabel,
  overallTrend,
}: {
  competitors: CompetitorStatView[];
  sparklabsMentions: number;
  rangeLabel: string;
  overallTrend: string[] | null;
}) {
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
          TOP {competitors.length} · {rangeLabel}
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
          {competitors.map(c => (
            <CompetitorCard key={c.name} c={c} selected={selected === c.name} />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-8 text-center text-base text-gray-500">
          선택 기간에 집계된 경쟁사 기사가 아직 없습니다. 뉴스 수집이 진행되면 경쟁사별 언급량과 최근 이슈가 여기에 표시됩니다.
        </div>
      )}
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

function CompetitorCard({ c, selected }: { c: CompetitorStatView; selected: boolean }) {
  const hasNeg = c.negCount > 0;

  // 카드 색은 선택 여부로만 구분 (부정 기사 유무는 뱃지로만 표시)
  const frame = selected
    ? 'border-spark-purple bg-spark-light-purple/30 ring-2 ring-spark-purple/30'
    : 'border-gray-400 bg-white';

  return (
    <div id={cardId(c.name)} className={`rounded-xl border-2 p-4 scroll-mt-24 transition-colors ${frame}`}>
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

      {/* 이 기간 트렌드 3줄 */}
      {c.trend && c.trend.length > 0 && (
        <ul className="mb-3 space-y-1 rounded-lg bg-blue-50 px-3 py-2.5">
          {c.trend.map((t, i) => (
            <li key={i} className="text-sm leading-relaxed text-spark-ink-soft flex gap-1.5">
              <span className="text-blue-500 flex-shrink-0">•</span>
              <span>{t}</span>
            </li>
          ))}
        </ul>
      )}

      {c.top3.length > 0 ? (
        <>
          <div className="text-sm font-semibold text-spark-muted mb-1.5">최근 기사 TOP {c.top3.length}</div>
          <div className="space-y-2">
            {c.top3.map((a, i) => {
              const d = new Date(a.pubDate);
              return (
                <a key={i} href={a.link} target="_blank" rel="noopener noreferrer" className="block group">
                  <div className={`text-base leading-snug line-clamp-2 group-hover:text-spark-purple ${a.neg ? 'text-red-700' : 'text-spark-ink-soft'}`}>
                    {a.neg && '⚠️ '}{a.title}
                  </div>
                  <div className="text-sm text-spark-muted mt-0.5">{a.source} · {d.getMonth() + 1}.{d.getDate()}</div>
                </a>
              );
            })}
          </div>

          {/* 부정 기사 섹션 — 기존 형태 유지 */}
          {c.negatives.length > 0 && (
            <div className="mt-2.5 pt-2.5 border-t border-spark-border/60">
              <div className="text-sm font-semibold text-red-500 mb-1.5">⚠️ 부정 기사 전체 {c.negatives.length}건</div>
              <div className="space-y-1.5 max-h-52 overflow-y-auto scroll-slim pr-1">
                {c.negatives.map((a, i) => {
                  const d = new Date(a.pubDate);
                  return (
                    <a key={i} href={a.link} target="_blank" rel="noopener noreferrer" className="block rounded-lg border border-red-100 bg-red-50/50 p-2 hover:bg-red-50 transition-colors">
                      <div className="text-base text-spark-ink leading-snug line-clamp-2">{a.title}</div>
                      <div className="text-sm text-spark-muted mt-0.5">{a.source} · {d.getMonth() + 1}.{d.getDate()}</div>
                    </a>
                  );
                })}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="text-base text-spark-muted/70">최근 기사 없음</div>
      )}
    </div>
  );
}
