'use client';
import { useT } from '@/lib/i18n/client';

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
import { InterBriefingModal, type BriefingPayload } from '@/components/InterBriefingModal';
import { DateRangePicker } from '@/components/DateRangePicker';
import { SocialSignals } from '@/components/SocialSignals';
import { clusterArticles } from '@/lib/sparkscope/cluster';

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

// 카드 하위 탭 — 판정 근거·포트폴리오 매치를 첫 탭으로 빼고, 나머지는 출처 종류별.
type CardTab = 'reason' | SourceKind;

// 브리핑(포폴사에 보낼 한 장) 생성에 필요한, 섹터 바깥의 맥락.
// 카드마다 다시 계산할 값이 아니라서 위에서 한 번 만들어 내려보낸다.
interface BriefingCtx {
  domainLabel: string;
  periodLabel: string;
  overview: BriefingPayload['overview'];
}

// 정렬 우선순위 — "급한 것부터"(급증 → 기회 → 주요 → 조용 → 데이터 없음).
// 기간을 바꾸면 metrics/badge가 다시 계산되므로 순서도 자동으로 따라 바뀐다.
const BADGE_PRIORITY: Record<string, number> = {
  surge: 0,
  opportunity: 1,
  major: 2,
  quiet: 3,
  none: 4,
};

function sortByUrgency(sectors: SectorBlock[]): SectorBlock[] {
  return sectors.slice().sort((a, b) => {
    const pa = BADGE_PRIORITY[a.badge.kind] ?? 9;
    const pb = BADGE_PRIORITY[b.badge.kind] ?? 9;
    if (pa !== pb) return pa - pb;
    return b.metrics.count - a.metrics.count; // 같은 등급 안에서는 기사 많은 순
  });
}

