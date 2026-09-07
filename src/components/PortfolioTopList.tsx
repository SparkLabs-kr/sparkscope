'use client';
/**
 * 가장 많이 언급된 포트폴리오사 TOP 15 — 회사명을 누르면 그 회사의 최근 기사를
 * 표 아래에 목록으로 펼쳐 보여준다.
 *
 * 원래는 회사명에 마우스를 올리면(CompanyNameWithPreview) 그 자리에 떠 있는
 * 팝오버로 기사를 보여줬는데, 팝오버가 아래 순위(11~15위 등) 위에 겹쳐 뜨고
 * 마우스가 살짝만 벗어나도 닫혀서 읽기 불편하다는 피드백(2026-09-07). 클릭으로
 * 고정 선택하고, 표 전체 아래 한 자리에 붙박이로 펼치는 방식으로 바꾼다.
 */
import { useState } from 'react';
import { useT, useLocale } from '@/lib/i18n/client';
import { articleTitle } from '@/lib/sparkscope/article-title';
import { safeArticleHref } from '@/lib/sparkscope/article-link';

interface TopItem {
  name: string;
  count: number;
  portfolioStatus?: string | null;
  changePct: number | null;
  recentArticles: { title: string; titleEn?: string | null; titleKo?: string | null; link: string; source: string; pubDate: Date | string }[];
}

function InfoTip({ text }: { text: string }) {
  return (
    <span className="relative inline-flex group align-middle" title={text}>
      <span className="text-[11px] cursor-help select-none">🔍</span>
      <span className="pointer-events-none absolute left-0 top-full z-30 mt-1 w-72 whitespace-pre-line rounded-lg bg-gray-900 px-3 py-2 text-xs font-normal leading-relaxed text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100">
        {text}
      </span>
    </span>
  );
}

function PortfolioStatusBadge({ status }: { status: string | null }) {
  if (!status || status === 'Live') return null;
  const cls = status === 'Exit'
    ? 'bg-blue-50 text-blue-600 border-blue-200'
    : 'bg-gray-100 text-gray-500 border-gray-200';
  return <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold border ${cls}`}>{status}</span>;
}

export function PortfolioTopList({ items, rangeLabel, prevRangeLabel, showChange }: {
  items: TopItem[]; rangeLabel: string; prevRangeLabel: string; showChange: boolean;
}) {
  const t = useT();
  const locale = useLocale();
  const max = Math.max(...items.map(i => i.count), 1);
  const [selected, setSelected] = useState<string | null>(null);
  const selectedItem = items.find(i => i.name === selected) ?? null;

  return (
    <div className="bg-white p-5 rounded-2xl border border-spark-border shadow-card">
      <div className="font-bold mb-1">
        🔥 {t('가장 많이 언급된 포트폴리오사 TOP 15')}{' '}
        <InfoTip text={t('{range} 동안 언론 노출(기사 수)이 많은 포트폴리오사 순위입니다.\n최근 홍보 활동이 활발하거나 이슈가 되고 있는 회사를 보여줍니다.\n증감은 선택한 기간과 같은 길이의 직전 기간 대비입니다 (예: 최근 7일 선택 시 직전 7일과 비교).\n회사명을 누르면 아래에 최근 기사가 펼쳐집니다.', { range: rangeLabel })} />
      </div>
      <div className="text-xs text-gray-500 mb-1">
        {t('{range} · 언론 노출 건수 기준', { range: rangeLabel })}
        {showChange ? ` · ${t('증감은 직전 기간({prev}) 대비', { prev: prevRangeLabel })}` : ` · ${t('선택 기간이 길어 직전 기간 데이터가 부족해 증감은 표시하지 않음')}`}
      </div>
      {/* 클릭하면 기사가 펼쳐진다는 걸 호버 툴팁 안에만 숨겨두지 않고 항상 보이게 —
          hover 팝오버를 없앤 지금, 클릭이 된다는 것 자체를 안내할 자리가 필요하다(2026-09-07). */}
      <div className="text-xs text-spark-purple font-medium mb-4">
        👆 {t('회사명을 누르면 아래에 최근 기사가 펼쳐집니다')}
      </div>
      {items.length > 0 ? (
        <div className="space-y-2">
          {items.map((it, i) => {
            const isSelected = selected === it.name;
            return (
              <button
                key={it.name}
                type="button"
                onClick={() => setSelected(isSelected ? null : it.name)}
                className={`w-full flex items-center gap-2 text-sm text-left rounded-lg px-1 py-0.5 -mx-1 transition-colors ${isSelected ? 'bg-spark-light-purple/40' : 'hover:bg-spark-subtle'}`}
              >
                <span className="w-5 text-right text-xs font-bold text-gray-400 tabular-nums">{i + 1}</span>
                <span className={`w-28 shrink-0 truncate font-semibold ${isSelected ? 'text-spark-purple' : 'text-gray-700'}`}>{t(it.name)}</span>
                <PortfolioStatusBadge status={it.portfolioStatus ?? null} />
                <div className="flex-1 h-4 bg-gray-100 rounded overflow-hidden">
                  <div className="h-full rounded bg-spark-purple/80" style={{ width: `${Math.round((it.count / max) * 100)}%` }} />
                </div>
                <span className="w-10 text-right font-bold tabular-nums">{it.count}</span>
                {showChange && (
                  <span className={`w-14 text-right text-xs font-semibold tabular-nums whitespace-nowrap ${
                    it.changePct === null ? 'text-blue-500' : it.changePct > 0 ? 'text-emerald-600' : it.changePct < 0 ? 'text-red-500' : 'text-gray-400'
                  }`}>
                    {it.changePct === null ? t('신규') : it.changePct === 0 ? '0%' : `${it.changePct > 0 ? '+' : ''}${it.changePct}%`}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-gray-400 py-8 text-center">{t('{range} 내 포트폴리오사 노출이 없습니다.', { range: rangeLabel })}</p>
      )}

      {/* 선택한 회사의 최근 기사 — 표 전체 아래 고정된 한 자리에 펼친다 */}
      {selectedItem && (
        <div className="mt-4 pt-4 border-t border-spark-border">
          <div className="text-xs font-semibold text-spark-purple mb-2">
            📰 {t(selectedItem.name)} — {t('최근 기사')}
          </div>
          {selectedItem.recentArticles.length > 0 ? (
            <div className="space-y-1.5">
              {selectedItem.recentArticles.map((a, i) => {
                const d = new Date(a.pubDate);
                return (
                  <a
                    key={i}
                    href={safeArticleHref(a.link, a.title, a.source)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block rounded-lg border border-spark-border bg-spark-subtle/60 px-3 py-2 hover:bg-spark-subtle transition-colors"
                  >
                    <div className="text-xs text-spark-ink leading-snug line-clamp-2">{articleTitle(a, locale)}</div>
                    <div className="text-[10px] text-spark-muted mt-0.5">{t(a.source)} · {d.getMonth() + 1}.{d.getDate()}</div>
                  </a>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-spark-muted py-3">{t('최근 기사가 없습니다.')}</p>
          )}
        </div>
      )}
    </div>
  );
}
