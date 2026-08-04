'use client';

// Inter(해외 트렌드) 탭 — 바이오/AI 도메인별 해외 기사·논문·오피니언 트렌드 + 포트폴리오 매치.
//
// /api/inter?domain=bio|ai&from=&to=&country= 에서 실제 DB 데이터(RSS 수집 → Gemini 필터링 →
// GPT 포트폴리오 매칭 파이프라인 결과)를 받아온다.
//
// 도메인·국가·기간은 모두 URL(?scope=inter&domain=&country=&from=&to=)에 담긴다 —
// 기간 선택은 Intra 탭과 완전히 같은 DateRangePicker를 그대로 재사용하기 위해 URL 기반이어야 한다.

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  COUNTRY_TABS,
  type DomainSummary,
  type InterCountry,
  type InterDomain,
  type InterOverview,
  type InterStat,
  type SourceKind,
  type SectorBlock,
} from '@/lib/inter-sample-data';
import { InterScrapStar } from '@/components/InterScrapStar';

interface InterApiResponse {
  summary: DomainSummary;
  overview: InterOverview;
  stats: InterStat[];
  sectors: SectorBlock[];
}

// 배지 색 — 라벨과 의미가 1:1로 맞는다(가짜 인덱스 배지 시절과 달리 실제 지표에서 계산됨).
const BADGE_CLS: Record<string, string> = {
  surge: 'bg-red-100 text-red-600',
  opportunity: 'bg-emerald-100 text-emerald-700',
  major: 'bg-amber-100 text-amber-700',
  quiet: 'bg-gray-100 text-gray-500',
  none: 'bg-gray-50 text-gray-400',
};

const BAR_CLS: Record<string, string> = {
  surge: 'bg-red-500',
  opportunity: 'bg-emerald-500',
  major: 'bg-amber-500',
  quiet: 'bg-gray-300',
  none: 'bg-gray-200',
};

const SRC_BADGE_CLS: Record<SourceKind, string> = {
  news: 'bg-blue-100 text-blue-700',
  paper: 'bg-violet-100 text-violet-700',
  opinion: 'bg-amber-100 text-amber-700',
};

const SRC_LABEL: Record<SourceKind, string> = { news: '기사', paper: '논문', opinion: '오피니언' };
const SOURCE_KINDS: SourceKind[] = ['news', 'paper', 'opinion'];

