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
  type InterMatrix,
  type InterOverview,
  type InterStat,
  type MatrixCell,
  type SourceKind,
  type SectorBlock,
} from '@/lib/inter-sample-data';
import { InterScrapStar } from '@/components/InterScrapStar';
import { DateRangePicker } from '@/components/DateRangePicker';

interface InterApiResponse {
  summary: DomainSummary;
  overview: InterOverview;
  stats: InterStat[];
  sectors: SectorBlock[];
  matrix: InterMatrix;
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
  paper: 'bg-teal-100 text-teal-700',
  opinion: 'bg-amber-100 text-amber-700',
};

const SRC_LABEL: Record<SourceKind, string> = { news: '기사', paper: '논문', opinion: '오피니언' };
const SOURCE_KINDS: SourceKind[] = ['news', 'paper', 'opinion'];

// 요약 계산 시각은 KST 기준 HH:MM으로 표시 (daily-collect 사전계산 배치가 KST 하루 1회 도는 것과 맞춤)
function fmtKstTime(d: Date | string) {
  const kst = new Date(new Date(d).toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  return `${String(kst.getHours()).padStart(2, '0')}:${String(kst.getMinutes()).padStart(2, '0')}`;
}

function isFullYearRange(from: string, to: string): boolean {
  const fromDate = new Date(`${from}T00:00:00`);
  const toDate = new Date(`${to}T23:59:59`);
  const daysDiff = Math.round((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24));
  return daysDiff >= 350; // 약 1년 (365일 ± 15일 허용)
}

export function InterPanel({
  from, to, min, max, canScrap,
}: { from: string; to: string; min: string; max: string; canScrap: boolean }) {
  const router = useRouter();
  const sp = useSearchParams();
  const domain: InterDomain = sp.get('domain') === 'ai' ? 'ai' : 'bio';
  const country = (COUNTRY_TABS.find(c => c.id === sp.get('country'))?.id ?? 'all') as InterCountry;
  const isFullYear = isFullYearRange(from, to);

  // 조회에 실제로 쓰이는 값은 URL(from/to/country)이고, 아래 draft는 "고르는 중"인 값이다.
  // 기간·국가를 클릭할 때마다 화면이 새로 뜨면 여러 개를 바꿔 볼 수가 없어서,
  // 선택은 draft에만 반영(하이라이트는 즉시)하고 '확인'을 눌러야 URL이 바뀌며 조회된다.
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);
  const [draftCountry, setDraftCountry] = useState<InterCountry>(country);
  useEffect(() => { setDraftFrom(from); setDraftTo(to); setDraftCountry(country); }, [from, to, country]);
  const dirty = draftFrom !== from || draftTo !== to || draftCountry !== country;

  const [openSectors, setOpenSectors] = useState<Set<string>>(new Set());
  const [activeSrcTab, setActiveSrcTab] = useState<Record<string, SourceKind>>({});
  const [data, setData] = useState<InterApiResponse | null>(null);
  const [loading, setLoading] = useState(true);

  // URL 갱신 — 기간(DateRangePicker)과 같은 방식으로 도메인·국가도 URL에 남긴다.
  function pushParams(next: Record<string, string>) {
    const params = new URLSearchParams({ scope: 'inter', from, to, domain, country, ...next });
    router.push(`/dashboard?${params.toString()}`, { scroll: false });
  }

  // '확인' — 고른 기간·국가를 한 번에 적용한다. 도메인(바이오/AI)은 즉시 전환이라 여기 안 낀다.
  function applyDraft() {
    const params = new URLSearchParams({
      scope: 'inter', from: draftFrom, to: draftTo, domain, country: draftCountry,
    });
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
        <DomainTabBig label="AI" active={domain === 'ai'} activeCls="bg-emerald-50 border-emerald-600 text-emerald-700" onClick={() => pushParams({ domain: 'ai' })} />
      </div>

      {/* 조회 조건 — 기간·국가를 고른 뒤 '확인'을 눌러야 조회된다(클릭마다 화면이 새로 뜨지 않게) */}
      <div className="bg-white border border-spark-border rounded-2xl p-5 mb-6">
        {/* 조회 기간 */}
        <div className="flex flex-wrap items-center gap-3">
          <span className="w-full sm:w-24 shrink-0 text-[14px] font-semibold text-spark-ink-soft">조회 기간</span>
          <DateRangePicker
            from={draftFrom}
            to={draftTo}
            min={min}
            max={max}
            scope="inter"
            accent="green"
            hideLabel
            onStage={(nf, nt) => { setDraftFrom(nf); setDraftTo(nt); }}
          />
        </div>

        <div className="my-3.5 border-t border-spark-cream" />

        {/* 국가 필터 — 실제 조회에 반영된다(InterNewsVerdict.country) */}
        <div className="flex flex-wrap items-center gap-3">
          <span className="w-full sm:w-24 shrink-0 text-[14px] font-semibold text-spark-ink-soft">국가별 트렌드</span>
          <div className="flex flex-wrap gap-1.5">
            {COUNTRY_TABS.map(c => {
              const n = data?.overview.byCountry.find(b => b.id === c.id)?.count;
              return (
                <button
                  key={c.id}
                  onClick={() => setDraftCountry(c.id)}
                  aria-pressed={draftCountry === c.id}
                  className={`rounded-lg border-[1.5px] px-3.5 py-1.5 text-[14px] font-semibold transition-colors ${
                    draftCountry === c.id ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-spark-subtle border-spark-border text-spark-ink-soft hover:bg-spark-cream'
                  }`}
                >
                  {c.label}
                  {c.id !== 'all' && n !== undefined && <span className="ml-1 opacity-70 tabular-nums">{n}</span>}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-3.5 flex flex-wrap items-end justify-between gap-3 border-t border-spark-cream pt-3.5">
          <p className="max-w-[62ch] text-[13px] leading-snug text-spark-muted">
            기간과 국가를 하나씩 고른 뒤 <b className="text-spark-ink-soft">확인</b>을 누르면 해당 조건의 데이터가 표시됩니다.
            국가는 기사 판정 단계에서 분류된 값이라, 분류 이전에 수집된 과거 기사는 <b className="text-spark-ink-soft">전체</b>에서만 보입니다.
          </p>
          <button
            onClick={applyDraft}
            disabled={!dirty}
            className={`shrink-0 rounded-lg px-6 py-2 text-[14px] font-bold transition-colors ${
              dirty
                ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                : 'bg-spark-subtle text-spark-muted cursor-default border border-spark-border'
            }`}
          >
            확인
          </button>
        </div>
      </div>

      {loading || !data ? (
        <div className="py-16 text-center text-[15px] text-spark-muted">불러오는 중...</div>
      ) : (
        <>
          {/* 1년 기간 경고 배너 */}
          {isFullYear && (
            <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3.5">
              <div className="flex gap-3">
                <span className="mt-0.5 shrink-0 text-[16px]">⚙️</span>
                <div className="flex-1">
                  <div className="text-[14px] font-semibold text-amber-900">데이터 정리 중</div>
                  <p className="mt-0.5 text-[13px] leading-relaxed text-amber-800">
                    1년 기간은 직전 비교 기간의 데이터가 충분하지 않아 정확한 성장률 계산이 불가능합니다. 비교 기간 전체를 백필하면 의미 있는 수치가 표시됩니다.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* 헤드라인 4지표 — 매트릭스를 읽는 데 필요한 값들(총량·증감, 가장 뜨거운 칸, 포트폴리오 접점) */}
          <HeadlineStats headline={data.matrix.headline} isFullYear={isFullYear} />

          {/* 주제×사건유형 매트릭스 + 인사이트 패널 2분할 */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-6">
            <SectorMatrix
              matrix={data.matrix}
              canScrap={canScrap}
              onSelect={topicKey => {
                const id = `sec-${topicKey}`;
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
          <ColoredSummaryCard summary={data.summary} overview={data.overview} isFullYear={isFullYear} />

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
                isFullYear={isFullYear}
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
      className={`rounded-xl border-2 px-8 py-3.5 text-[16px] font-bold transition-colors ${
        active ? activeCls : 'bg-white border-spark-border text-spark-muted hover:bg-spark-subtle hover:text-spark-ink-soft'
      }`}
    >
      {label}
    </button>
  );
}

function DeltaChip({ deltaPct, count, isFullYear }: { deltaPct: number | null; count?: number; isFullYear?: boolean }) {
  if (isFullYear) return <span className="text-[11px] font-semibold text-amber-600">⚙️ 정리 중</span>;
  if (count === 0) return <span className="text-[11px] text-spark-muted">—</span>;
  // 직전 동일 기간이 0건이면 증감률을 낼 수 없다 — 이 기간에 처음 잡힌 흐름.
  if (deltaPct === null) return <span className="text-[11px] font-bold text-emerald-600">신규</span>;
  const up = deltaPct > 0;
  const flat = deltaPct === 0;
  return (
    <span className={`text-[11px] font-bold tabular-nums ${flat ? 'text-spark-muted' : up ? 'text-red-500' : 'text-blue-500'}`}>
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
  isFullYear,
}: {
  sector: SectorBlock;
  canScrap: boolean;
  open: boolean;
  onToggle: () => void;
  activeTab: SourceKind;
  onTabChange: (t: SourceKind) => void;
  isFullYear?: boolean;
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
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-spark-cream text-[16px]">{sector.icon}</div>
        <div className="min-w-0">
          <div className="text-[14px] font-bold text-spark-ink">{sector.name}</div>
          <div className="text-[12px] text-spark-muted">{sector.sub}</div>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <span className="text-[12px] tabular-nums text-spark-muted">{sector.metrics.count}건</span>
          <DeltaChip deltaPct={sector.metrics.deltaPct} count={sector.metrics.count} isFullYear={isFullYear} />
          <span className={`rounded px-2 py-0.5 text-[11px] font-bold ${BADGE_CLS[sector.badge.kind]}`} title={sector.badge.why}>
            {sector.badge.label}
          </span>
        </div>
        <span className={`shrink-0 text-[12px] text-gray-300 transition-transform ${open ? 'rotate-180' : ''}`}>▼</span>
      </div>

      {open && (
        <div className="rounded-b-xl border border-t-0 border-spark-border bg-white overflow-hidden">
          <div className="border-b border-spark-cream bg-spark-subtle px-4 py-2 text-[12px] text-spark-ink-soft">
            <b className="text-spark-ink">{sector.badge.label}</b> 판정 근거 · {sector.badge.why}
          </div>

          {sector.matches.length > 0 && (
            <div className="flex flex-col gap-1.5 border-b border-spark-cream bg-spark-subtle px-4 py-2.5">
              {sector.matches.map(m => (
                <div key={`${m.co}-${m.desc}`} className="flex items-center gap-2.5 text-[13px]">
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
                className={`border-b-2 px-3.5 py-2 text-[12px] font-semibold transition-colors ${
                  activeTab === k ? 'border-spark-ink text-spark-ink' : 'border-transparent text-spark-muted hover:text-spark-ink-soft'
                }`}
              >
                {SRC_LABEL[k]} {sector.items[k].length}
              </button>
            ))}
          </div>

          <div className="py-1">
            {items.length === 0 ? (
              <div className="py-4 text-center text-[13px] text-spark-muted">해당 탭에 항목이 없습니다</div>
            ) : (
              items.map(it => (
                <div key={it.id} className="flex items-start gap-2.5 border-b border-spark-cream/60 px-4 py-2.5 last:border-0 hover:bg-spark-subtle">
                  <a href={it.url} target="_blank" rel="noopener noreferrer" className="flex flex-1 items-start gap-2.5 min-w-0">
                    <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[11px] font-bold ${SRC_BADGE_CLS[it.badge]}`}>{SRC_LABEL[it.badge]}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-semibold leading-snug text-spark-ink">{it.title}</div>
                      {it.titleOriginal !== it.title && (
                        <div className="mt-0.5 text-[12px] leading-snug text-spark-muted">{it.titleOriginal}</div>
                      )}
                      <div className="mt-0.5 text-[12px] text-spark-muted">{it.media} · {it.date}</div>
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

// AI 요약 문장 속 **키워드** 마크다운을 하이라이트 처리해서 렌더링.
function renderHighlighted(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    const m = part.match(/^\*\*([^*]+)\*\*$/);
    if (!m) return <span key={i}>{part}</span>;
    return (
      <span key={i} className="rounded bg-emerald-50 px-1 font-semibold text-emerald-700">
        {m[1]}
      </span>
    );
  });
}

function ColoredSummaryItem({ n, k, v, chips, last }: { n: number; k: string; v: string; chips?: SummaryChip[]; last?: boolean }) {
  return (
    <div className={`flex gap-2.5 py-2.5 text-[14px] leading-relaxed text-spark-ink-soft ${last ? '' : 'border-b border-spark-cream'}`}>
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-[11px] font-bold text-emerald-700">
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <div>
          <span className="mr-1 font-semibold text-spark-ink">{k}</span>
          <span>{renderHighlighted(v)}</span>
        </div>
        {chips && chips.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {chips.map((c, i) => (
              <span key={i} className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${c.cls}`}>{c.label}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// 3줄 요약 — AI가 쓴 서술 문장은 그대로 두되, 그 밑에 실제 집계값 칩(증감률·매치 기업)을 색깔로 붙여
// 문장이 숫자로 뒷받침된다는 걸 한눈에 보여준다.
function ColoredSummaryCard({ summary, overview, isFullYear }: { summary: DomainSummary; overview: InterOverview; isFullYear?: boolean }) {
  const top = overview.topSectors[0];
  return (
    <div className="bg-white border-[1.5px] border-spark-border rounded-2xl p-5 mb-6">
      <div className="flex flex-wrap items-center gap-1.5 text-[12px] font-bold uppercase tracking-wide text-emerald-600 mb-3">
        ✦ <span>{summary.label} 종합 요약</span>
        <span className="ml-auto text-[11px] font-medium normal-case text-spark-muted">집계값 + AI 한 줄 · {overview.domainLabel} 기준</span>
      </div>
      <ColoredSummaryItem
        n={1}
        k="트렌드 1줄 요약"
        v={summary.trend}
        chips={[
          ...(top
            ? [{ label: `${top.name} ${isFullYear ? '⚙️ 정리 중' : top.deltaPct === null ? '신규' : `${top.deltaPct > 0 ? '▲' : '▼'}${Math.abs(top.deltaPct)}%`}`, cls: isFullYear ? 'bg-amber-50 text-amber-600' : 'bg-red-50 text-red-600' }]
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
      <div className="mt-2 text-[11px] text-gray-400">
        {summary.source === 'fallback'
          ? '⚙️ 기본 요약 · AI 분석 대기 중(다음 수집 때 자동 갱신)'
          : `🤖 AI 요약 · ${fmtKstTime(summary.computedAt!)} 기준`}
      </div>
    </div>
  );
}

// 헤드라인 4지표 — 매트릭스를 읽는 데 필요한 값만. 전부 실제 집계값.
function HeadlineStats({ headline: h, isFullYear }: { headline: InterMatrix['headline']; isFullYear?: boolean }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 mb-6">
      <div className="bg-white border border-spark-border rounded-xl px-4 py-3.5">
        <div className="text-[12px] text-spark-muted mb-1">선별 기사</div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-2xl font-extrabold tabular-nums text-spark-ink">{h.total}</span>
          <DeltaChip deltaPct={h.deltaPct} count={h.total} isFullYear={isFullYear} />
        </div>
        <div className="text-[11px] text-spark-muted mt-0.5">직전 동일 기간 {h.prevTotal}건</div>
      </div>

      <div className="bg-white border border-spark-border rounded-xl px-4 py-3.5">
        <div className="text-[12px] text-spark-muted mb-1">가장 뜨거운 칸</div>
        <div className="truncate text-[15px] font-extrabold text-spark-ink" title={h.hottest?.label}>
          {h.hottest?.label ?? '—'}
        </div>
        <div className="text-[11px] text-spark-muted mt-0.5">
          {h.hottest ? (
            <>
              {h.hottest.count}건 · 직전 {h.hottest.prevCount}건
              {h.hottest.deltaPct !== null ? (
                <> → <span className="font-bold text-red-500">▲{h.hottest.deltaPct}%</span></>
              ) : h.hottest.prevCount === 0 ? (
                <> → <span className="font-bold text-emerald-600">신규</span></>
              ) : null}
            </>
          ) : (
            '데이터 없음'
          )}
        </div>
      </div>

      <div className="bg-white border border-spark-border rounded-xl px-4 py-3.5">
        <div className="text-[12px] text-spark-muted mb-1">포트폴리오 연결</div>
        <div className="flex items-baseline gap-0.5">
          <span className="text-2xl font-extrabold tabular-nums text-emerald-700">{h.matchedCompanyCount}</span>
          <span className="text-[13px] font-semibold text-emerald-700">개사</span>
        </div>
        <div className="text-[11px] text-spark-muted mt-0.5">매치 {h.matchCount}건</div>
      </div>

      <div className="bg-white border border-spark-border rounded-xl px-4 py-3.5">
        <div className="text-[12px] text-spark-muted mb-1">우리와 겹치는 칸</div>
        <div className="flex items-baseline">
          <span className="text-2xl font-extrabold tabular-nums text-spark-ink">{h.overlapCells}</span>
          <span className="text-[15px] font-bold text-spark-muted">/{h.totalCells}</span>
        </div>
        <div className="truncate text-[11px] text-spark-muted mt-0.5">
          {h.overlapTopics.length > 0 ? `${h.overlapTopics.join('·')} 중심` : '겹치는 칸 없음'}
        </div>
      </div>
    </div>
  );
}

// A안 — 주제 × 사건유형 매트릭스.
// 행은 주제(topicSector), 열은 사건유형(eventType) — 축이 분리돼 있어서 "항암에서 투자·딜이 터졌다"가
// 한 칸으로 읽힌다. 칸을 누르면 그 조합의 판정 근거·매치기업·대표기사가 바로 아래에 열린다.
function SectorMatrix({
  matrix,
  canScrap,
  onSelect,
}: {
  matrix: InterMatrix;
  canScrap: boolean;
  onSelect: (topicKey: string) => void;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const rows = matrix.rows.slice().sort((a, b) => b.total - a.total);
  const active: MatrixCell | null = rows.flatMap(r => r.cells).find(c => c.id === activeId) ?? null;

  function cellShade(n: number) {
    if (n === 0) return 'bg-spark-subtle text-spark-border';
    const ratio = n / matrix.maxCell;
    if (ratio > 0.66) return 'bg-emerald-600 text-white';
    if (ratio > 0.33) return 'bg-emerald-200 text-emerald-900';
    return 'bg-emerald-50 text-emerald-800';
  }

  return (
    <div className="bg-white border border-spark-border rounded-2xl p-5">
      <div className="flex flex-wrap items-center gap-1.5 text-[12px] font-bold uppercase tracking-wide text-spark-ink-soft mb-1">
        📊 <span>주제 × 사건 유형</span>
        <span className="ml-auto flex items-center gap-2.5 text-[11px] font-medium normal-case text-spark-muted">
          <span className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-sm bg-emerald-50" />
            <span className="h-2.5 w-2.5 rounded-sm bg-emerald-200" />
            <span className="h-2.5 w-2.5 rounded-sm bg-emerald-600" />
            기사 적음→많음
          </span>
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm ring-2 ring-red-500" />급증 칸</span>
        </span>
      </div>
      <p className="mb-3 text-[12px] text-spark-muted">
        행은 <b>무엇에 관한 기사</b>, 열은 <b>무슨 일이 일어났는가</b>입니다. 칸을 누르면 그 조합의 판정 근거와 대표 기사가 아래에서 열립니다.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-[11px] text-spark-muted">
              <th className="text-left font-semibold pb-1.5 pr-2">주제</th>
              {matrix.eventTypes.map(e => (
                <th key={e.key} className="font-semibold pb-1.5 px-1 text-center whitespace-nowrap" title={e.sub}>{e.key}</th>
              ))}
              <th className="text-right font-semibold pb-1.5 pl-2">계</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.topicKey}>
                <td className="py-1 pr-2 whitespace-nowrap">
                  <button onClick={() => onSelect(row.topicKey)} className="text-left hover:underline">
                    <span className="mr-1">{row.icon}</span>
                    <span className="font-bold text-spark-ink">{row.topicKey}</span>
                  </button>
                </td>
                {row.cells.map(cell => (
                  <td key={cell.id} className="px-1 py-1">
                    <button
                      onClick={() => setActiveId(prev => (prev === cell.id ? null : cell.id))}
                      disabled={cell.count === 0}
                      aria-pressed={activeId === cell.id}
                      title={cell.count === 0 ? '해당 기사 없음' : `${cell.topicKey} × ${cell.eventKey} · ${cell.badge.why}`}
                      className={`mx-auto flex h-7 w-full min-w-[38px] items-center justify-center rounded-md font-bold tabular-nums transition-all ${cellShade(cell.count)} ${
                        cell.badge.kind === 'surge' ? 'ring-2 ring-red-500' : ''
                      } ${activeId === cell.id ? 'ring-2 ring-spark-ink ring-offset-1' : ''} ${
                        cell.count === 0 ? 'cursor-default' : 'cursor-pointer hover:brightness-95'
                      }`}
                    >
                      {cell.count === 0 ? '·' : cell.count}
                    </button>
                  </td>
                ))}
                <td className="py-1 pl-2 text-right font-bold tabular-nums text-spark-muted">{row.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 칸 클릭 시 그 조합만의 부연설명 */}
      {active ? (
        <div className="mt-3 rounded-xl border border-spark-border bg-spark-subtle p-3.5">
          <div className="flex flex-wrap items-center gap-2 mb-1.5">
            <span className={`rounded px-2 py-0.5 text-[11px] font-bold ${BADGE_CLS[active.badge.kind]}`}>{active.badge.label}</span>
            <span className="text-[13px] font-extrabold text-spark-ink">{active.topicKey} × {active.eventKey}</span>
            <button onClick={() => onSelect(active.topicKey)} className="ml-auto text-[12px] font-semibold text-emerald-700 hover:underline">
              {active.topicKey} 전체 기사 →
            </button>
          </div>
          <p className="text-[12px] leading-snug text-spark-ink-soft">{active.badge.why}</p>

          {active.matchedCompanies.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {active.matchedCompanies.slice(0, 5).map(co => (
                <span key={co} className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">📎 {co}</span>
              ))}
              {active.matchedCompanies.length > 5 && (
                <span className="text-[11px] text-spark-muted self-center">외 {active.matchedCompanies.length - 5}개사</span>
              )}
            </div>
          )}

          {active.topItems.length > 0 && (
            <div className="mt-2.5 flex flex-col gap-1.5 border-t border-spark-border pt-2.5">
              {active.topItems.map(it => (
                <div key={it.id} className="flex items-start gap-2">
                  <a href={it.url} target="_blank" rel="noopener noreferrer" className="flex-1 min-w-0 group">
                    <div className="text-[12px] font-semibold leading-snug text-spark-ink group-hover:underline">{it.title}</div>
                    <div className="text-[11px] text-spark-muted">{it.media} · {it.date}</div>
                  </a>
                  {canScrap && <InterScrapStar id={it.id} initial={it.isScrapped} />}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <p className="mt-3 text-[12px] text-spark-muted">
          칸을 누르면 그 조합의 판정 근거·포트폴리오 매치·대표 기사가 여기에 열립니다.
        </p>
      )}

      {matrix.untagged > 0 && (
        <p className="mt-2.5 border-t border-spark-cream pt-2.5 text-[11px] text-spark-muted">
          이 기간 기사 중 {matrix.untagged}건은 주제·사건유형이 아직 분류되지 않아 격자에 포함되지 않았습니다
          (도메인 전반 기사이거나 백필 대상).
        </p>
      )}
    </div>
  );
}

// 인사이트 패널 — 산점도 대신, 실제 집계값에서 뽑아낸 한줄·포지션·놓치기 쉬운 곳·액션
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
        <div className="flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-wide text-spark-ink-soft mb-3">
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
          <div className="text-[12px] font-bold text-spark-ink-soft mb-2">📎 가장 많이 걸린 포트폴리오사</div>
          <div className="flex flex-col gap-1.5">
            {overview.topCompanies.map(c => (
              <div key={c.name} className="grid grid-cols-[88px_1fr_28px] items-center gap-2 text-[13px]">
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
      <div className="text-[12px] font-bold text-spark-muted mb-0.5">{k}</div>
      <p className="text-[14px] leading-relaxed text-spark-ink-soft">{children}</p>
    </div>
  );
}