// 요약 계산 시각은 KST 기준 HH:MM으로 표시 (daily-collect 사전계산 배치가 KST 하루 1회 도는 것과 맞춤)
function fmtKstTime(d: Date | string) {
  const kst = new Date(new Date(d).toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  return `${String(kst.getHours()).padStart(2, '0')}:${String(kst.getMinutes()).padStart(2, '0')}`;
}

export function InterPanel({
  from, to, min, max, canScrap,
}: { from: string; to: string; min: string; max: string; canScrap: boolean }) {
  const t = useT();
  const router = useRouter();
  const sp = useSearchParams();
  const domain: InterDomain = sp.get('domain') === 'ai' ? 'ai' : 'bio';
  const country = (COUNTRY_TABS.find(c => c.id === sp.get('country'))?.id ?? 'all') as InterCountry;

  // 조회에 실제로 쓰이는 값은 URL(from/to/country)이고, 아래 draft는 "고르는 중"인 값이다.
  // 기간·국가를 클릭할 때마다 화면이 새로 뜨면 여러 개를 바꿔 볼 수가 없어서,
  // 선택은 draft에만 반영(하이라이트는 즉시)하고 '확인'을 눌러야 URL이 바뀌며 조회된다.
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);
  const [draftCountry, setDraftCountry] = useState<InterCountry>(country);
  useEffect(() => { setDraftFrom(from); setDraftTo(to); setDraftCountry(country); }, [from, to, country]);
  const dirty = draftFrom !== from || draftTo !== to || draftCountry !== country;

  // 카드가 항상 펼쳐진 형태(경쟁사 모니터링 카드와 동일)로 바뀌어서 여닫는 상태는 없다.
  // 매트릭스에서 주제를 누르면 해당 카드로 스크롤하며 잠깐 하이라이트만 준다.
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [activeSrcTab, setActiveSrcTab] = useState<Record<string, CardTab>>({});
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

  // 매트릭스 칸/주제를 눌렀을 때 해당 카드로 이동 + 2초간 테두리 하이라이트.
  function focusSector(id: string) {
    setHighlighted(id);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => setHighlighted(prev => (prev === id ? null : prev)), 2000);
  }

  const [badgeReasons, setBadgeReasons] = useState<Record<string, string | null>>({});
  const [reasonsLoading, setReasonsLoading] = useState(false);

  // 도메인·국가·기간이 바뀌면 섹터 구성이 달라지므로 사유 캐시를 비운다.
  useEffect(() => {
    setBadgeReasons({});
    setHighlighted(null);
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
      <div data-tour="inter-domain" className="flex flex-col sm:flex-row gap-3 mb-6">
        <DomainTabBig label={t('바이오')} active={domain === 'bio'} activeCls="bg-cyan-50 border-cyan-600 text-cyan-700" onClick={() => pushParams({ domain: 'bio' })} />
        <DomainTabBig label="AI" active={domain === 'ai'} activeCls="bg-emerald-50 border-emerald-600 text-emerald-700" onClick={() => pushParams({ domain: 'ai' })} />
      </div>

      {/* 소셜 시그널 — 도메인 버튼과 조회 기간 사이. 커뮤니티에서 뜨는 글은 기사보다 먼저
          움직이므로 조회 조건보다 위에 둔다. 기간은 적용된 from을 쓴다(draft 아님). */}
      <SocialSignals domain={domain} from={from} />

      {/* 조회 조건 — 기간·국가를 고른 뒤 '확인'을 눌러야 조회된다(클릭마다 화면이 새로 뜨지 않게) */}
      <div data-tour="inter-filter" className="bg-white border border-spark-border rounded-2xl p-5 mb-6">
        {/* 조회 기간 */}
        <div className="flex flex-wrap items-center gap-3">
          <span className="w-full sm:w-24 shrink-0 text-[14px] font-semibold text-spark-ink-soft">{t('조회 기간')}</span>
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
          <span className="w-full sm:w-24 shrink-0 text-[14px] font-semibold text-spark-ink-soft">{t('국가별 트렌드')}</span>
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
                  {t(c.label)}
                  {c.id !== 'all' && n !== undefined && <span className="ml-1 opacity-70 tabular-nums">{n}</span>}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-3.5 flex flex-wrap items-end justify-between gap-3 border-t border-spark-cream pt-3.5">
          <p className="max-w-[62ch] text-[13px] leading-snug text-spark-muted">
            {t('기간과 국가를 하나씩 고른 뒤')} <b className="text-spark-ink-soft">{t('확인')}</b>{t('을 누르면 해당 조건의 데이터가 표시됩니다.')}{' '}
            {t('국가는 기사 판정 단계에서 분류된 값이라, 분류 이전에 수집된 과거 기사는')} <b className="text-spark-ink-soft">{t('전체')}</b>{t('에서만 보입니다.')}
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
            {t('확인')}
          </button>
        </div>
      </div>

      {loading || !data ? (
        <div className="py-16 text-center text-[15px] text-spark-muted">{t('불러오는 중...')}</div>
      ) : (
        <>
          {/* 헤드라인 4지표 — 매트릭스를 읽는 데 필요한 값들(총량·증감, 가장 뜨거운 칸, 포트폴리오 접점) */}
          <div data-tour="inter-headline">
            <HeadlineStats headline={data.matrix.headline} />
          </div>

          {/* 주제×사건유형 매트릭스 + 인사이트 패널 2분할 */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-6">
            <SectorMatrix
              matrix={data.matrix}
              canScrap={canScrap}
              onSelect={topicKey => focusSector(`sec-${topicKey}`)}
            />
            <InsightPanel
              sectors={data.sectors}
              overview={data.overview}
              onSelect={focusSector}
            />
          </div>

          {/* AI 요약 — 위 매트릭스의 숫자를 그대로 되풀이하지 않고, 그래서 뭘 해야 하는지로 마무리 */}
          <ColoredSummaryCard summary={data.summary} overview={data.overview} />

          {/* 분야별 카드 — 급한 순(급증→기회→주요→조용)으로 위아래 배치.
              2열로 나눠봤더니 카드마다 탭·매치 목록이 들어가 좌우로 눈이 튀어 읽기 어려웠다(2026-08-06).
              기간·국가를 바꾸면 배지·건수가 다시 계산되므로 순서도 함께 바뀐다. */}
          <div data-tour="inter-sectors" className="mb-2 flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-wide text-spark-ink-soft">
            🗂 <span>{t('주제별 상세')}</span>
            <span className="ml-auto text-[11px] font-medium normal-case text-spark-muted">
              {t('급한 순서(급증 → 기회 → 주요 → 조용)로 정렬 · 기간을 바꾸면 순서도 바뀝니다')}
            </span>
          </div>
          <div className="flex flex-col gap-3">
            {sortByUrgency(data.sectors).map(s => (
              <SectorCard
                key={s.id}
                sector={s}
                canScrap={canScrap}
                briefingCtx={{
                  domainLabel: data.overview.domainLabel,
                  periodLabel: `${from} ~ ${to}`,
                  overview: {
                    total: data.overview.total,
                    deltaPct: data.overview.deltaPct,
                    sourceCount: data.overview.sourceCount,
                    matchCount: data.overview.matchCount,
                    matchedCompanyCount: data.overview.matchedCompanyCount,
                    topSectors: data.overview.topSectors.map(t => ({ name: t.name, count: t.count, deltaPct: t.deltaPct })),
                  },
                }}
                highlighted={highlighted === s.id}
                activeTab={activeSrcTab[s.id] ?? 'reason'}
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
  const t = useT();
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

function DeltaChip({ deltaPct, count }: { deltaPct: number | null; count?: number }) {
  const t = useT();
  if (count === 0) return <span className="text-[11px] text-spark-muted">—</span>;
  // 직전 동일 기간이 0건이면 증감률을 낼 수 없다 — 이 기간에 처음 잡힌 흐름.
  if (deltaPct === null) return <span className="text-[11px] font-bold text-emerald-600">{t('신규')}</span>;
  const up = deltaPct > 0;
  const flat = deltaPct === 0;
  return (
    <span className={`text-[11px] font-bold tabular-nums ${flat ? 'text-spark-muted' : up ? 'text-red-500' : 'text-blue-500'}`}>
      {flat ? '±0%' : `${up ? '▲' : '▼'}${Math.abs(deltaPct)}%`}
    </span>
  );
}

// 주제 카드 — Intra 탭 경쟁사 모니터링 카드와 같은 구조(항상 펼쳐진 카드 + 하위 탭).
// 예전엔 여닫는 아코디언을 위아래로 길게 늘어놓아서, 어느 주제가 급한지 보려면 전부 눌러봐야 했다.
function SectorCard({
  sector,
  canScrap,
  briefingCtx,
  highlighted,
  activeTab,
  onTabChange,
}: {
  sector: SectorBlock;
  canScrap: boolean;
  briefingCtx: BriefingCtx;
  highlighted: boolean;
  activeTab: CardTab;
  onTabChange: (t: CardTab) => void;
}) {
  const t = useT();
  const frame = highlighted
    ? 'border-emerald-500 ring-2 ring-emerald-500/30'
    : 'border-spark-border';

  return (
    <div id={sector.id} className={`rounded-xl border-[1.5px] bg-white p-4 scroll-mt-24 transition-colors ${frame}`}>
      {/* 헤더 — 왼쪽은 주제명, 오른쪽은 건수·증감률·배지 */}
      <div className="mb-2.5 flex items-start gap-2.5">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-spark-cream text-[16px]">{sector.icon}</div>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-bold text-spark-ink">{t(sector.name)}</div>
          <div className="truncate text-[12px] text-spark-muted" title={t(sector.sub)}>{t(sector.sub)}</div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <div className="flex items-center gap-1.5 whitespace-nowrap">
            <span className="text-[15px] font-bold tabular-nums text-spark-ink">
              {sector.metrics.count}<span className="text-[12px] font-normal text-spark-muted">{t('건')}</span>
            </span>
            <DeltaChip deltaPct={sector.metrics.deltaPct} count={sector.metrics.count} />
          </div>
          <span className={`rounded px-2 py-0.5 text-[11px] font-bold ${BADGE_CLS[sector.badge.kind]}`} title={sector.badge.why}>
            {t(sector.badge.label)}
          </span>
        </div>
      </div>

      {/* 하위 탭 — 판정 근거 / 기사 / 논문 / 오피니언 */}
      <div className="mb-3 flex border-b border-spark-border">
        <TabButton active={activeTab === 'reason'} onClick={() => onTabChange('reason')}>
          {t('{badge} 판정 근거', { badge: t(sector.badge.label) })}
          {sector.matches.length > 0 && <span className="ml-1 tabular-nums opacity-70">{sector.metrics.matchCount}</span>}
        </TabButton>
        {SOURCE_KINDS.map(k => (
          <TabButton key={k} active={activeTab === k} onClick={() => onTabChange(k)}>
            {t(SRC_LABEL[k])} <span className="tabular-nums opacity-70">{sector.items[k].length}</span>
          </TabButton>
        ))}
      </div>

      {activeTab === 'reason' ? (
        <ReasonTab sector={sector} canScrap={canScrap} briefingCtx={briefingCtx} />
      ) : (
        <SourceList items={sector.items[activeTab]} canScrap={canScrap} />
      )}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`-mb-px whitespace-nowrap border-b-2 px-2.5 py-1.5 text-[12px] font-semibold transition-colors ${
        active ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-spark-muted hover:text-spark-ink'
      }`}
    >
      {children}
    </button>
  );
}

// 첫 번째 탭 — 배지가 왜 이렇게 붙었는지(집계 근거) + 포트폴리오 매치 목록.
// 회사를 누르면 그 회사가 걸린 기사들이 펼쳐진다(어느 기사 때문에 걸렸는지 + 판정 과정).
function ReasonTab({ sector, canScrap, briefingCtx }: { sector: SectorBlock; canScrap: boolean; briefingCtx: BriefingCtx }) {
  const t = useT();
  const [openCo, setOpenCo] = useState<string | null>(null);
  // 브리핑 모달을 띄울 회사. 회사가 바뀌면 key로 새로 마운트돼 다시 생성된다.
  const [briefingCo, setBriefingCo] = useState<string | null>(null);

  const briefingFor = sector.matches.find(m => m.co === briefingCo);

  return (
    <div className="flex flex-col gap-2.5">
      <div className="rounded-lg bg-spark-subtle px-3 py-2.5 text-[13px] leading-relaxed text-spark-ink-soft">
        <b className="text-spark-ink">{t(sector.badge.label)}</b> · {sector.badge.why}
      </div>

      {sector.matches.length > 0 ? (
        <div>
          <div className="mb-1.5 flex flex-wrap items-baseline gap-x-1.5 text-[12px] text-spark-ink-soft">
            <b className="font-bold">📎 {t('포트폴리오 매칭 {n}건', { n: sector.metrics.matchCount })}</b>
            <span className="text-spark-muted">· {t('{n}개사', { n: sector.matches.length })} · {t('회사를 누르면 연결된 기사가 열립니다')}</span>
          </div>
          <div className="flex max-h-80 flex-col gap-1.5 overflow-y-auto scroll-slim pr-1">
            {sector.matches.map(m => {
              const open = openCo === m.co;
              return (
                <div key={m.co} className={`rounded-lg border ${open ? 'border-emerald-300 bg-emerald-50/40' : 'border-spark-cream'}`}>
                  {/* 회사 줄 — 펼치기 버튼과 '브리핑 생성'은 형제로 둔다(버튼 안에 버튼을 넣을 수 없다) */}
                  <div className="flex items-center gap-2 px-2.5 py-2">
                    <button
                      type="button"
                      onClick={() => setOpenCo(open ? null : m.co)}
                      aria-expanded={open}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      <span className="text-[13px] font-bold text-spark-ink">{t(m.co)}</span>
                      <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-emerald-700">
                        {t('기사')} {m.articles.length}
                      </span>
                    </button>
                    {/* 브리핑은 포폴사 대표에게 나갈 문서라 스크랩(별표)과 같은 권한으로 제한한다 */}
                    {canScrap && (
                      <button
                        type="button"
                        onClick={() => setBriefingCo(m.co)}
                        title={t('{co}에 보낼 브리핑을 만듭니다 — 매칭 이유 요약 + 업계 동향', { co: m.co })}
                        className="shrink-0 rounded-md border border-emerald-300 bg-white px-2 py-1 text-[11px] font-bold text-emerald-700 hover:bg-emerald-50"
                      >
                        ✉ {t('브리핑 생성')}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setOpenCo(open ? null : m.co)}
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
            })}
          </div>
        </div>
      ) : (
        <p className="text-[13px] text-spark-muted/80">{t('이 기간 이 주제와 연결된 포트폴리오사 매치가 없습니다.')}</p>
      )}

      {briefingFor && (
        <InterBriefingModal
          key={briefingFor.co}
          onClose={() => setBriefingCo(null)}
          payload={{
            company: briefingFor.co,
            domainLabel: briefingCtx.domainLabel,
            periodLabel: briefingCtx.periodLabel,
            sector: {
              name: sector.name,
              badgeLabel: sector.badge.label,
              badgeWhy: sector.badge.why,
              count: sector.metrics.count,
              deltaPct: sector.metrics.deltaPct,
              share: sector.metrics.share,
              sourceCount: sector.metrics.sourceCount,
              paperCount: sector.metrics.paperCount,
              matchCount: sector.metrics.matchCount,
            },
            overview: briefingCtx.overview,
            articles: briefingFor.articles.map(a => ({
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

// 기사·논문·오피니언 공통 목록. 같은 사건을 여러 매체가 각자 제목을 바꿔 보도한 경우
// (보도자료 픽업 등) 한 줄로 묶는다. Inter 기사엔 회사명(matchedKeyword)이 없어
// clusterArticles는 제목 유사도만으로 판단한다.
//
// ⚠ 일부 RSS 피드(예: BioCentury)는 개별 기사가 아니라 "Bio€quity Europe - BioCentury -
// biocentury.com" 같은 행사·카테고리 리스팅 페이지를 통째로 하나의 항목으로 내보낸다.
// 이런 제목은 "<제목> - <매체명> - <도메인>" 형태로 짧고 일반적이어서, 제목 유사도만
// 보는 clusterArticles가 전혀 다른 기사 여러 건과 잘못 묶어버렸다(2026-08-05 실사례).
// 그래서 이 패턴에 걸리는 항목은 클러스터링 후보에서 아예 빼고 항상 단독으로 둔다.
function SourceList({ items, canScrap }: { items: SectorBlock['items'][SourceKind]; canScrap: boolean }) {
  const t = useT();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpanded = (id: string) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const isFeedListingTitle = (title: string) => /\s-\s[a-z0-9][a-z0-9.-]*\.(com|org|net|io|co)\/?$/i.test(title.trim());
  const clusterablePool = items.filter(it => !isFeedListingTitle(it.titleOriginal));
  const singletonPool = items.filter(it => isFeedListingTitle(it.titleOriginal));
  const clusteredPart = clusterArticles(
    clusterablePool.map(it => ({ id: it.id, title: it.titleOriginal, pubDate: it.pubDate })),
    { maxDateDiffDays: 4 },
  ).map(({ rep, others }) => ({
    rep: clusterablePool.find(it => it.id === rep.id)!,
    others: others.map(o => clusterablePool.find(it => it.id === o.id)!),
  }));
  const singletonPart = singletonPool.map(it => ({ rep: it, others: [] as typeof items }));
  const clusters = [...clusteredPart, ...singletonPart].sort(
    (a, b) => items.findIndex(x => x.id === a.rep.id) - items.findIndex(x => x.id === b.rep.id),
  );

  if (items.length === 0) {
    return <p className="py-3 text-[13px] text-spark-muted/80">{t('해당 탭에 항목이 없습니다.')}</p>;
  }

  return (
    <div className="flex max-h-96 flex-col overflow-y-auto scroll-slim pr-1">
      {clusters.map(({ rep: it, others }) => {
        const isOpen = expanded.has(it.id);
        return (
          <div key={it.id} className="border-b border-spark-cream/60 py-2 last:border-0">
            <div className="flex items-start gap-2">
              <a href={it.url} target="_blank" rel="noopener noreferrer" className="group flex flex-1 items-start gap-2 min-w-0">
                <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[11px] font-bold ${SRC_BADGE_CLS[it.badge]}`}>{t(SRC_LABEL[it.badge])}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold leading-snug text-spark-ink group-hover:text-emerald-700">{it.title}</div>
                  {it.titleOriginal !== it.title && (
                    <div className="mt-0.5 text-[12px] leading-snug text-spark-muted line-clamp-2">{it.titleOriginal}</div>
                  )}
                  <div className="mt-0.5 text-[12px] text-spark-muted">
                    {t(it.media)} · {it.date}{others.length > 0 && ` ${t('외 {n}개 매체', { n: others.length })}`}
                  </div>
                </div>
              </a>
              {canScrap && <InterScrapStar id={it.id} initial={it.isScrapped} />}
            </div>
            {others.length > 0 && (
              <div className="mt-1 pl-[34px]">
                <button
                  type="button"
                  onClick={() => toggleExpanded(it.id)}
                  className="text-[11px] font-semibold text-emerald-700 hover:underline"
                >
                  {isOpen ? t('접기 ▲') : t('같은 소식을 다룬 다른 매체 +{n}건 보기 ▼', { n: others.length })}
                </button>
                {isOpen && (
                  <div className="mt-1 space-y-1 border-l-2 border-spark-border pl-2">
                    {others.map(o => (
                      <div key={o.id} className="flex items-center gap-2">
                        <a href={o.url} target="_blank" rel="noopener noreferrer" className="flex-1 min-w-0 truncate text-[12px] text-spark-ink-soft hover:text-emerald-700">
                          {o.title} <span className="text-spark-muted">— {t(o.media)} · {o.date}</span>
                        </a>
                        {canScrap && <InterScrapStar id={o.id} initial={o.isScrapped} />}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
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
function ColoredSummaryCard({ summary, overview }: { summary: DomainSummary; overview: InterOverview }) {
  const t = useT();
  const top = overview.topSectors[0];
  return (
    <div data-tour="inter-summary" className="bg-white border-[1.5px] border-spark-border rounded-2xl p-5 mb-6">
      <div className="flex flex-wrap items-center gap-1.5 text-[12px] font-bold uppercase tracking-wide text-emerald-600 mb-3">
        ✦ <span>{t('{label} 종합 요약', { label: t(summary.label) })}</span>
        <span className="ml-auto text-[11px] font-medium normal-case text-spark-muted">{t('집계값 + AI 한 줄 · {domain} 기준', { domain: t(overview.domainLabel) })}</span>
      </div>
      <ColoredSummaryItem
        n={1}
        k={t('트렌드 1줄 요약')}
        v={summary.trend}
        chips={[
          ...(top
            ? [{ label: `${t(top.name)} ${top.deltaPct === null ? t('신규') : `${top.deltaPct > 0 ? '▲' : '▼'}${Math.abs(top.deltaPct)}%`}`, cls: 'bg-red-50 text-red-600' }]
            : []),
          { label: t('기사 {n}건 · 매체 {m}곳', { n: overview.total, m: overview.sourceCount }), cls: 'bg-spark-subtle text-spark-ink-soft' },
        ]}
      />
      <ColoredSummaryItem
        n={2}
        k={t('스파크랩의 포지션')}
        v={summary.position}
        chips={overview.topCompanies.slice(0, 4).map(c => ({ label: `📎 ${c.name} ${c.count}`, cls: 'bg-emerald-50 text-emerald-700' }))}
      />
      <ColoredSummaryItem n={3} k={t('취해야 할 가장 중요한 액션')} v={summary.action} last />
      <div className="mt-2 text-[11px] text-gray-400">
        {summary.source === 'fallback'
          ? t('⚙️ 기본 요약 · AI 분석 대기 중(다음 수집 때 자동 갱신)')
          : t('🤖 AI 요약 · {time} 기준', { time: fmtKstTime(summary.computedAt!) })}
      </div>
    </div>
  );
}

// Intra 탭 KpiCard와 동일한 호버 툴팁 패턴 — 칸 이름 옆 🔍를 올리면 아래 설명이 뜬다.
function InfoTip({ text }: { text: string }) {
  return (
    <span className="text-[10px] cursor-help select-none opacity-50 group-hover:opacity-100 transition-opacity">
      🔍
      <span className="pointer-events-none absolute left-3 right-3 top-full z-20 mt-1 whitespace-pre-line rounded-lg bg-gray-900 px-3 py-2 text-xs font-normal leading-relaxed text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100">
        {text}
      </span>
    </span>
  );
}

// 헤드라인 4지표 — 매트릭스를 읽는 데 필요한 값만. 전부 실제 집계값.
// "주제 × 사건유형" 형태의 서버 조합 라벨 — 양쪽을 각각 번역해서 다시 붙인다.
function trCombo(t: ReturnType<typeof useT>, label: string) {
  return label.split(' × ').map((part) => t(part)).join(' × ');
}

function HeadlineStats({ headline: h }: { headline: InterMatrix['headline'] }) {
  const t = useT();
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 mb-6">
      <div className="relative group bg-white border border-spark-border rounded-xl px-4 py-3.5">
        <div className="flex items-center gap-1 text-[12px] text-spark-muted mb-1">
          {t('이 기간 트렌드 기사 수')}
          <InfoTip text={t('이 조회 기간에 수집·판정된 관련 기사 총량입니다.\n증감률은 바로 직전 같은 길이의 기간과 비교한 값이에요.')} />
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-2xl font-extrabold tabular-nums text-spark-ink">{h.total}</span>
          <DeltaChip deltaPct={h.deltaPct} count={h.total} />
        </div>
        <div className="text-[11px] text-spark-muted mt-0.5">{t('직전 동일 기간 {n}건', { n: h.prevTotal })}</div>
      </div>

      <div className="relative group bg-white border border-spark-border rounded-xl px-4 py-3.5">
        <div className="flex items-center gap-1 text-[12px] text-spark-muted mb-1">
          {t('가장 급증한 트렌드 조합')}
          <InfoTip text={t('아래 매트릭스는 "주제"(예: 항암)와 "사건 유형"(예: 투자·딜)을 교차해서 보여줍니다.\n이 칸들은 그중 직전 기간 대비 증가율이 가장 높은 상위 3개 조합이에요 — 최소 3건 이상 쌓인 칸 중에서만 고릅니다.')} />
        </div>
        {h.hottest.length === 0 ? (
          <div className="truncate text-[15px] font-extrabold text-spark-ink">{t('데이터 없음')}</div>
        ) : (
          <div className="flex flex-col gap-1">
            {h.hottest.map((hot, i) => (
              <div key={hot.label} className="flex items-baseline gap-1.5">
                <span className="shrink-0 text-[11px] font-bold text-spark-muted">{i + 1}.</span>
                <span className="truncate text-[13px] font-extrabold text-spark-ink" title={trCombo(t, hot.label)}>{trCombo(t, hot.label)}</span>
                <span className="ml-auto shrink-0 text-[11px] text-spark-muted">
                  {t('{n}건 · 직전 {p}건', { n: hot.count, p: hot.prevCount })}
                  {hot.deltaPct !== null ? (
                    hot.deltaPct > 0 ? (
                      <> <span className="font-bold text-red-500">▲{hot.deltaPct}%</span></>
                    ) : hot.deltaPct < 0 ? (
                      <> <span className="font-bold text-blue-500">▼{Math.abs(hot.deltaPct)}%</span></>
                    ) : (
                      <> <span className="font-bold text-spark-muted">±0%</span></>
                    )
                  ) : hot.prevCount === 0 ? (
                    <> <span className="font-bold text-emerald-600">{t('신규')}</span></>
                  ) : null}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="relative group bg-white border border-spark-border rounded-xl px-4 py-3.5">
        <div className="flex items-center gap-1 text-[12px] text-spark-muted mb-1">
          {t('연결된 포트폴리오사')}
          <InfoTip text={t('이 기간 해외 트렌드 기사 중, AI가 특정 스파크랩 포트폴리오사와 관련 있다고 판단한 기사가 몇 개 회사에 걸쳐 있는지입니다.\n"관련 기사 매치"는 회사 수가 아니라 그 판정이 내려진 기사·회사 쌍의 건수예요(한 기사가 여러 회사와 매치될 수 있음).')} />
        </div>
        <div className="flex items-baseline gap-0.5">
          <span className="text-2xl font-extrabold tabular-nums text-emerald-700">{h.matchedCompanyCount}</span>
          <span className="text-[13px] font-semibold text-emerald-700">{t('개사')}</span>
        </div>
        <div className="text-[11px] text-spark-muted mt-0.5">{t('관련 기사 매치 {n}건', { n: h.matchCount })}</div>
      </div>

      <div className="relative group bg-white border border-spark-border rounded-xl px-4 py-3.5">
        <div className="flex items-center gap-1 text-[12px] text-spark-muted mb-1">
          {t('우리 포트폴리오와 관련된 주제')}
          <InfoTip text={t('전체 트렌드 주제(예: 항암·신약발굴·의료기기 등, 총 {n}개) 중, 이 기간 포트폴리오사 매치가 하나라도 있었던 주제 수입니다.\n숫자가 낮으면 우리 포트폴리오가 다루지 않는 분야에서 트렌드가 몰리고 있다는 뜻이에요.', { n: h.totalTopicCount })} />
        </div>
        <div className="flex items-baseline">
          <span className="text-2xl font-extrabold tabular-nums text-spark-ink">{h.overlapTopicCount}</span>
          <span className="text-[15px] font-bold text-spark-muted">/{t('{n}개 주제', { n: h.totalTopicCount })}</span>
        </div>
        <div className="truncate text-[11px] text-spark-muted mt-0.5">
          {h.overlapTopics.length > 0 ? t('{list} 등', { list: h.overlapTopics.map((x) => t(x)).join('·') }) : t('관련 주제 없음')}
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
  const t = useT();
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
    <div data-tour="inter-matrix" className="bg-white border border-spark-border rounded-2xl p-5">
      <div className="flex flex-wrap items-center gap-1.5 text-[12px] font-bold uppercase tracking-wide text-spark-ink-soft mb-1">
        📊 <span>{t('주제 × 사건 유형')}</span>
        <span className="ml-auto flex items-center gap-2.5 text-[11px] font-medium normal-case text-spark-muted">
          <span className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-sm bg-emerald-50" />
            <span className="h-2.5 w-2.5 rounded-sm bg-emerald-200" />
            <span className="h-2.5 w-2.5 rounded-sm bg-emerald-600" />
            {t('기사 적음→많음')}
          </span>
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm ring-2 ring-red-500" />{t('급증 칸')}</span>
        </span>
      </div>
      <p className="mb-3 text-[12px] text-spark-muted">
        {t('행은 무엇에 관한 기사, 열은 무슨 일이 일어났는가입니다. 칸을 누르면 그 조합의 판정 근거와 대표 기사가 아래에서 열립니다.')}
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-[11px] text-spark-muted">
              <th className="text-left font-semibold pb-1.5 pr-2">{t('주제')}</th>
              {matrix.eventTypes.map(e => (
                <th key={e.key} className="font-semibold pb-1.5 px-1 text-center whitespace-nowrap" title={t(e.sub)}>{t(e.key)}</th>
              ))}
              <th className="text-right font-semibold pb-1.5 pl-2">{t('계')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.topicKey}>
                <td className="py-1 pr-2 whitespace-nowrap">
                  <button onClick={() => onSelect(row.topicKey)} className="text-left hover:underline">
                    <span className="mr-1">{row.icon}</span>
                    <span className="font-bold text-spark-ink">{t(row.topicKey)}</span>
                  </button>
                </td>
                {row.cells.map(cell => (
                  <td key={cell.id} className="px-1 py-1">
                    <button
                      onClick={() => setActiveId(prev => (prev === cell.id ? null : cell.id))}
                      disabled={cell.count === 0}
                      aria-pressed={activeId === cell.id}
                      title={cell.count === 0 ? t('해당 기사 없음') : `${t(cell.topicKey)} × ${t(cell.eventKey)} · ${cell.badge.why}`}
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
            <span className={`rounded px-2 py-0.5 text-[11px] font-bold ${BADGE_CLS[active.badge.kind]}`}>{t(active.badge.label)}</span>
            <span className="text-[13px] font-extrabold text-spark-ink">{t(active.topicKey)} × {t(active.eventKey)}</span>
            <button onClick={() => onSelect(active.topicKey)} className="ml-auto text-[12px] font-semibold text-emerald-700 hover:underline">
              {t('{topic} 전체 기사 →', { topic: t(active.topicKey) })}
            </button>
          </div>
          <p className="text-[12px] leading-snug text-spark-ink-soft">{active.badge.why}</p>

          {active.matchedCompanies.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {active.matchedCompanies.slice(0, 5).map(co => (
                <span key={co} className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">📎 {t(co)}</span>
              ))}
              {active.matchedCompanies.length > 5 && (
                <span className="text-[11px] text-spark-muted self-center">{t('외 {n}개사', { n: active.matchedCompanies.length - 5 })}</span>
              )}
            </div>
          )}

          {active.topItems.length > 0 && (
            <div className="mt-2.5 flex flex-col gap-1.5 border-t border-spark-border pt-2.5">
              {active.topItems.map(it => (
                <div key={it.id} className="flex items-start gap-2">
                  <a href={it.url} target="_blank" rel="noopener noreferrer" className="flex-1 min-w-0 group">
                    <div className="text-[12px] font-semibold leading-snug text-spark-ink group-hover:underline">{it.title}</div>
                    <div className="text-[11px] text-spark-muted">{t(it.media)} · {it.date}</div>
                  </a>
                  {canScrap && <InterScrapStar id={it.id} initial={it.isScrapped} />}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <p className="mt-3 text-[12px] text-spark-muted">
          {t('칸을 누르면 그 조합의 판정 근거·포트폴리오 매치·대표 기사가 여기에 열립니다.')}
        </p>
      )}

      {matrix.untagged > 0 && (
        <p className="mt-2.5 border-t border-spark-cream pt-2.5 text-[11px] text-spark-muted">
          {t('이 기간 기사 중 {n}건은 주제·사건유형이 아직 분류되지 않아 격자에 포함되지 않았습니다 (도메인 전반 기사이거나 백필 대상).', { n: matrix.untagged })}
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
  const t = useT();
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
    <div data-tour="inter-insight" className="bg-white border border-spark-border rounded-2xl p-5 flex flex-col gap-4">
      <div>
        <div className="flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-wide text-spark-ink-soft mb-3">
          ✦ <span>{t('이 화면이 말하는 것')}</span>
        </div>
        <div className="flex flex-col gap-3">
          <InsightRow k={t('한 줄')}>
            {top2.length > 0 ? (
              <>
                {t('자금과 뉴스가')} <b className="text-spark-ink">{top2.map(s => t(s.name)).join('·')}</b> {t('분야로 몰리고 있습니다.')}
                {top2Share > 0 && <> {t('(전체의 {pct}%)', { pct: top2Share })}</>}
              </>
            ) : (
              t('이 기간·조건에서 두드러진 분야가 없습니다.')
            )}
          </InsightRow>
          <InsightRow k={t('우리 위치')}>
            {topMatch && topMatch.metrics.matchCount > 0 ? (
              <>
                {t('가장 큰 매치는')} <b className="text-spark-ink">{t(topMatch.name)}</b> — {t('매치 {n}건, {c}개사가 걸려 있습니다.', { n: topMatch.metrics.matchCount, c: topMatch.metrics.matchedCompanies.length })}
              </>
            ) : (
              t('이 기간 포트폴리오와 직접 연결된 매치가 없습니다.')
            )}
          </InsightRow>
          <InsightRow k={t('놓치기 쉬운 곳')}>
            {sneaky ? (
              <>
                <b className="text-spark-ink">{t(sneaky.name)}</b>{t('은 기사량은 적지만({n}건) 증감률은 +{pct}%로 상위권입니다.', { n: sneaky.metrics.count, pct: sneaky.metrics.deltaPct ?? 0 })}
              </>
            ) : (
              t('눈에 띄게 예외적인 분야는 없습니다.')
            )}
          </InsightRow>
          <InsightRow k={t('액션')}>
            {topMatch && topMatch.metrics.matchCount > 0 ? (
              <>
                <b className="text-spark-ink">{t(topMatch.name)}</b> {t('매치 기업들의 최신 기사부터 확인하세요.')}{' '}
                <button onClick={() => onSelect(topMatch.id)} className="font-semibold text-emerald-700 hover:underline">
                  {t('바로 보기 →')}
                </button>
              </>
            ) : (
              t('아직 특정할 액션이 없습니다 — 데이터가 더 쌓이면 갱신됩니다.')
            )}
          </InsightRow>
        </div>
      </div>

      {overview.topCompanies.length > 0 && (
        <div className="border-t border-spark-cream pt-3.5">
          <div className="text-[12px] font-bold text-spark-ink-soft mb-2">📎 {t('가장 많이 걸린 포트폴리오사')}</div>
          <div className="flex flex-col gap-1.5">
            {overview.topCompanies.map(c => (
              <div key={c.name} className="grid grid-cols-[88px_1fr_28px] items-center gap-2 text-[13px]">
                <span className="truncate font-semibold text-spark-ink-soft" title={c.sectors.map(x => t(x)).join(', ')}>{t(c.name)}</span>
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