export function InterPanel({ from, to, canScrap }: { from: string; to: string; canScrap: boolean }) {
  const router = useRouter();
  const sp = useSearchParams();
  const domain: InterDomain = sp.get('domain') === 'ai' ? 'ai' : 'bio';
  const country = (COUNTRY_TABS.find(c => c.id === sp.get('country'))?.id ?? 'all') as InterCountry;

  const [openSectors, setOpenSectors] = useState<Set<string>>(new Set());
  const [activeSrcTab, setActiveSrcTab] = useState<Record<string, SourceKind>>({});
  const [data, setData] = useState<InterApiResponse | null>(null);
  const [loading, setLoading] = useState(true);

  // URL 갱신 — 기간(DateRangePicker)과 같은 방식으로 도메인·국가도 URL에 남긴다.
  function pushParams(next: Record<string, string>) {
    const params = new URLSearchParams({ scope: 'inter', from, to, domain, country, ...next });
    router.push(`/dashboard?${params.toString()}`, { scroll: false });
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/inter?domain=${domain}&country=${country}&from=${from}&to=${to}`)
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
  }, [domain, country, from, to]);

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

  // 도메인·국가·기간이 바뀌면 섹터 구성이 달라지므로 사유 캐시를 비운다.
  useEffect(() => {
    setBadgeReasons({});
    setOpenSectors(new Set());
  }, [domain, country, from, to]);

  useEffect(() => {
    if (!data) return;
    const pending = data.sectors.filter(s => s.metrics.count > 0 && !(s.id in badgeReasons));
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
          metricsLine: `기사 ${s.metrics.count}건, ${s.badge.why}, 포트폴리오 매치 ${s.metrics.matchCount}건, 매체 ${s.metrics.sourceCount}곳`,
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
        <DomainTabBig label="바이오" active={domain === 'bio'} activeCls="bg-cyan-50 border-cyan-600 text-cyan-700" onClick={() => pushParams({ domain: 'bio' })} />
        <DomainTabBig label="AI" active={domain === 'ai'} activeCls="bg-violet-50 border-violet-600 text-violet-700" onClick={() => pushParams({ domain: 'ai' })} />
      </div>

      {/* 국가 필터 — 실제 조회에 반영된다(InterNewsVerdict.country) */}
      <div className="bg-white border border-spark-border rounded-2xl p-5 mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <span className="w-full sm:w-24 shrink-0 text-xs font-semibold text-spark-ink-soft">국가별 트렌드</span>
          <div className="flex flex-wrap gap-1.5">
            {COUNTRY_TABS.map(c => {
              const n = data?.overview.byCountry.find(b => b.id === c.id)?.count;
              return (
                <button
                  key={c.id}
                  onClick={() => pushParams({ country: c.id })}
                  aria-pressed={country === c.id}
                  className={`rounded-lg border-[1.5px] px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                    country === c.id ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-spark-subtle border-spark-border text-spark-ink-soft hover:bg-spark-cream'
                  }`}
                >
                  {c.label}
                  {c.id !== 'all' && n !== undefined && <span className="ml-1 opacity-70 tabular-nums">{n}</span>}
                </button>
              );
            })}
          </div>
        </div>
        <p className="mt-2 text-[11px] text-spark-muted">
          국가는 기사 판정 단계에서 분류된 값입니다. 분류 이전에 수집된 과거 기사는 국가값이 없어 <b>전체</b>에서만 보입니다.
        </p>
      </div>

      {loading || !data ? (
        <div className="py-16 text-center text-sm text-spark-muted">불러오는 중...</div>
      ) : (
        <>
          {/* 개요 요약 — 전부 실제 집계값. (#5 시각화 후보 확정 전 임시 블록) */}
          <OverviewSummary overview={data.overview} />

          {/* 통계 */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 mb-6">
            {data.stats.map(s => (
              <div key={s.label} className="bg-white border border-spark-border rounded-xl px-4 py-3.5" title={s.hint}>
                <div className="text-[11px] text-spark-muted mb-1">{s.label}</div>
                <div className="text-xl font-extrabold tabular-nums text-spark-ink">{s.value}</div>
              </div>
            ))}
          </div>

          {/* 분야별 이슈 강도 — 배지는 실제 지표(건수·증감·매치)에서 계산됨 */}
          <SectorHeatmap
            sectors={data.sectors}
            overview={data.overview}
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
                canScrap={canScrap}
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
      aria-pressed={active}
      className={`rounded-xl border-2 px-8 py-3.5 text-[15px] font-bold transition-colors ${
        active ? activeCls : 'bg-white border-spark-border text-spark-muted hover:bg-spark-subtle hover:text-spark-ink-soft'
      }`}
    >
      {label}
    </button>
  );
}

function DeltaChip({ deltaPct, count }: { deltaPct: number | null; count?: number }) {
  if (count === 0) return <span className="text-[10px] text-spark-muted">—</span>;
  // 직전 동일 기간이 0건이면 증감률을 낼 수 없다 — 이 기간에 처음 잡힌 흐름.
  if (deltaPct === null) return <span className="text-[10px] font-bold text-emerald-600">신규</span>;
  const up = deltaPct > 0;
  const flat = deltaPct === 0;
  return (
    <span className={`text-[10px] font-bold tabular-nums ${flat ? 'text-spark-muted' : up ? 'text-red-500' : 'text-blue-500'}`}>
      {flat ? '±0%' : `${up ? '▲' : '▼'}${Math.abs(deltaPct)}%`}
    </span>
  );
}

function Sparkline({ values, cls }: { values: number[]; cls: string }) {
  const max = Math.max(1, ...values);
  return (
    <span className="flex h-5 items-end gap-[2px]" aria-hidden>
      {values.map((v, i) => (
        <span key={i} className={`w-[3px] rounded-sm ${v === 0 ? 'bg-spark-cream' : cls}`} style={{ height: `${Math.max(12, (v / max) * 100)}%` }} />
      ))}
    </span>
  );
}

function SectorAccordion({
  sector,
  canScrap,
  open,
  onToggle,
  activeTab,
  onTabChange,
}: {
  sector: SectorBlock;
  canScrap: boolean;
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
        <div className="min-w-0">
          <div className="text-[13px] font-bold text-spark-ink">{sector.name}</div>
          <div className="text-[11px] text-spark-muted">{sector.sub}</div>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <span className="text-[11px] tabular-nums text-spark-muted">{sector.metrics.count}건</span>
          <DeltaChip deltaPct={sector.metrics.deltaPct} count={sector.metrics.count} />
          <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${BADGE_CLS[sector.badge.kind]}`} title={sector.badge.why}>
            {sector.badge.label}
          </span>
        </div>
        <span className={`shrink-0 text-[11px] text-gray-300 transition-transform ${open ? 'rotate-180' : ''}`}>▼</span>
      </div>

      {open && (
        <div className="rounded-b-xl border border-t-0 border-spark-border bg-white overflow-hidden">
          <div className="border-b border-spark-cream bg-spark-subtle px-4 py-2 text-[11px] text-spark-ink-soft">
            <b className="text-spark-ink">{sector.badge.label}</b> 판정 근거 · {sector.badge.why}
          </div>

          {sector.matches.length > 0 && (
            <div className="flex flex-col gap-1.5 border-b border-spark-cream bg-spark-subtle px-4 py-2.5">
              {sector.matches.map(m => (
                <div key={`${m.co}-${m.desc}`} className="flex items-center gap-2.5 text-xs">
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
              items.map(it => (
                <div key={it.id} className="flex items-start gap-2.5 border-b border-spark-cream/60 px-4 py-2.5 last:border-0 hover:bg-spark-subtle">
                  <a href={it.url} target="_blank" rel="noopener noreferrer" className="flex flex-1 items-start gap-2.5 min-w-0">
                    <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${SRC_BADGE_CLS[it.badge]}`}>{SRC_LABEL[it.badge]}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold leading-snug text-spark-ink">{it.title}</div>
                      {it.titleOriginal !== it.title && (
                        <div className="mt-0.5 text-[11px] leading-snug text-spark-muted">{it.titleOriginal}</div>
                      )}
                      <div className="mt-0.5 text-[11px] text-spark-muted">{it.media} · {it.date}</div>
                    </div>
                  </a>
                  {canScrap && <InterScrapStar id={it.id} initial={it.isScrapped} />}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// 개요 요약 — LLM 문구가 아니라 실제 집계값만 쓴다. 예전 "✦ 주요 요약" 블록은
// inter-sample-data.ts의 DOMAIN_SUMMARY 상수(하드코딩 3줄)를 그대로 뿌리고 있어서
// 데이터가 어떻게 바뀌어도 문구가 절대 변하지 않았다.
function OverviewSummary({ overview: o }: { overview: InterOverview }) {
  const maxT = Math.max(1, ...o.timeline.map(t => t.count));
  return (
    <div className="bg-white border-[1.5px] border-spark-border rounded-2xl p-5 mb-6">
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-emerald-600 mb-4">
        📈 <span>{o.domainLabel} 트렌드 개요</span>
        <span className="ml-auto text-[10px] font-medium normal-case text-spark-muted">집계값 기준 · AI 생성 문구 아님</span>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <div className="text-[11px] text-spark-muted">선별 기사</div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-2xl font-extrabold tabular-nums text-spark-ink">{o.total}</span>
            <DeltaChip deltaPct={o.deltaPct} count={o.total} />
          </div>
          <div className="text-[10px] text-spark-muted">직전 동일 기간 {o.prevTotal}건</div>
        </div>
        <div>
          <div className="text-[11px] text-spark-muted">가장 뜨거운 분야</div>
          <div className="truncate text-sm font-bold text-spark-ink">{o.topSectors[0]?.name ?? '—'}</div>
          <div className="text-[10px] text-spark-muted">
            {o.topSectors[0] ? `${o.topSectors[0].count}건 · 전체의 ${Math.round(o.topSectors[0].share * 100)}%` : '데이터 없음'}
          </div>
        </div>
        <div>
          <div className="text-[11px] text-spark-muted">포트폴리오 연결</div>
          <div className="text-2xl font-extrabold tabular-nums text-emerald-700">{o.matchedCompanyCount}</div>
          <div className="text-[10px] text-spark-muted">매치 {o.matchCount}건</div>
        </div>
        <div>
          <div className="text-[11px] text-spark-muted mb-1">기간 내 추이</div>
          <span className="flex h-8 items-end gap-[3px]">
            {o.timeline.map((t, i) => (
              <span key={i} title={`${t.label} · ${t.count}건`} className={`w-2 rounded-sm ${t.count === 0 ? 'bg-spark-cream' : 'bg-emerald-500'}`} style={{ height: `${Math.max(8, (t.count / maxT) * 100)}%` }} />
            ))}
          </span>
        </div>
      </div>

      {o.topCompanies.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-spark-cream pt-3">
          <span className="mr-1 text-[11px] font-semibold text-spark-ink-soft">가장 많이 걸린 포트폴리오사</span>
          {o.topCompanies.map(c => (
            <span key={c.name} className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700" title={c.sectors.join(', ')}>
              📎 {c.name} <span className="tabular-nums opacity-70">{c.count}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function SectorHeatmap({
  sectors,
  overview,
  badgeReasons,
  reasonsLoading,
  onSelect,
}: {
  sectors: SectorBlock[];
  overview: InterOverview;
  badgeReasons: Record<string, string | null>;
  reasonsLoading: boolean;
  onSelect: (id: string) => void;
}) {
  // 정렬: 데이터 있는 섹터 먼저, 그 안에서 건수 많은 순. (예전엔 고정 순서라
  // '데이터 없음' 줄이 화면 중간에 끼어 시선을 끊었다)
  const rows = sectors
    .slice()
    .sort((a, b) => b.metrics.count - a.metrics.count);
  const maxVolume = Math.max(1, ...rows.map(r => r.metrics.count));

  return (
    <div className="bg-white border border-spark-border rounded-2xl p-5 mb-6">
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-spark-ink-soft mb-1">
        📊 <span>분야별 이슈 강도</span>
        <span className="ml-auto flex items-center gap-3 text-[10px] font-medium normal-case text-spark-muted">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-500" />급증</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" />기회</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" />주요 흐름</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-gray-300" />관측 중</span>
        </span>
      </div>
      <p className="mb-4 text-[11px] text-spark-muted">
        상태 라벨은 <b>직전 동일 기간 대비 증감 · 포트폴리오 매치 수 · 도메인 내 비중</b>으로 계산됩니다. 라벨에 마우스를 올리면 판정 근거 숫자가 보입니다.
      </p>
      <div className="flex flex-col gap-2.5">
        {rows.map(sector => {
          const reason = badgeReasons[sector.id];
          const reasonKnown = sector.id in badgeReasons;
          const m = sector.metrics;
          return (
            <div key={sector.id} className="rounded-lg px-2 py-1.5 hover:bg-spark-subtle">
              <button onClick={() => onSelect(sector.id)} className="flex w-full items-center gap-3 text-left">
                <span className="w-8 shrink-0 text-center text-[15px]">{sector.icon}</span>
                <span className="w-24 shrink-0 text-xs font-bold text-spark-ink">{sector.name}</span>
                <div className="relative h-5 flex-1 overflow-hidden rounded-md bg-spark-cream">
                  <div
                    className={`h-full rounded-md ${BAR_CLS[sector.badge.kind]}`}
                    style={{ width: `${m.count === 0 ? 0 : Math.max(6, (m.count / maxVolume) * 100)}%` }}
                  />
                </div>
                <span className="w-7 shrink-0 text-right text-[11px] font-bold tabular-nums text-spark-ink-soft">{m.count}</span>
                <span className="w-12 shrink-0 text-right"><DeltaChip deltaPct={m.deltaPct} count={m.count} /></span>
                <span className="hidden shrink-0 sm:block"><Sparkline values={m.timeline} cls={BAR_CLS[sector.badge.kind]} /></span>
                <span className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-bold ${BADGE_CLS[sector.badge.kind]}`} title={sector.badge.why}>
                  {sector.badge.label}
                </span>
                {m.matchCount > 0 ? (
                  <span className="flex w-[104px] shrink-0 items-center gap-1 truncate rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                    📎 {m.matchedCompanies[0]}
                    {m.matchedCompanies.length > 1 ? ` 외 ${m.matchedCompanies.length - 1}` : ''}
                  </span>
                ) : (
                  <span className="w-[104px] shrink-0" />
                )}
              </button>
              <div className="mt-1 pl-11 pr-6 text-[11px] leading-snug text-spark-ink-soft">
                {m.count === 0 ? (
                  <span className="text-spark-muted">이 기간·국가 조건에서 수집된 기사가 없습니다</span>
                ) : !reasonKnown && reasonsLoading ? (
                  <span className="text-spark-muted">🤖 요약 분석 중…</span>
                ) : reason ? (
                  <span><span className="font-semibold text-emerald-600">🤖 AI 요약</span> · {reason}</span>
                ) : (
                  <span className="text-spark-muted">⚙️ 기본 요약 · {sector.badge.why}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {overview.emptySectors.length > 0 && (
        <p className="mt-3 border-t border-spark-cream pt-3 text-[11px] text-spark-muted">
          이 기간 기사가 0건인 분야: {overview.emptySectors.join(' · ')}
        </p>
      )}
    </div>
  );
}
