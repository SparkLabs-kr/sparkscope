'use client';

// Inter(해외 트렌드) 탭 — 바이오/AI 도메인별 해외 기사·논문·오피니언 트렌드 + 포트폴리오 매치.
//
// /api/inter?domain=bio|ai&from=&to=&country= 에서 실제 DB 데이터(RSS 수집 → Gemini
// 필터링(국가 판별 포함) → GPT 포트폴리오 매칭 파이프라인 결과)를 받아온다. 상단 AI 요약은
// daily-collect 크론이 하루 1회 미리 계산(inter-summary.ts)해 둔 것을 읽기만 한다.
//
// 도메인·국가·기간은 모두 URL(?scope=inter&domain=&country=&from=&to=)에 담긴다 —
// 기간 선택은 Intra 탭과 완전히 같은 DateRangePicker를 그대로 재사용하기 위해 URL 기반이어야 한다.

import { useEffect, useState, type ReactNode } from 'react';
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

const SRC_BADGE_CLS: Record<SourceKind, string> = {
  news: 'bg-blue-100 text-blue-700',
  paper: 'bg-violet-100 text-violet-700',
  opinion: 'bg-amber-100 text-amber-700',
};

const SRC_LABEL: Record<SourceKind, string> = { news: '기사', paper: '논문', opinion: '오피니언' };
const SOURCE_KINDS: SourceKind[] = ['news', 'paper', 'opinion'];

