'use client';
// 기사 목록 뷰 — 검색(옵션) + 정렬(최신순/오래된순/매체 티어순) + CSV 내보내기.
// CSV: 날짜, 매체, 기사제목, URL (엑셀 한글 대응 BOM 포함).
import { useMemo, useState } from 'react';
import { ArticlesTable } from '@/components/ArticlesTable';
import { normalizeSource, TIER_OF } from '@/lib/sparkscope/media';

interface Article {
  id: string;
  title: string;
  link: string;
  source: string;
  pubDate: Date | string;
  matchedKeyword: string;
  category: string;
  importance: string | null;
  tone: string | null;
  pitchScore: number | null;
  isScrapped?: boolean;
}

type SortKey = 'recent' | 'oldest' | 'tier';

const CATEGORY_LABELS: Record<string, string> = {
  sparklabs_self: '스파크랩',
  portfolio_company: '포트폴리오',
  competitor: 'AC·VC',
  industry_trend: '스타트업계',
};

function ymd(d: Date | string): string {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}
function tierOf(source: string): number {
  return TIER_OF.get(normalizeSource(source)) ?? 99; // 미등록 매체는 맨 뒤
}
function csvCell(v: string): string {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function ArticleListView({ articles, canScrap = false, emptyText, showSearch = false, showCategory = false, csvName = 'sparkscope' }: {
  articles: Article[];
  canScrap?: boolean;
  emptyText?: string;
  showSearch?: boolean;
  showCategory?: boolean;
  csvName?: string;
}) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortKey>('recent');
  const [cat, setCat] = useState('');

  // 선택 가능한 분류: 현재 목록에 실제로 존재하는 카테고리만 (건수 포함)
  const catCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of articles) m.set(a.category, (m.get(a.category) ?? 0) + 1);
    return m;
  }, [articles]);

  const view = useMemo(() => {
    let list = articles;
    if (cat) list = list.filter(a => a.category === cat);
    if (showSearch && q.trim()) {
      const s = q.trim().toLowerCase();
      list = list.filter(a => {
        const catLabel = CATEGORY_LABELS[a.category] ?? a.category;
        return [a.title, a.source, a.matchedKeyword, a.category, catLabel]
          .some(v => String(v ?? '').toLowerCase().includes(s));
      });
    }
    const arr = [...list];
    if (sort === 'recent') arr.sort((a, b) => +new Date(b.pubDate) - +new Date(a.pubDate));
    else if (sort === 'oldest') arr.sort((a, b) => +new Date(a.pubDate) - +new Date(b.pubDate));
    else arr.sort((a, b) => tierOf(a.source) - tierOf(b.source) || (+new Date(b.pubDate) - +new Date(a.pubDate)));
    return arr;
  }, [articles, q, sort, cat, showSearch]);

  const downloadCsv = () => {
    const header = ['날짜', '매체', '기사제목', 'URL'];
    const body = view.map(a => [ymd(a.pubDate), normalizeSource(a.source), a.title, a.link]);
    const csv = [header, ...body].map(r => r.map(csvCell).join(',')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${csvName}_${ymd(new Date())}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const selCls = 'rounded-lg border border-spark-border px-2 py-1.5 text-sm focus:border-spark-purple focus:outline-none';

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {showSearch && (
          <div className="relative flex-1 min-w-[200px]">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔎</span>
            <input
              type="text"
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="제목·매체·회사명·분류로 검색"
              className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2 pl-9 pr-9 text-sm focus:border-spark-purple focus:bg-white focus:outline-none"
            />
            {q && (
              <button onClick={() => setQ('')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-0.5 text-xs text-gray-400 hover:bg-gray-100" aria-label="검색어 지우기">✕</button>
            )}
          </div>
        )}
        {showCategory && (
          <select value={cat} onChange={e => setCat(e.target.value)} className={selCls} aria-label="분류">
            <option value="">전체 분류</option>
            {['sparklabs_self', 'portfolio_company', 'competitor', 'industry_trend']
              .filter(c => (catCounts.get(c) ?? 0) > 0)
              .map(c => (
                <option key={c} value={c}>{CATEGORY_LABELS[c] ?? c} ({catCounts.get(c)})</option>
              ))}
          </select>
        )}
        <select value={sort} onChange={e => setSort(e.target.value as SortKey)} className={selCls} aria-label="정렬">
          <option value="recent">최신순</option>
          <option value="oldest">오래된순</option>
          <option value="tier">매체 티어순 (높은 티어 먼저)</option>
        </select>
        <button
          onClick={downloadCsv}
          className="rounded-lg border border-spark-purple bg-spark-light-purple/40 px-3 py-1.5 text-sm font-semibold text-spark-purple hover:bg-spark-light-purple/70 whitespace-nowrap"
          title="현재 목록을 CSV(날짜·매체·제목·URL)로 저장"
        >
          ⬇ CSV 내보내기
        </button>
      </div>

      {showSearch && q.trim() && (
        <div className="mb-2 text-xs text-gray-500">
          ‘<span className="font-semibold text-gray-700">{q.trim()}</span>’ 검색 결과 {view.length}건
        </div>
      )}

      <ArticlesTable
        articles={view as any}
        canScrap={canScrap}
        emptyText={showSearch && q.trim() ? `‘${q.trim()}’에 맞는 기사가 없습니다.` : emptyText}
      />
    </div>
  );
}
