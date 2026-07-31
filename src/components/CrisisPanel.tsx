'use client';
// 실시간 위기 감지 카드 목록 — 위기 카드가 많으면 개별 카드 대신 AI 종합요약을 먼저 보여주고
// "더보기"로 접어서 화면 공간을 아낀다 (카드 수가 적으면 그냥 다 펼쳐서 보여준다).
import { useState } from 'react';
import { safeArticleHref } from '@/lib/sparkscope/article-link';

interface CrisisArticle { title: string; source: string; pubDate: Date | string; link: string }
interface Crisis { company: string; negCount: number; cause: string; article: CrisisArticle }

export function CrisisPanel({ crises, overview, windowDays, summaryThreshold }: {
  crises: Crisis[];
  overview: string | null;
  windowDays: number;
  summaryThreshold: number;
}) {
  const [open, setOpen] = useState(false);

  if (crises.length === 0) {
    return (
      <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
        🟢 최근 {windowDays}일 내 감지된 포트폴리오 위기가 없습니다.
        <span className="text-green-600"> 부정 기사가 급증하면 이 자리에 회사별 위기 카드가 자동으로 표시됩니다.</span>
      </div>
    );
  }

  if (crises.length <= summaryThreshold) {
    return (
      <div className="space-y-3">
        {crises.map(c => <CrisisCardView key={c.company} c={c} windowDays={windowDays} />)}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
        <div className="text-sm font-bold text-red-900 mb-1">🚨 {crises.length}개사에서 위기 감지</div>
        <div className="text-sm text-red-800 leading-relaxed">
          {overview ?? `${crises.map(c => c.company).join(', ')} 관련 부정 기사가 최근 ${windowDays}일 내 급증했습니다.`}
        </div>
        <button type="button" onClick={() => setOpen(o => !o)} className="mt-2 text-xs font-semibold text-red-700 hover:underline">
          {open ? '접기 ▲' : `회사별 카드 ${crises.length}건 더보기 ▼`}
        </button>
      </div>
      {open && (
        <div className="space-y-3">
          {crises.map(c => <CrisisCardView key={c.company} c={c} windowDays={windowDays} />)}
        </div>
      )}
    </div>
  );
}

function CrisisCardView({ c, windowDays }: { c: Crisis; windowDays: number }) {
  const d = new Date(c.article.pubDate);
  return (
    <div className="rounded-xl border-l-4 border-red-500 bg-gradient-to-r from-red-50 to-white p-4">
      {/* 1줄: 급증 알림 (실제 회사명) */}
      <div className="text-sm font-bold text-red-900">
        {c.company} 관련 부정 기사가 최근 {windowDays}일 내 {c.negCount}건 급증했습니다.
      </div>
      {/* 2줄: AI 원인 요약 (두괄식) */}
      <div className="text-sm text-gray-700 mt-1.5 leading-relaxed">{c.cause}</div>
      {/* 대표 부정기사 1건 */}
      <div className="mt-3 rounded-lg bg-white/70 border border-red-100 p-2.5">
        <div className="text-[10px] font-semibold text-red-400 mb-1">대표 부정기사</div>
        <a href={safeArticleHref(c.article.link, c.article.title, c.article.source)} target="_blank" rel="noopener noreferrer" className="block text-sm text-gray-800 hover:text-spark-purple font-medium">
          {c.article.title}
        </a>
        <div className="text-xs text-gray-500 mt-1">{c.article.source} · {d.getFullYear()}.{d.getMonth() + 1}.{d.getDate()}</div>
      </div>
    </div>
  );
}