// 요약 계산 시각은 KST 기준 HH:MM으로 표시 (daily-collect 사전계산 배치가 KST 하루 1회 도는 것과 맞춤)
function fmtKstTime(d: Date | string) {
  const kst = new Date(new Date(d).toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  return `${String(kst.getHours()).padStart(2, '0')}:${String(kst.getMinutes()).padStart(2, '0')}`;
}

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
          {/* 통계 */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 mb-6">
            {data.stats.map(s => (
              <div key={s.label} className="bg-white border border-spark-border rounded-xl px-4 py-3.5" title={s.hint}>
                <div className="text-[11px] text-spark-muted mb-1">{s.label}</div>
                <div className="text-xl font-extrabold tabular-nums text-spark-ink">{s.value}</div>
              </div>
            ))}
          </div>

          {/* A(매트릭스) + C(포지셔닝 맵) 2분할 — 개요 요약을 대체 */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-6">
            <SectorMatrix
              sectors={data.sectors}
              onSelect={id => {
                setOpenSectors(prev => new Set(prev).add(id));
                document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }}
            />
            <InsightPanel
              sectors={data.sectors}
              overview={data.overview}
              onSelect={id => {
                setOpenSectors(prev => new Set(prev).add(id));
                document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }}
            />
          </div>

          {/* AI 요약 — 위 매트릭스의 숫자를 그대로 되풀이하지 않고, 그래서 뭘 해야 하는지로 마무리 */}
          <ColoredSummaryCard summary={data.summary} overview={data.overview} />

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

type SummaryChip = { label: string; cls: string };

function ColoredSummaryItem({ n, k, v, chips, last }: { n: number; k: string; v: string; chips?: SummaryChip[]; last?: boolean }) {
  return (
    <div className={`flex gap-2.5 py-2.5 text-[13px] leading-relaxed text-spark-ink-soft ${last ? '' : 'border-b border-spark-cream'}`}>
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-[10px] font-bold text-emerald-700">
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <div>
          <span className="mr-1 font-semibold text-spark-ink">{k}</span>
          <span>{v}</span>
        </div>
        {chips && chips.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {chips.map((c, i) => (
              <span key={i} className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${c.cls}`}>{c.label}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// 3줄 요약 — AI가 쓴 서술 문장은 그대로 두되, 그 밑에 실제 집계값 칩(증감률·매치 기업)을 색깔로 붙여
// 문장이 숫자로 뒷받침된다는 걸 한눈에 보여준다.
function ColoredSummaryCard({ summary, overview }: { summary: DomainSummary; overview: InterOverview }) {
  const top = overview.topSectors[0];
  return (
    <div className="bg-white border-[1.5px] border-spark-border rounded-2xl p-5 mb-6">
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-emerald-600 mb-3">
        ✦ <span>{summary.label} 종합 요약</span>
        <span className="ml-auto text-[10px] font-medium normal-case text-spark-muted">집계값 + AI 한 줄 · {overview.domainLabel} 기준</span>
      </div>
      <ColoredSummaryItem
        n={1}
        k="트렌드 1줄 요약"
        v={summary.trend}
        chips={[
          ...(top
            ? [{ label: `${top.name} ${top.deltaPct === null ? '신규' : `${top.deltaPct > 0 ? '▲' : '▼'}${Math.abs(top.deltaPct)}%`}`, cls: 'bg-red-50 text-red-600' }]
            : []),
          { label: `기사 ${overview.total}건 · 매체 ${overview.sourceCount}곳`, cls: 'bg-spark-subtle text-spark-ink-soft' },
        ]}
      />
      <ColoredSummaryItem
        n={2}
        k="스파크랩의 포지션"
        v={summary.position}
        chips={overview.topCompanies.slice(0, 4).map(c => ({ label: `📎 ${c.name} ${c.count}`, cls: 'bg-emerald-50 text-emerald-700' }))}
      />
      <ColoredSummaryItem n={3} k="취해야 할 가장 중요한 액션" v={summary.action} last />
      <div className="mt-2 text-[10px] text-gray-400">
        {summary.source === 'fallback'
          ? '⚙️ 기본 요약 · AI 분석 대기 중(다음 수집 때 자동 갱신)'
          : `🤖 AI 요약 · ${fmtKstTime(summary.computedAt!)} 기준`}
      </div>
    </div>
  );
}

// A안 — 주제(섹터) × 사건 유형 매트릭스.
// ⚠ 임시 축: InterNewsVerdict에 "사건 유형"(투자·딜/규제·승인/연구성과…) 태그가 아직 없어서,
// 지금 있는 SourceKind(뉴스/논문/오피니언)를 자리표시자 열로 대신 쓴다. 사건유형 판정이
// 붙으면(프롬프트 확장 + 백필) 이 컬럼만 그 값으로 교체하면 된다 — 행 구조는 그대로 재사용 가능.
function SectorMatrix({ sectors, onSelect }: { sectors: SectorBlock[]; onSelect: (id: string) => void }) {
  const rows = sectors.slice().sort((a, b) => b.metrics.count - a.metrics.count);
  const maxCell = Math.max(1, ...rows.flatMap(r => SOURCE_KINDS.map(k => r.items[k].length)));
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = rows.find(r => r.id === activeId) ?? null;

  function cellShade(n: number) {
    if (n === 0) return 'bg-transparent text-spark-border';
    const ratio = n / maxCell;
    if (ratio > 0.66) return 'bg-emerald-600 text-white';
    if (ratio > 0.33) return 'bg-emerald-200 text-emerald-900';
    return 'bg-emerald-50 text-emerald-800';
  }

  return (
    <div className="bg-white border border-spark-border rounded-2xl p-5">
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-spark-ink-soft mb-1">
        📊 <span>주제 × 사건 유형</span>
        <span className="ml-auto text-[10px] font-medium normal-case text-amber-600">임시: 소스 유형으로 대체 표시</span>
      </div>
      <p className="mb-3 text-[11px] text-spark-muted">
        사건 유형(투자·딜/규제·승인 등) 태깅이 아직 없어, 지금은 뉴스·논문·오피니언 구성으로 대신 봅니다.
        분야를 누르면 판정 근거와 대표 기사가 아래에 열립니다.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] text-spark-muted">
              <th className="text-left font-semibold pb-1.5 pr-2">분야</th>
              {SOURCE_KINDS.map(k => (
                <th key={k} className="font-semibold pb-1.5 px-1 text-center">{SRC_LABEL[k]}</th>
              ))}
              <th className="text-right font-semibold pb-1.5 pl-2">계</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(sector => (
              <tr
                key={sector.id}
                onClick={() => setActiveId(prev => (prev === sector.id ? null : sector.id))}
                className={`cursor-pointer transition-colors ${activeId === sector.id ? 'bg-spark-subtle' : 'hover:bg-spark-subtle'}`}
              >
                <td className="py-1 pr-2 whitespace-nowrap">
                  <span className="mr-1">{sector.icon}</span>
                  <span className="font-bold text-spark-ink">{sector.name}</span>
                </td>
                {SOURCE_KINDS.map(k => {
                  const n = sector.items[k].length;
                  return (
                    <td key={k} className="px-1 py-1">
                      <div className={`mx-auto flex h-7 w-10 items-center justify-center rounded-md font-bold tabular-nums ${cellShade(n)} ${
                        sector.badge.kind === 'surge' && n === Math.max(...SOURCE_KINDS.map(kk => sector.items[kk].length)) && n > 0
                          ? 'ring-2 ring-red-500'
                          : ''
                      }`}>
                        {n === 0 ? '·' : n}
                      </div>
                    </td>
                  );
                })}
                <td className="py-1 pl-2 text-right font-bold tabular-nums text-spark-muted">{sector.metrics.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {active && (
        <div className="mt-3 rounded-xl border border-spark-border bg-spark-subtle p-3.5">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-sm">{active.icon}</span>
            <span className="text-xs font-bold text-spark-ink">{active.name}</span>
            <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${BADGE_CLS[active.badge.kind]}`}>{active.badge.label}</span>
            <button onClick={() => onSelect(active.id)} className="ml-auto text-[11px] font-semibold text-emerald-700 hover:underline">
              전체 기사 보기 →
            </button>
          </div>
          <p className="text-[11px] leading-snug text-spark-ink-soft">{active.badge.why}</p>
          {active.matches.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {active.matches.slice(0, 4).map(m => (
                <span key={`${m.co}-${m.desc}`} className="rounded-full bg-white border border-spark-border px-2 py-0.5 text-[10px] font-bold text-spark-ink-soft">
                  📎 {m.co}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// C안 — 포지셔닝 맵. x=도메인 내 비중(share), y=직전 대비 증감률(deltaPct), 버블 크기=포트폴리오 매치 수.
// 전부 SectorMetrics에 이미 있는 실제 집계값이라 별도 백필 없이 바로 그릴 수 있다.
// C안 자리를 대신하는 인사이트 패널 — 그래프 대신, 실제 집계값에서 뽑아낸 한줄·포지션·놓치기 쉬운 곳·액션
// 4줄 문장 + 포트폴리오 매치 바 리스트. 전부 SectorMetrics/InterOverview에 이미 있는 값이라 AI 호출 없음.
function InsightPanel({
  sectors,
  overview,
  onSelect,
}: {
  sectors: SectorBlock[];
  overview: InterOverview;
  onSelect: (id: string) => void;
}) {
  const withData = sectors.filter(s => s.metrics.count > 0);
  const byCount = withData.slice().sort((a, b) => b.metrics.count - a.metrics.count);
  const top2 = byCount.slice(0, 2);
  const top2Share = Math.round(top2.reduce((s, x) => s + x.metrics.share, 0) * 100);

  const byMatch = withData.slice().sort((a, b) => b.metrics.matchCount - a.metrics.matchCount);
  const topMatch = byMatch[0];

  const sneaky = withData
    .filter(s => !top2.includes(s))
    .filter(s => s.metrics.deltaPct !== null && s.metrics.deltaPct > 0)
    .sort((a, b) => (b.metrics.deltaPct ?? 0) - (a.metrics.deltaPct ?? 0))[0];

  const maxCompanyCount = Math.max(1, ...overview.topCompanies.map(c => c.count));

  return (
    <div className="bg-white border border-spark-border rounded-2xl p-5 flex flex-col gap-4">
      <div>
        <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-spark-ink-soft mb-3">
          ✦ <span>이 화면이 말하는 것</span>
        </div>
        <div className="flex flex-col gap-3">
          <InsightRow k="한 줄">
            {top2.length > 0 ? (
              <>
                자금과 뉴스가 <b className="text-spark-ink">{top2.map(s => s.name).join('·')}</b> 분야로 몰리고 있습니다.
                {top2Share > 0 && <> (전체의 {top2Share}%)</>}
              </>
            ) : (
              '이 기간·조건에서 두드러진 분야가 없습니다.'
            )}
          </InsightRow>
          <InsightRow k="우리 위치">
            {topMatch && topMatch.metrics.matchCount > 0 ? (
              <>
                가장 큰 매치는 <b className="text-spark-ink">{topMatch.name}</b> — 매치 {topMatch.metrics.matchCount}건, {topMatch.metrics.matchedCompanies.length}개사가 걸려 있습니다.
              </>
            ) : (
              '이 기간 포트폴리오와 직접 연결된 매치가 없습니다.'
            )}
          </InsightRow>
          <InsightRow k="놓치기 쉬운 곳">
            {sneaky ? (
              <>
                <b className="text-spark-ink">{sneaky.name}</b>은 기사량은 적지만({sneaky.metrics.count}건) 증감률은 +{sneaky.metrics.deltaPct}%로 상위권입니다.
              </>
            ) : (
              '눈에 띄게 예외적인 분야는 없습니다.'
            )}
          </InsightRow>
          <InsightRow k="액션">
            {topMatch && topMatch.metrics.matchCount > 0 ? (
              <>
                <b className="text-spark-ink">{topMatch.name}</b> 매치 기업들의 최신 기사부터 확인하세요.{' '}
                <button onClick={() => onSelect(topMatch.id)} className="font-semibold text-emerald-700 hover:underline">
                  바로 보기 →
                </button>
              </>
            ) : (
              '아직 특정할 액션이 없습니다 — 데이터가 더 쌓이면 갱신됩니다.'
            )}
          </InsightRow>
        </div>
      </div>

      {overview.topCompanies.length > 0 && (
        <div className="border-t border-spark-cream pt-3.5">
          <div className="text-[11px] font-bold text-spark-ink-soft mb-2">📎 가장 많이 걸린 포트폴리오사</div>
          <div className="flex flex-col gap-1.5">
            {overview.topCompanies.map(c => (
              <div key={c.name} className="grid grid-cols-[88px_1fr_28px] items-center gap-2 text-xs">
                <span className="truncate font-semibold text-spark-ink-soft" title={c.sectors.join(', ')}>{c.name}</span>
                <span className="h-2 rounded-full bg-spark-cream overflow-hidden">
                  <span className="block h-full rounded-full bg-emerald-500" style={{ width: `${Math.max(6, (c.count / maxCompanyCount) * 100)}%` }} />
                </span>
                <span className="text-right font-bold tabular-nums text-spark-ink-soft">{c.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function InsightRow({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-bold text-spark-muted mb-0.5">{k}</div>
      <p className="text-[13px] leading-relaxed text-spark-ink-soft">{children}</p>
    </div>
  );
}
