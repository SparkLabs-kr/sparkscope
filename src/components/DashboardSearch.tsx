'use client';
// 대시보드 검색: 검색창(달력 밑)과 기사목록(하단)이 떨어져 있어 Context로 상태 공유.
// 검색 대상: 제목 / 매체명 / 관련 회사(matchedKeyword) / 카테고리(코드+표시명). 지우면 원상복구.
import { createContext, useContext, useMemo, useState } from 'react';
import { ArticlesTable } from '@/components/ArticlesTable';

const SearchCtx = createContext<{ q: string; setQ: (s: string) => void }>({ q: '', setQ: () => {} });

const CATEGORY_LABELS: Record<string, string> = {
  sparklabs_self: '스파크랩',
  portfolio_company: '포트폴리오',
  competitor: 'AC·VC',
  industry_trend: '스타트업계',
};

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

export function DashboardSearchProvider({ children }: { children: React.ReactNode }) {
  const [q, setQ] = useState('');
  return <SearchCtx.Provider value={{ q, setQ }}>{children}</SearchCtx.Provider>;
}

export function DashboardSearchBox() {
  const { q, setQ } = useContext(SearchCtx);
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔎</span>
      <input
        type="text"
        value={q}
        onChange={e => setQ(e.target.value)}
        placeholder="기사 검색 — 제목·매체·회사명·분류로 실시간 필터 (아래 '최근 수집 기사'에 반영)"
        className="w-full rounded-lg border border-gray-200 bg-white py-2.5 pl-9 pr-9 text-sm shadow-sm focus:border-spark-purple focus:outline-none focus:ring-1 focus:ring-spark-purple"
      />
      {q && (
        <button
          onClick={() => setQ('')}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-0.5 text-xs text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          aria-label="검색어 지우기"
        >
          ✕ 지우기
        </button>
      )}
    </div>
  );
}

export function DashboardArticleList({ articles, canScrap = false, emptyText }: { articles: Article[]; canScrap?: boolean; emptyText?: string }) {
  const { q } = useContext(SearchCtx);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return articles;
    return articles.filter(a => {
      const catLabel = CATEGORY_LABELS[a.category] ?? a.category;
      return [a.title, a.source, a.matchedKeyword, a.category, catLabel]
        .filter(Boolean)
        .some(v => String(v).toLowerCase().includes(s));
    });
  }, [q, articles]);

  return (
    <div>
      {q.trim() && (
        <div className="mb-2 text-xs text-gray-500">
          ‘<span className="font-semibold text-gray-700">{q.trim()}</span>’ 검색 결과 {filtered.length}건
        </div>
      )}
      <ArticlesTable
        articles={filtered as any}
        canScrap={canScrap}
        emptyText={q.trim() ? `‘${q.trim()}’에 맞는 기사가 없습니다.` : emptyText}
      />
    </div>
  );
}
