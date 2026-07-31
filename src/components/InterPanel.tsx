'use client';

// Inter(해외 트렌드) 탭 — 바이오/AI 도메인별 해외 기사·논문·오피니언 트렌드 + 포트폴리오 매치.
//
// /api/inter?domain=bio|ai 에서 실제 DB 데이터(RSS 수집 → Gemini 필터링 → GPT 포트폴리오 매칭
// 파이프라인 결과)를 받아온다. 국가/기간 필터는 아직 UI만 있고 실제 조회에는 반영 안 됨.

import { useEffect, useState } from 'react';
import {
  COUNTRY_TABS,
  type DomainSummary,
  type InterCountry,
  type InterDomain,
  type InterStat,
  type SourceKind,
  type SectorBlock,
} from '@/lib/inter-sample-data';

interface InterApiResponse {
  summary: DomainSummary;
  stats: InterStat[];
  sectors: SectorBlock[];
}

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

type PeriodKey = '7d' | '1m' | '3m' | '1y' | '3y';
const PERIOD_PRESETS: { key: PeriodKey; label: string }[] = [
  { key: '7d', label: '7일' },
  { key: '1m', label: '1개월' },
  { key: '3m', label: '3개월' },
  { key: '1y', label: '1년' },
  { key: '3y', label: '3년' },
];

