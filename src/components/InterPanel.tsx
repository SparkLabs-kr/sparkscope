'use client';

// Inter(해외 트렌드) 탭 — 바이오/AI 도메인별 해외 기사·논문·오피니언 트렌드 + 포트폴리오 매치.
//
// ⚠️ 아직 해외 소스 수집 파이프라인이 없어 전부 샘플 데이터로 UI만 구현한 상태다.
// (src/lib/sparkscope/inter-sample-data.ts 참고 — 실제 수집 연동 시 그 파일만 교체하면 됨)

import { useState } from 'react';
import {
  COUNTRY_TABS,
  DOMAIN_SUMMARY,
  DOMAIN_STATS,
  SECTOR_DATA,
  type InterCountry,
  type InterDomain,
  type SourceKind,
  type SectorBlock,
} from '@/lib/sparkscope/inter-sample-data';

const SECTOR_BADGE_CLS: Record<string, string> = {
  urgent: 'bg-red-100 text-red-600',
  watch: 'bg-amber-100 text-amber-700',
  pos: 'bg-emerald-100 text-emerald-700',
  neu: 'bg-gray-100 text-gray-500',
};

const SRC_BADGE_CLS: Record<SourceKind, string> = {
  news: 'bg-blue-100 text-blue-700',
  paper: 'bg-violet-100 text-violet-700',
  opinion: 'bg-amber-100 text-amber-700',
};

const SRC_LABEL: Record<SourceKind, string> = { news: '기사', paper: '논문', opinion: '오피니언' };

const ALERT_CLS: Record<string, string> = {
  urgent: 'bg-red-100 text-red-600',
  watch: 'bg-amber-100 text-amber-700',
  pos: 'bg-emerald-100 text-emerald-700',
};

const ALERT_LABEL: Record<string, string> = { urgent: '⚠ 긴급', watch: '👁 모니터링', pos: '✓ 긍정' };

const SOURCE_KINDS: SourceKind[] = ['news', 'paper', 'opinion'];

