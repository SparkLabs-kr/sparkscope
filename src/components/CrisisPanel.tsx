'use client';
// 실시간 위기 감지 카드 목록 — 위기 카드가 많으면 개별 카드 대신 AI 종합요약을 먼저 보여주고
// "더보기"로 접어서 화면 공간을 아낀다 (카드 수가 적으면 그냥 다 펼쳐서 보여준다).
import { useState } from 'react';
import { useT, type Translate } from '@/lib/i18n/client';
import { safeArticleHref } from '@/lib/sparkscope/article-link';

interface CrisisArticle { title: string; titleEn?: string | null; source: string; pubDate: Date | string; link: string }
interface Crisis {
  company: string;
  negCount: number;
  cause: string;
  article: CrisisArticle;
  causeSource: 'ai' | 'fallback';
  causeComputedAt: Date | string | null;
}

// 원인 문장 계산 시각은 KST 기준 HH:MM으로 표시 (사전계산 배치가 KST 하루 1회 도는 것과 맞춤)
function fmtKstTime(d: Date | string) {
  const kst = new Date(new Date(d).toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  return `${String(kst.getHours()).padStart(2, '0')}:${String(kst.getMinutes()).padStart(2, '0')}`;
}

export function CrisisPanel({ crises, overview, windowDays, summaryThreshold }: {
  crises: Crisis[];
  overview: string | null;
  windowDays: number;
  summaryThreshold: number;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);

  if (crises.length === 0) {
    return (
      <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
        🟢 {t('최근 {days}일 내 감지된 포트폴리오 위기가 없습니다.', { days: windowDays })}
        <span className="text-green-600"> {t('부정 기사가 급증하면 이 자리에 회사별 위기 카드가 자동으로 표시됩니다.')}</span>
      </div>
    );
  }

  if (crises.length <= summaryThreshold) {
    return (
      <div className="space-y-3">
        {crises.map(c => <CrisisCardView key={c.company} c={c} windowDays={windowDays} t={t} />)}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
        <div className="text-sm font-bold text-red-900 mb-1">🚨 {t('{n}개사에서 위기 감지', { n: crises.length })}</div>
        <div className="text-sm text-red-800 leading-relaxed">
          {overview ?? t('{companies} 관련 부정 기사가 최근 {days}일 내 급증했습니다.', { companies: crises.map(c => c.company).join(', '), days: windowDays })}
        </div>
        <button type="button" onClick={() => setOpen(o => !o)} className="mt-2 text-xs font-semibold text-red-700 hover:underline">
          {open ? t('접기 ▲') : t('회사별 카드 {n}건 더보기 ▼', { n: crises.length })}
        </button>
      </div>
      {open && (
        <div className="space-y-3">
          {crises.map(c => <CrisisCardView key={c.company} c={c} windowDays={windowDays} t={t} />)}
        </div>
      )}
    </div>
  );
}

function CrisisCardView({ c, windowDays, t }: { c: Crisis; windowDays: number; t: Translate }) {
  const d = new Date(c.article.pubDate);
  return (
    <div className="rounded-xl border-l-4 border-red-500 bg-gradient-to-r from-red-50 to-white p-4">
      {/* 1줄: 급증 알림 (실제 회사명) */}
      <div className="text-sm font-bold text-red-900">
        {t('{company} 관련 부정 기사가 최근 {days}일 내 {count}건 급증했습니다.', { company: c.company, days: windowDays, count: c.negCount })}
      </div>
      {/* 2줄: AI 원인 요약 (두괄식) */}
      <div className="text-sm text-gray-700 mt-1.5 leading-relaxed">{c.cause}</div>
      {/* AI가 실제로 읽고 요약한 건지, 아직 분석 전이라 키워드 매칭 기본 문구인지 구분 표시 */}
      <div className="text-[10px] text-gray-400 mt-0.5">
        {c.causeSource === 'fallback'
          ? t('⚙️ 기본 요약 · AI 분석 대기 중(다음 수집 때 자동 갱신)')
          : c.causeComputedAt
          ? t('🤖 AI 요약 · {time} 기준', { time: fmtKstTime(c.causeComputedAt) })
          : t('🤖 AI 요약 · 실시간')}
      </div>
      {/* 대표 부정기사 1건 */}
      <div className="mt-3 rounded-lg bg-white/70 border border-red-100 p-2.5">
        <div className="text-[10px] font-semibold text-red-400 mb-1">{t('대표 부정기사')}</div>
        <a href={safeArticleHref(c.article.link, c.article.title, c.article.source)} target="_blank" rel="noopener noreferrer" className="block text-sm text-gray-800 hover:text-spark-purple font-medium">
          {c.article.titleEn || c.article.title}
        </a>
        <div className="text-xs text-gray-500 mt-1">{t(c.article.source)} · {d.getFullYear()}.{d.getMonth() + 1}.{d.getDate()}</div>
      </div>
    </div>
  );
}
