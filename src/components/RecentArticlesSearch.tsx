'use client';
// 최근 수집 기사 실시간 검색 필터.
// 검색 대상: 제목 / 매체명 / 관련 회사(matchedKeyword) / 카테고리(코드+표시명).
// 검색어를 지우면 원상복구.
import { useMemo, useState } from 'react';
import { ArticlesTable } from '@/components/ArticlesTable';

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

const CATEGORY_LABELS: Record<string, string> = {
  sparklabs_self: '스파크랩',
  portfolio_company: '포트폴리오',
  competitor: 'AC·VC',
  industry_trend: '스타트업계',
};

export function RecentArticlesSearch({ articles, canScrap = false, emptyText }: { articles: Article[]; canScrap?: boolean; emptyText?: string }) {
  const [q, setQ] = useState('');

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
      <div className="relative mb-3">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔎</span>
        <input
          type="text"
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="제목·매체·회사명·분류로 검색 (실시간 필터)"
          className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2 pl-9 pr-9 text-sm focus:border-spark-purple focus:bg-white focus:outline-none focus:ring-1 focus:ring-spark-purple"
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