export function InterPanel() {
  const [domain, setDomain] = useState<InterDomain>('bio');
  const [country, setCountry] = useState<InterCountry>('us');
  const [period, setPeriod] = useState<PeriodKey>('3m');
  const [openSectors, setOpenSectors] = useState<Set<string>>(new Set());
  const [activeSrcTab, setActiveSrcTab] = useState<Record<string, SourceKind>>({});
  const [data, setData] = useState<InterApiResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/inter?domain=${domain}&period=${period}`)
      .then(res => res.json())
      .then((json: InterApiResponse) => {
        if (!cancelled) setData(json);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [domain, period]);

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

  const [badgeReasons, setBadgeReasons] = useState<Record<string, string | null>>({});
  const [reasonsLoading, setReasonsLoading] = useState(false);

  useEffect(() => {
    if (!data) return;
    const pending = data.sectors.filter(s => !(s.id in badgeReasons));
    if (pending.length === 0) return;
    setReasonsLoading(true);
    fetch('/api/inter/sector-urgency', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sectors: pending.map(s => ({
          id: s.id,
          name: s.name,
          badgeLabel: s.badge.label,
          titles: SOURCE_KINDS.flatMap(k => s.items[k].map(it => it.title)).slice(0, 8),
        })),
      }),
    })
      .then(r => (r.ok ? r.json() : Promise.reject(r)))
      .then(({ results }: { results: Record<string, string | null> }) => {
        setBadgeReasons(prev => ({ ...prev, ...results }));
      })
      .catch(() => {
        setBadgeReasons(prev => ({ ...prev, ...Object.fromEntries(pending.map(s => [s.id, null])) }));
      })
      .finally(() => setReasonsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

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
        <div className="flex flex-wrap items-center gap-3">
          <span className="w-full sm:w-24 shrink-0 text-xs font-semibold text-spark-ink-soft">기간</span>
          <div className="flex flex-wrap gap-1.5">
            {PERIOD_PRESETS.map(p => (
              <button
                key={p.key}
                onClick={() => setPeriod(p.key)}
                className={`rounded-lg border-[1.5px] px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                  period === p.key ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-spark-subtle border-spark-border text-spark-ink-soft hover:bg-spark-cream'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="h-px bg-spark-border mb-6" />

      {loading || !data ? (
        <div className="py-16 text-center text-sm text-spark-muted">불러오는 중...</div>
      ) : (
        <>
      {/* AI 요약 */}
      <div className="bg-white border-[1.5px] border-spark-border rounded-2xl p-5 mb-6">
        <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-emerald-600 mb-3">
          ✦ <span>{data.summary.label} 주요 요약</span>
        </div>
        <SummaryItem n={1} k="트렌드 1줄 요약" v={data.summary.trend} />
        <SummaryItem n={2} k="스파크랩의 포지션" v={data.summary.position} />
        <SummaryItem n={3} k="취해야 할 가장 중요한 액션" v={data.summary.action} last />
      </div>

      {/* 통계 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 mb-6">
        {data.stats.map(s => (
          <div key={s.label} className="bg-white border border-spark-border rounded-xl px-4 py-3.5">
            <div className="text-[11px] text-spark-muted mb-1">{s.label}</div>
            <div className="text-xl font-extrabold tabular-nums text-spark-ink">{s.value}</div>
          </div>
        ))}
      </div>

      {/* 섹터 히트맵 — 어디가 뜨거운지 한눈에 */}
      <SectorHeatmap
        sectors={data.sectors}
        badgeReasons={badgeReasons}
        reasonsLoading={reasonsLoading}
        onSelect={id => {
          setOpenSectors(prev => new Set(prev).add(id));
          document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }}
      />

      {/* 분야별 아코디언 */}
      <div>
        {data.sectors.map(s => (
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
        </>
      )}
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
    <div id={sector.id} className="mb-2.5 scroll-mt-4">
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
                <a
                  key={i}
                  href={it.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start gap-2.5 border-b border-spark-cream/60 px-4 py-2.5 last:border-0 hover:bg-spark-subtle"
                >
                  <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${SRC_BADGE_CLS[it.badge]}`}>{SRC_LABEL[it.badge]}</span>
                  <div className="flex-1">
                    <div className="text-xs font-semibold leading-snug text-spark-ink">{it.title}</div>
                    {it.titleOriginal !== it.title && (
                      <div className="mt-0.5 text-[11px] leading-snug text-spark-muted">{it.titleOriginal}</div>
                    )}
                    <div className="mt-0.5 text-[11px] text-spark-muted">{it.media} · {it.date}</div>
                  </div>
                  <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${ALERT_CLS[it.alert]}`}>{ALERT_LABEL[it.alert]}</span>
                </a>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const HEAT_BAR_CLS: Record<string, string> = {
  urgent: 'bg-red-500',
  watch: 'bg-amber-500',
  pos: 'bg-emerald-500',
  neu: 'bg-gray-300',
};

function SectorHeatmap({
  sectors,
  badgeReasons,
  reasonsLoading,
  onSelect,
}: {
  sectors: SectorBlock[];
  badgeReasons: Record<string, string | null>;
  reasonsLoading: boolean;
  onSelect: (id: string) => void;
}) {
  const rows = sectors.map(s => ({
    sector: s,
    volume: SOURCE_KINDS.reduce((sum, k) => sum + s.items[k].length, 0),
  }));
  const maxVolume = Math.max(1, ...rows.map(r => r.volume));

  return (
    <div className="bg-white border border-spark-border rounded-2xl p-5 mb-6">
      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-spark-ink-soft mb-4">
        📊 <span>분야별 이슈 강도</span>
        <span className="ml-auto flex items-center gap-3 text-[10px] font-medium normal-case text-spark-muted">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-500" />긴급</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" />모니터링</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" />기회</span>
        </span>
      </div>
      <div className="flex flex-col gap-2.5">
        {rows.map(({ sector, volume }) => {
          const reason = badgeReasons[sector.id];
          const reasonKnown = sector.id in badgeReasons;
          return (
            <div key={sector.id} className="rounded-lg px-2 py-1.5 hover:bg-spark-subtle">
              <button onClick={() => onSelect(sector.id)} className="flex w-full items-center gap-3 text-left">
                <span className="w-8 shrink-0 text-center text-[15px]">{sector.icon}</span>
                <span className="w-24 shrink-0 text-xs font-bold text-spark-ink">{sector.name}</span>
                <div className="relative h-5 flex-1 overflow-hidden rounded-md bg-spark-cream">
                  <div
                    className={`h-full rounded-md ${HEAT_BAR_CLS[sector.badge.cls]}`}
                    style={{ width: `${Math.max(6, (volume / maxVolume) * 100)}%` }}
                  />
                </div>
                <span className="w-6 shrink-0 text-right text-[11px] font-bold tabular-nums text-spark-ink-soft">{volume}</span>
                {sector.matches.length > 0 ? (
                  <span className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                    📎 {sector.matches[0].co}
                    {sector.matches.length > 1 ? ` 외 ${sector.matches.length - 1}` : ''}
                  </span>
                ) : (
                  <span className="w-[88px] shrink-0" />
                )}
              </button>
              <div className="mt-1 pl-11 pr-6 text-[11px] leading-snug text-spark-ink-soft">
                {!reasonKnown && reasonsLoading ? (
                  <span className="text-spark-muted">🤖 사유 분석 중…</span>
                ) : reason ? (
                  <span><span className="font-semibold text-emerald-600">🤖 AI 요약</span> · {reason}</span>
                ) : (
                  <span className="text-spark-muted">⚙️ 기본 요약 · {sector.badge.label} 상태 (사유 분석 실패)</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