export function InterPanel() {
  const [domain, setDomain] = useState<InterDomain>('bio');
  const [country, setCountry] = useState<InterCountry>('us');
  const [period, setPeriod] = useState(20);
  const [openSectors, setOpenSectors] = useState<Set<string>>(new Set());
  const [activeSrcTab, setActiveSrcTab] = useState<Record<string, SourceKind>>({});

  const summary = DOMAIN_SUMMARY[domain];
  const stats = DOMAIN_STATS[domain];
  const sectors = SECTOR_DATA[domain];

  function switchDomain(d: InterDomain) {
    setDomain(d);
    setOpenSectors(new Set());
  }

  function toggleSector(id: string) {
    setOpenSectors(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div>
      {/* 바이오 / AI 도메인 탭 */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <DomainTabBig label="바이오" active={domain === 'bio'} activeCls="bg-cyan-50 border-cyan-600 text-cyan-700" onClick={() => switchDomain('bio')} />
        <DomainTabBig label="AI" active={domain === 'ai'} activeCls="bg-violet-50 border-violet-600 text-violet-700" onClick={() => switchDomain('ai')} />
      </div>

      {/* 국가 + 기간 필터 */}
      <div className="bg-white border border-spark-border rounded-2xl p-5 mb-6">
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <span className="w-full sm:w-24 shrink-0 text-xs font-semibold text-spark-ink-soft">국가별 트렌드 현황</span>
          <div className="flex flex-wrap gap-1.5">
            {COUNTRY_TABS.map(c => (
              <button
                key={c.id}
                onClick={() => setCountry(c.id)}
                className={`rounded-lg border-[1.5px] px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                  country === c.id ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-spark-subtle border-spark-border text-spark-ink-soft hover:bg-spark-cream'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <span className="w-full sm:w-24 shrink-0 self-center text-xs font-semibold text-spark-ink-soft">기간</span>
          <div className="flex-1 min-w-[200px]">
            <div className="flex justify-between text-[11px] text-spark-muted mb-1.5">
              <span>7일 (short term)</span>
              <span>3년 (long term)</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={period}
              onChange={e => setPeriod(Number(e.target.value))}
              className="w-full accent-emerald-600"
            />
          </div>
          <button className="whitespace-nowrap rounded-lg border-[1.5px] border-spark-border bg-white px-5 py-1.5 text-xs font-bold text-spark-ink-soft hover:bg-spark-subtle">
            확인
          </button>
        </div>
      </div>

      <div className="h-px bg-spark-border mb-6" />

      {/* AI 요약 */}
      <div className="bg-white border-[1.5px] border-spark-border rounded-2xl p-5 mb-6">
        <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-emerald-600 mb-3">
          ✦ <span>{summary.label} 주요 요약</span>
        </div>
        <SummaryItem n={1} k="트렌드 1줄 요약" v={summary.trend} />
        <SummaryItem n={2} k="스파크랩의 포지션" v={summary.position} />
        <SummaryItem n={3} k="취해야 할 가장 중요한 액션" v={summary.action} last />
      </div>

      {/* 통계 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 mb-6">
        {stats.map(s => (
          <div key={s.label} className="bg-white border border-spark-border rounded-xl px-4 py-3.5">
            <div className="text-[11px] text-spark-muted mb-1">{s.label}</div>
            <div className="text-xl font-extrabold tabular-nums text-spark-ink">{s.value}</div>
          </div>
        ))}
      </div>

      {/* 분야별 아코디언 */}
      <div>
        {sectors.map(s => (
          <SectorAccordion
            key={s.id}
            sector={s}
            open={openSectors.has(s.id)}
            onToggle={() => toggleSector(s.id)}
            activeTab={activeSrcTab[s.id] ?? 'news'}
            onTabChange={t => setActiveSrcTab(prev => ({ ...prev, [s.id]: t }))}
          />
        ))}
      </div>
    </div>
  );
}

function DomainTabBig({ label, active, activeCls, onClick }: { label: string; active: boolean; activeCls: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-xl border-2 px-8 py-3.5 text-[15px] font-bold transition-colors ${
        active ? activeCls : 'bg-white border-spark-border text-spark-muted hover:bg-spark-subtle hover:text-spark-ink-soft'
      }`}
    >
      {label}
    </button>
  );
}

function SummaryItem({ n, k, v, last }: { n: number; k: string; v: string; last?: boolean }) {
  return (
    <div className={`flex gap-2.5 py-2 text-[13px] leading-relaxed text-spark-ink-soft ${last ? '' : 'border-b border-spark-cream'}`}>
      <span className="mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-spark-cream text-[10px] font-bold text-spark-muted">
        {n}
      </span>
      <div>
        <span className="mr-1 font-semibold text-spark-ink">{k}</span>
        <span>{v}</span>
      </div>
    </div>
  );
}

function SectorAccordion({
  sector,
  open,
  onToggle,
  activeTab,
  onTabChange,
}: {
  sector: SectorBlock;
  open: boolean;
  onToggle: () => void;
  activeTab: SourceKind;
  onTabChange: (t: SourceKind) => void;
}) {
  const items = sector.items[activeTab];
  return (
    <div className="mb-2.5">
      <div
        onClick={onToggle}
        className={`flex cursor-pointer items-center gap-3 border border-spark-border bg-white px-4 py-3.5 transition-colors hover:bg-spark-subtle ${
          open ? 'rounded-t-xl border-b-spark-cream' : 'rounded-xl'
        }`}
      >
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-spark-cream text-[15px]">{sector.icon}</div>
        <div>
          <div className="text-[13px] font-bold text-spark-ink">{sector.name}</div>
          <div className="text-[11px] text-spark-muted">{sector.sub}</div>
        </div>
        <div className="ml-auto flex shrink-0 gap-1.5">
          <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${SECTOR_BADGE_CLS[sector.badge.cls]}`}>{sector.badge.label}</span>
        </div>
        <span className={`shrink-0 text-[11px] text-gray-300 transition-transform ${open ? 'rotate-180' : ''}`}>▼</span>
      </div>

      {open && (
        <div className="rounded-b-xl border border-t-0 border-spark-border bg-white overflow-hidden">
          {sector.matches.length > 0 && (
            <div className="flex flex-col gap-1.5 border-b border-spark-cream bg-spark-subtle px-4 py-2.5">
              {sector.matches.map(m => (
                <div key={m.co} className="flex items-center gap-2.5 text-xs">
                  <span className="w-28 shrink-0 font-bold text-spark-ink">📎 {m.co}</span>
                  <span className="flex-1 text-spark-ink-soft">{m.desc}</span>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-0 border-b border-spark-cream px-4">
            {SOURCE_KINDS.map(k => (
              <button
                key={k}
                onClick={() => onTabChange(k)}
                className={`border-b-2 px-3.5 py-2 text-[11px] font-semibold transition-colors ${
                  activeTab === k ? 'border-spark-ink text-spark-ink' : 'border-transparent text-spark-muted hover:text-spark-ink-soft'
                }`}
              >
                {SRC_LABEL[k]} {sector.items[k].length}
              </button>
            ))}
          </div>

          <div className="py-1">
            {items.length === 0 ? (
              <div className="py-4 text-center text-xs text-spark-muted">해당 탭에 항목이 없습니다</div>
            ) : (
              items.map((it, i) => (
                <div key={i} className="flex items-start gap-2.5 border-b border-spark-cream/60 px-4 py-2.5 last:border-0 hover:bg-spark-subtle">
                  <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${SRC_BADGE_CLS[it.badge]}`}>{SRC_LABEL[it.badge]}</span>
                  <div className="flex-1">
                    <div className="text-xs font-semibold leading-snug text-spark-ink">{it.title}</div>
                    <div className="mt-0.5 text-[11px] text-spark-muted">{it.media} · {it.date}</div>
                  </div>
                  <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${ALERT_CLS[it.alert]}`}>{ALERT_LABEL[it.alert]}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
