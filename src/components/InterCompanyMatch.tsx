'use client';
import { useT } from '@/lib/i18n/client';

// Inter 포트폴리오 매칭 — 회사 한 곳의 줄(대표 근거 + 펼치면 연결된 기사·"왜 이 회사?").
//
// Inter 탭의 '판정 근거' 탭(InterPanel ReasonTab)에서 쓴다(사내 화면 전용). 매칭 사유는
// 크론(inter-portfolio-match.ts)이 이미 써 둔 문장을 읽기만 하므로 AI를 다시 부르지 않는다.

import { useState } from 'react';
import type { PortfolioMatch } from '@/lib/inter-sample-data';
import { InterScrapStar } from '@/components/InterScrapStar';

export function InterCompanyMatchRow({
  match: m,
  canScrap,
  canBrief = canScrap,
  onBriefing,
  showCount = true,
  defaultOpen = false,
  title,
}: {
  match: PortfolioMatch;
  canScrap: boolean;
  /** 브리핑 버튼 권한 — 기본은 canScrap과 같다. */
  canBrief?: boolean;
  /** 주면 '브리핑 생성' 버튼이 뜬다(스크랩 권한과 같은 조건 — 포폴사 대표에게 나갈 문서라서). */
  onBriefing?: () => void;
  /** 회사명 옆 '기사 N' 배지. 포트폴리오사 화면은 기사 수를 보여주지 않는다. */
  showCount?: boolean;
  defaultOpen?: boolean;
  /** 줄 제목 — 기본은 회사명. 회사별 화면에서는 이미 회사가 정해져 있어 주제명을 쓴다. */
  title?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className={`rounded-lg border ${open ? 'border-emerald-300 bg-emerald-50/40' : 'border-spark-cream'}`}>
      {/* 회사 줄 — 펼치기 버튼과 '브리핑 생성'은 형제로 둔다(버튼 안에 버튼을 넣을 수 없다) */}
      <div className="flex items-center gap-2 px-2.5 py-2">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span className="text-[13px] font-bold text-spark-ink">{title ?? t(m.co)}</span>
          {showCount && (
            <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-emerald-700">
              {t('기사')} {m.articles.length}
            </span>
          )}
        </button>
        {canBrief && onBriefing && (
          <button
            type="button"
            onClick={onBriefing}
            title={t('{co}에 보낼 브리핑을 만듭니다 — 매칭 이유 요약 + 업계 동향', { co: m.co })}
            className="shrink-0 rounded-md border border-emerald-300 bg-white px-2 py-1 text-[11px] font-bold text-emerald-700 hover:bg-emerald-50"
          >
            ✉ {t('브리핑 생성')}
          </button>
        )}
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-label={open ? t('기사 접기') : t('기사 펼치기')}
          className={`shrink-0 text-[11px] text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
        >
          ▼
        </button>
      </div>

      {!open && (
        <p className="px-2.5 pb-2 text-[12px] leading-relaxed text-spark-ink-soft line-clamp-2">{m.desc}</p>
      )}

      {open && (
        <div className="border-t border-emerald-200/60 px-2.5 py-2">
          {/* 매칭 과정 — 실제 파이프라인에 들어간 입력과 모델을 그대로 적는다 */}
          <p className="mb-2 rounded bg-white/70 px-2 py-1.5 text-[11px] leading-relaxed text-spark-muted">
            <b className="text-spark-ink-soft">{t('매칭 과정')}</b> · {t('기사 제목과 관련성 판정 사유를, 포트폴리오사의 사업 설명·섹터와 비교해 영향이 있다고 본 것만 남깁니다')}
            (<span className="font-mono">{m.model}</span>).
          </p>

          <div className="flex flex-col gap-2">
            {m.articles.map(a => (
              <div key={`${a.id}-${a.reason.slice(0, 12)}`} className="rounded border border-spark-cream bg-white px-2 py-1.5">
                <div className="flex items-start gap-2">
                  <a href={a.url} target="_blank" rel="noopener noreferrer" className="group min-w-0 flex-1">
                    <div className="text-[12px] font-semibold leading-snug text-spark-ink group-hover:text-emerald-700">{a.title}</div>
                    <div className="mt-0.5 text-[11px] text-spark-muted">
                      {t(a.media)} · {a.date}
                      {a.eventKey && <> · {a.eventKey}</>}
                    </div>
                  </a>
                  {canScrap && <InterScrapStar id={a.id} initial={a.isScrapped} />}
                </div>
                <p className="mt-1 border-t border-spark-cream pt-1 text-[11px] leading-relaxed text-spark-ink-soft">
                  <b className="text-emerald-700">{t('왜 {co}?', { co: m.co })}</b> {a.reason}
                </p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-spark-muted">
                  <b>{t('기사 분류')}</b> {a.verdictReason}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
