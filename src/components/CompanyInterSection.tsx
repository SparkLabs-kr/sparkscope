'use client';
import { useT } from '@/lib/i18n/client';

// 우리 회사 기사 모아보기 — 해외 트렌드(Inter) 쪽.
// Inter 탭의 주제 카드 안에 흩어져 있던 "이 회사 매칭"을 회사 하나 기준으로 모은다.
// 매칭 사유는 크론이 이미 써 둔 문장을 읽기만 하고, 브리핑도 Inter 탭과 같은 모달·API를 쓴다.
//
// Inter 탭의 회사 줄(InterCompanyMatchRow)을 그대로 쓰지 않는 이유: 그 줄은 여러 회사를 훑는
// 자리라 11~12px 글씨에 매칭 과정·기사 분류까지 촘촘히 넣었다. 여기는 한 회사가 자기 기사를
// 읽는 자리라 제목과 "우리와의 연결점"만 크게 두고, 파이프라인 설명·판정 사유는 뺀다(2026-10-02).

import { useState } from 'react';
import type { PortfolioMatch } from '@/lib/inter-sample-data';
import { InterScrapStar } from '@/components/InterScrapStar';
import { InterBriefingModal, type BriefingPayload } from '@/components/InterBriefingModal';

export interface CompanyInterGroup {
  key: string;
  domainLabel: string;
  periodLabel: string;
  sector: BriefingPayload['sector'] & { icon: string };
  overview: BriefingPayload['overview'];
  match: PortfolioMatch;
}

/** 주제마다 처음에 보여 줄 기사 수 — 나머지는 '더 보기'로 편다. */
const INITIAL = 3;

export function CompanyInterSection({ groups, canScrap, canBrief }: { groups: CompanyInterGroup[]; canScrap: boolean; canBrief: boolean }) {
  const t = useT();
  const [briefingKey, setBriefingKey] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const briefingFor = groups.find(g => g.key === briefingKey);

  if (groups.length === 0) {
    return <p className="py-8 text-center text-sm text-spark-muted">{t('이 기간 이 회사와 연결된 해외 트렌드 기사가 없습니다.')}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {groups.map(g => {
        const open = expanded.has(g.key);
        const shown = open ? g.match.articles : g.match.articles.slice(0, INITIAL);
        const hidden = g.match.articles.length - shown.length;
        return (
          <section key={g.key} className="rounded-xl border border-spark-border bg-white">
            {/* 주제 머리 */}
            <div className="flex flex-wrap items-center gap-2 border-b border-spark-border px-5 py-3.5">
              <span className="text-[18px] leading-none" aria-hidden>{g.sector.icon}</span>
              <h3 className="text-[16px] font-extrabold tracking-tight text-spark-ink">{t(g.sector.name)}</h3>
              <span className="rounded-md bg-spark-subtle px-2 py-0.5 text-[12px] font-semibold text-spark-ink-soft">{t(g.domainLabel)}</span>
              {canBrief && (
                <button
                  type="button"
                  onClick={() => setBriefingKey(g.key)}
                  title={t('{co}에 보낼 브리핑을 만듭니다 — 매칭 이유 요약 + 업계 동향', { co: g.match.co })}
                  className="ml-auto rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-[13px] font-bold text-emerald-700 hover:bg-emerald-50"
                >
                  ✉ {t('브리핑 생성')}
                </button>
              )}
            </div>

            {/* 기사 */}
            <ul className="divide-y divide-spark-border">
              {shown.map(a => (
                <li key={`${a.id}-${a.reason.slice(0, 12)}`} className="px-5 py-4">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <a
                        href={a.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[16px] font-bold leading-snug text-spark-ink hover:text-spark-purple"
                      >
                        {a.title}
                      </a>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-spark-muted">
                        <span className="font-semibold text-spark-ink-soft">{t(a.media)}</span>
                        <span aria-hidden>·</span>
                        <span className="tabular-nums">{a.date}</span>
                        {a.eventKey && (
                          <span className="rounded-full border border-spark-border px-2 py-px text-[12px] font-medium text-spark-ink-soft">{t(a.eventKey)}</span>
                        )}
                      </div>
                    </div>
                    {canScrap && <InterScrapStar id={a.id} initial={a.isScrapped} />}
                  </div>

                  <div className="mt-3 rounded-lg border-l-[3px] border-emerald-500 bg-emerald-50/60 px-4 py-3">
                    <div className="mb-1 text-[12.5px] font-bold text-emerald-700">💡 {t('{co}와의 연결점', { co: g.match.co })}</div>
                    <p className="text-[14.5px] leading-[1.75] text-spark-ink">{a.reason}</p>
                  </div>
                </li>
              ))}
            </ul>

            {(hidden > 0 || open) && g.match.articles.length > INITIAL && (
              <button
                type="button"
                onClick={() => setExpanded(prev => {
                  const next = new Set(prev);
                  if (next.has(g.key)) next.delete(g.key); else next.add(g.key);
                  return next;
                })}
                className="w-full rounded-b-xl border-t border-spark-border py-2.5 text-[13px] font-semibold text-spark-purple hover:bg-spark-subtle"
              >
                {open ? t('접기 ▲') : t('이 주제 기사 더 보기 ▼')}
              </button>
            )}
          </section>
        );
      })}

      {briefingFor && (
        <InterBriefingModal
          key={briefingFor.key}
          onClose={() => setBriefingKey(null)}
          payload={{
            company: briefingFor.match.co,
            domainLabel: briefingFor.domainLabel,
            periodLabel: briefingFor.periodLabel,
            sector: briefingFor.sector,
            overview: briefingFor.overview,
            articles: briefingFor.match.articles.map(a => ({
              title: a.title,
              url: a.url,
              media: a.media,
              date: a.date,
              reason: a.reason,
              eventKey: a.eventKey,
            })),
          }}
        />
      )}
    </div>
  );
}
