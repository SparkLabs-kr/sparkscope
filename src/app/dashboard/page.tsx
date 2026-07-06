// 메인 대시보드 — 기간 선택(달력) 기반. KPI/차트/위기감지/급증/스크랩 지표.
import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { ArticleListView } from '@/components/ArticleListView';
import { PortfolioFilter } from '@/components/PortfolioFilter';
import { ToneBreakdown } from '@/components/ToneBreakdown';
import { TrendChart } from '@/components/TrendChart';
import { MediaPanel } from '@/components/MediaPanel';
import { DateRangePicker } from '@/components/DateRangePicker';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { OPEN_ACCESS } from '@/lib/flags';
import { canScrap as canScrapEmail } from '@/lib/scrap';
import { normalizeSource, isKnownMedia } from '@/lib/sparkscope/media';
import { matchesAsToken, isBlockedNoise } from '@/lib/sparkscope/relevance';
import { NEGATIVE_KEYWORDS, detectCrises, crisisFallbackCause, detectSpikes, type ArticleLite, type CrisisCard, type SpikeCard } from '@/lib/sparkscope/insights';
import { summarizeCrisisCause } from '@/lib/sparkscope/analyzer';
import { TIER1_COMPETITORS, matchCompetitor, type CompetitorStat } from '@/lib/sparkscope/competitors';

export const dynamic = 'force-dynamic';

const MIN_DATE = '2023-11-01';
// 추이 차트 상위 N개사 — 색상으로 구분 가능한 최대치(가독성) 기준 6개.
const TREND_TOP_N = 6;
// 실시간 위기 감지: "급증" 판단 시간 창(일). 수집 주기(월·수·금)를 고려한 최근 3일.
const CRISIS_WINDOW_DAYS = 3;

function fmt(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function isValidYmd(s?: string): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
}
function clamp(s: string, lo: string, hi: string) {
  return s < lo ? lo : s > hi ? hi : s;
}

function resolveRange(searchParams: { from?: string; to?: string }) {
  const todayStr = fmt(new Date());
  const def = new Date();
  def.setMonth(def.getMonth() - 3); // 기본 기간: 최근 3개월 (유의미한 흐름 파악)
  let from = isValidYmd(searchParams.from) ? clamp(searchParams.from, MIN_DATE, todayStr) : fmt(def);
  let to = isValidYmd(searchParams.to) ? clamp(searchParams.to, MIN_DATE, todayStr) : todayStr;
  if (from > to) [from, to] = [to, from];

  // 라벨: 기본(최근 3개월)이면 "최근 3개월", 아니면 "YYYY.M.D ~ YYYY.M.D"
  const isDefaultRange = to === todayStr && from === fmt(def);
  const pretty = (s: string) => { const [y, m, d] = s.split('-'); return `${y}.${Number(m)}.${Number(d)}`; };
  const label = isDefaultRange ? '최근 3개월' : `${pretty(from)} ~ ${pretty(to)}`;
  return { from, to, label };
}

async function loadDashboardData(from: string, to: string, company?: string) {
  const since = new Date(`${from}T00:00:00`);
  const until = new Date(`${to}T23:59:59`);
  const where = { pubDate: { gte: since, lte: until }, isNoise: false };
  const portfolioWhere = { ...where, category: 'portfolio_company' };
  // 스파크랩 기사: 자체 카테고리 + 제목에 '스파크랩' 언급 (매체·톤 분석용)
  const sparklabsWhere = { ...where, OR: [{ category: 'sparklabs_self' as string }, { title: { contains: '스파크랩' } }] };
  const negOr = [{ tone: 'NEGATIVE' as string | null }, ...NEGATIVE_KEYWORDS.map(k => ({ title: { contains: k } }))];
  // 긍정 하이라이트용 — AI 긍정 톤 + 명확한 호재 키워드
  const POSITIVE_KEYWORDS = ['투자 유치', '시리즈', '상장', '수상', '선정', 'MOU', '파트너십', '업무협약', '출시', '런칭', '흑자', '수출', '돌파', '체결'];
  const posOr = [{ tone: 'POSITIVE' as string | null }, ...POSITIVE_KEYWORDS.map(k => ({ title: { contains: k } }))];

  // 언급률 비교용 직전 동일 기간
  const spanMs = until.getTime() - since.getTime();
  const prevUntil = new Date(since.getTime() - 1);
  const prevSince = new Date(prevUntil.getTime() - spanMs);
  const prevPortfolioWhere = { pubDate: { gte: prevSince, lte: prevUntil }, isNoise: false, category: 'portfolio_company' };

  // 급증 배너: 기간 선택과 무관하게 "최근 3일 vs 직전 60일(백필 포함)"
  const now = new Date();
  const rc = new Date(now); rc.setDate(rc.getDate() - 3); rc.setHours(0, 0, 0, 0);
  const bl = new Date(now); bl.setDate(bl.getDate() - 63); bl.setHours(0, 0, 0, 0);

  const [
    total, sparklabsCount, portfolioCount, pitchCount, mentionCount,
    prevPortfolioCount, prevMentionCount,
    articles, sourceGroups, toneGroups, pitches, trendArticles,
    spikeRecent, spikeBaseline, crisisNeg, portfolioTargets, competitorTop,
    competitorArticles, sparklabsMentions, portfolioTop15, portfolioNeg, sparklabsArticles, portfolioPos,
  ] = await Promise.all([
    prisma.article.count({ where }),
    prisma.article.count({ where: { ...where, category: 'sparklabs_self' } }),
    prisma.article.count({ where: portfolioWhere }),
    prisma.article.count({ where: { ...where, pitchScore: { gte: 75 } } }),
    prisma.article.count({ where: { ...portfolioWhere, title: { contains: '스파크랩' } } }),
    prisma.article.count({ where: prevPortfolioWhere }),
    prisma.article.count({ where: { ...prevPortfolioWhere, title: { contains: '스파크랩' } } }),
    prisma.article.findMany({ where, orderBy: [{ priorityScore: 'desc' }, { pubDate: 'desc' }], take: 400 }),
    // 매체별 노출 분포 — 스파크랩 기사 기준 (자사를 어느 매체가 많이 써주나)
    prisma.article.groupBy({ by: ['source'], where: sparklabsWhere, _count: { _all: true }, orderBy: { _count: { source: 'desc' } }, take: 120 }),
    // 톤 분석 — 스파크랩 기준
    prisma.article.groupBy({ by: ['tone'], where: sparklabsWhere, _count: { _all: true } }),
    prisma.article.findMany({ where: { ...where, pitchScore: { gte: 60 } }, orderBy: { pitchScore: 'desc' }, take: 20 }),
    prisma.article.findMany({ where: portfolioWhere, select: { matchedKeyword: true, pubDate: true }, take: 20000 }),
    prisma.article.findMany({ where: { pubDate: { gte: rc, lte: now }, isNoise: false, category: 'portfolio_company' }, select: { id: true, title: true, link: true, source: true, pubDate: true, matchedKeyword: true, category: true, tone: true } }),
    prisma.article.findMany({ where: { pubDate: { gte: bl, lt: rc }, isNoise: false, category: 'portfolio_company' }, select: { matchedKeyword: true } }),
    // 실시간 위기 감지용: 기간 선택과 무관하게 "최근 3일" 포트폴리오 부정 기사
    prisma.article.findMany({ where: { pubDate: { gte: rc, lte: now }, isNoise: false, category: 'portfolio_company', OR: negOr }, select: { id: true, title: true, link: true, source: true, pubDate: true, matchedKeyword: true, category: true, tone: true }, take: 800 }),
    // 표시 단계 관련성 가드용: 포트폴리오 감시대상 키워드맵 (primaryKeyword → [이름·영문·보조])
    prisma.monitoringTarget.findMany({ where: { category: 'portfolio_company', status: 'ACTIVE' }, select: { primaryKeyword: true, name: true, englishName: true, helperKeywords: true } }),
    // 포트폴리오 vs 타 하우스 비교용: competitor(타 AC·VC 하우스) 노출 상위 3개 (실제 이름)
    prisma.article.groupBy({ by: ['matchedKeyword'], where: { pubDate: { gte: since, lte: until }, isNoise: false, category: 'competitor' }, _count: { _all: true }, orderBy: { _count: { matchedKeyword: 'desc' } }, take: 3 }),
    // 경쟁사 모니터링 섹션용: 기간 내 competitor 기사 전체(제목에서 Tier1 경쟁사 식별)
    prisma.article.findMany({ where: { pubDate: { gte: since, lte: until }, isNoise: false, category: 'competitor' }, orderBy: { pubDate: 'desc' }, select: { title: true, source: true, pubDate: true, link: true, tone: true }, take: 1500 }),
    // 경쟁사 비교 기준선: 기간 내 '스파크랩' 언급 기사 수 (엔티티 자체 + 제목 언급)
    prisma.article.count({ where: { pubDate: { gte: since, lte: until }, isNoise: false, OR: [{ category: 'sparklabs_self' }, { title: { contains: '스파크랩' } }] } }),
    // 가장 많이 언급된 포트폴리오사 TOP 15 (기간 내 노출 건수)
    prisma.article.groupBy({ by: ['matchedKeyword'], where: portfolioWhere, _count: { _all: true }, orderBy: { _count: { matchedKeyword: 'desc' } }, take: 15 }),
    // 포트폴리오 부정 기사 (기간 내 부정 논조 — 회사·제목 확인용)
    prisma.article.findMany({ where: { ...portfolioWhere, OR: negOr }, orderBy: { pubDate: 'desc' }, select: { id: true, title: true, link: true, source: true, pubDate: true, matchedKeyword: true, tone: true }, take: 80 }),
    // 스파크랩 자사 기사 (톤 분석 클릭 시 펼쳐볼 목록)
    prisma.article.findMany({ where: sparklabsWhere, orderBy: { pubDate: 'desc' }, select: { id: true, title: true, link: true, source: true, pubDate: true, tone: true, matchedKeyword: true, category: true }, take: 300 }),
    // 포트폴리오 긍정 하이라이트 (호재 기사)
    prisma.article.findMany({ where: { ...portfolioWhere, OR: posOr }, orderBy: [{ priorityScore: 'desc' }, { pubDate: 'desc' }], select: { id: true, title: true, link: true, source: true, pubDate: true, matchedKeyword: true, tone: true }, take: 120 }),
  ]);

  // 스포츠·게임·연예·광고 강제 제외 (제목·URL·매체) — 표시되는 모든 기사 리스트에 공통 적용
  const notNoise = (a: { title: string; link: string; source: string }) =>
    !isBlockedNoise({ title: a.title, link: a.link, source: a.source });

  // 경쟁사 모니터링 통계: Tier1 경쟁사별 언급량·TOP3 기사·부정 기사 전체.
  const competitorStatMap = new Map<string, CompetitorStat>();
  for (const c of TIER1_COMPETITORS) competitorStatMap.set(c.name, { name: c.name, english: c.english, count: 0, negCount: 0, top3: [], negatives: [] });
  for (const a of competitorArticles) {
    if (!notNoise(a)) continue;
    const hit = matchCompetitor(a.title);
    if (!hit) continue;
    const s = competitorStatMap.get(hit.name)!;
    s.count++;
    const neg = a.tone === 'NEGATIVE' || NEGATIVE_KEYWORDS.some(k => a.title.includes(k));
    if (neg) s.negCount++;
    const art = { title: a.title, source: normalizeSource(a.source), pubDate: a.pubDate, link: a.link, neg }; // 입력이 최신순
    if (s.top3.length < 3) s.top3.push(art);
    if (neg) s.negatives.push(art);
  }
  const competitors = Array.from(competitorStatMap.values()).sort((a, b) => b.count - a.count);

  // 기존 DB에 쌓인 부분일치 노이즈(예: '노리'→'노리지만', '리코'→'인실리코')를
  // 표시 단계에서 토큰 매칭으로 제거. (DB는 수정하지 않음 — 아침 승인 후 cleanup 스크립트로 영구정리 예정)
  const portfolioKeyMap = new Map<string, string[]>();
  for (const t of portfolioTargets) {
    const keys = [t.primaryKeyword, t.name, t.englishName, ...(t.helperKeywords ?? '').split(',')]
      .map(k => (k ?? '').trim())
      .filter(k => k.length >= 2);
    portfolioKeyMap.set(t.primaryKeyword, Array.from(new Set(keys)));
  }
  // 스파크랩 자사 키워드맵 — sparklabs_self도 강한 식별자(토큰)로 오매칭(예: '스파크랩' 키워드에 걸린 야구 기사) 제거
  const sparklabsTargets = await prisma.monitoringTarget.findMany({
    where: { category: 'sparklabs_self', status: 'ACTIVE' },
    select: { primaryKeyword: true, name: true, englishName: true, helperKeywords: true },
  });
  const sparklabsKeyMap = new Map<string, string[]>();
  for (const t of sparklabsTargets) {
    const keys = [t.primaryKeyword, t.name, t.englishName, ...(t.helperKeywords ?? '').split(',')]
      .map(k => (k ?? '').trim())
      .filter(k => k.length >= 2);
    sparklabsKeyMap.set(t.primaryKeyword, Array.from(new Set(keys)));
  }
  // 회사/조직명이 제목에 토큰으로 등장해야 통과 (포트폴리오 + 스파크랩 자사). 그 외 카테고리는 통과.
  const passesName = (a: { category: string; matchedKeyword: string; title: string }) => {
    if (a.category !== 'portfolio_company' && a.category !== 'sparklabs_self') return true;
    const map = a.category === 'portfolio_company' ? portfolioKeyMap : sparklabsKeyMap;
    const keys = map.get(a.matchedKeyword) ?? [a.matchedKeyword];
    return keys.some(k => matchesAsToken(a.title, k));
  };
  const cleanedArticles = articles
    .filter(notNoise)
    .filter(passesName)
    .slice(0, 120);

  const mentionRate = portfolioCount > 0 ? Math.round((mentionCount / portfolioCount) * 100) : 0;
  const prevMentionRate = prevPortfolioCount > 0 ? Math.round((prevMentionCount / prevPortfolioCount) * 100) : 0;

  // 위기 카드: 최근 3일 부정 기사로 감지 후, 회사별 AI 원인요약 주입(실패 시 fallback).
  const crisesRaw = detectCrises(crisisNeg.filter(notNoise) as ArticleLite[]);
  const crises = await Promise.all(
    crisesRaw.map(async c => ({
      ...c,
      cause: (await summarizeCrisisCause(c.company, c.titles)) ?? crisisFallbackCause(c.reasonKeywords),
    })),
  );

  // 포트폴리오사 선택 필터: 드롭다운 목록 + (선택 시) 해당 회사의 기간 내 기사 전체.
  const portfolioNames = portfolioTargets
    .map(t => ({ value: t.primaryKeyword, label: t.name }))
    .sort((a, b) => a.label.localeCompare(b.label, 'ko'));
  const selectedCompanyName = company
    ? portfolioTargets.find(t => t.primaryKeyword === company)?.name ?? company
    : undefined;
  let companyArticles: typeof cleanedArticles = [];
  if (company) {
    const rows = await prisma.article.findMany({
      where: { pubDate: { gte: since, lte: until }, isNoise: false, category: 'portfolio_company', matchedKeyword: company },
      orderBy: [{ pubDate: 'desc' }],
      take: 300,
    });
    const keys = portfolioKeyMap.get(company) ?? [company];
    companyArticles = rows.filter(notNoise).filter(a => keys.some(k => matchesAsToken(a.title, k)));
  }

  // 포트폴리오 TOP 15 (표시명 매핑) + 부정 기사(관련성 가드 후 상위 15건)
  const portfolioNameOf = new Map(portfolioTargets.map(t => [t.primaryKeyword, t.name]));
  const portfolioTop = portfolioTop15.map(g => ({ name: portfolioNameOf.get(g.matchedKeyword) ?? g.matchedKeyword, count: g._count._all }));
  const portfolioNegatives = portfolioNeg
    .filter(notNoise)
    .filter(a => {
      const keys = portfolioKeyMap.get(a.matchedKeyword) ?? [a.matchedKeyword];
      return keys.some(k => matchesAsToken(a.title, k));
    })
    .slice(0, 15)
    .map(a => ({
      company: portfolioNameOf.get(a.matchedKeyword) ?? a.matchedKeyword,
      title: a.title,
      source: normalizeSource(a.source),
      pubDate: a.pubDate,
      link: a.link,
    }));
  const portfolioPositives = portfolioPos
    .filter(notNoise)
    .filter(a => {
      const keys = portfolioKeyMap.get(a.matchedKeyword) ?? [a.matchedKeyword];
      return keys.some(k => matchesAsToken(a.title, k));
    })
    .slice(0, 12)
    .map(a => ({
      company: portfolioNameOf.get(a.matchedKeyword) ?? a.matchedKeyword,
      title: a.title,
      source: normalizeSource(a.source),
      pubDate: a.pubDate,
      link: a.link,
    }));

  return {
    range: { from, to },
    kpi: { total, sparklabsCount, portfolioCount, pitchCount, mentionRate, mentionDelta: mentionRate - prevMentionRate },
    articles: cleanedArticles,
    portfolioNames,
    selectedCompany: company,
    selectedCompanyName,
    companyArticles,
    sources: normalizeSources(sourceGroups.map(s => ({ source: s.source, count: s._count._all }))),
    tones: toneGroups.map(t => ({ tone: t.tone ?? 'NEUTRAL', count: t._count._all })),
    pitches,
    crises,
    spikes: detectSpikes(spikeRecent as ArticleLite[], spikeBaseline, 3, 60),
    trendData: buildTrendData(trendArticles, since, until),
    compare: {
      sparkCount: portfolioCount,
      houses: competitorTop.map(g => ({ name: g.matchedKeyword, count: g._count._all })),
    },
    competitors,
    sparklabsMentions,
    portfolioTop,
    portfolioNegatives,
    portfolioPositives,
    toneArticles: sparklabsArticles.filter(notNoise).filter(passesName).map(a => ({
      id: a.id,
      title: a.title,
      link: a.link,
      source: normalizeSource(a.source),
      pubDate: a.pubDate,
      tone: (a.tone ?? 'NEUTRAL') as string,
    })),
  };
}

// 확정 26개 매체만 표시 — 정규화 후 병합, 노출 많은 순 정렬 (MediaPanel이 Top12/더보기 처리).
// 26개에 없는 매체(v.daum.net·유니콘팩토리 등)는 수집은 하되 이 차트에서는 제외.
function normalizeSources(rows: { source: string; count: number }[]) {
  const merged = new Map<string, number>();
  for (const r of rows) {
    if (!isKnownMedia(r.source)) continue;
    const name = normalizeSource(r.source);
    merged.set(name, (merged.get(name) ?? 0) + r.count);
  }
  return Array.from(merged.entries())
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count);
}

function buildTrendData(records: { matchedKeyword: string; pubDate: Date }[], since: Date, until: Date) {
  const counts = new Map<string, number>();
  records.forEach(r => counts.set(r.matchedKeyword, (counts.get(r.matchedKeyword) ?? 0) + 1));
  // 정렬 기준: 선택 기간 내 회사별 누적 기사(노출) 건수 내림차순 → 상위 TREND_TOP_N개사
  const topN = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, TREND_TOP_N).map(([k]) => k);

  const dayCount = Math.round((until.getTime() - since.getTime()) / 86400000);
  const byMonth = dayCount > 92; // 긴 기간은 월 단위 버킷

  const key = (d: Date) => byMonth ? `${d.getFullYear()}.${d.getMonth() + 1}` : `${d.getMonth() + 1}/${d.getDate()}`;

  const labels: string[] = [];
  const cur = new Date(since); cur.setHours(0, 0, 0, 0);
  const end = new Date(until); end.setHours(0, 0, 0, 0);
  let guard = 0;
  while (cur <= end && guard < 800) {
    const k = key(cur);
    if (labels[labels.length - 1] !== k) labels.push(k);
    cur.setDate(cur.getDate() + 1);
    guard++;
  }

  const datasets = topN.map(name => {
    const bucket = new Map<string, number>();
    records.filter(r => r.matchedKeyword === name).forEach(r => {
      const k = key(new Date(r.pubDate));
      bucket.set(k, (bucket.get(k) ?? 0) + 1);
    });
    return { label: name, data: labels.map(l => bucket.get(l) ?? 0) };
  });

  return { labels, datasets };
}

export default async function DashboardPage({ searchParams }: { searchParams: { from?: string; to?: string; company?: string } }) {
  const range = resolveRange(searchParams);
  const company = typeof searchParams.company === 'string' && searchParams.company ? searchParams.company : undefined;
  const data = await loadDashboardData(range.from, range.to, company);
  const session = await getServerSession(authOptions);
  const canScrap = canScrapEmail(session?.user?.email ?? null);
  const todayLabel = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });

  return (
    <>
      <div className="flex flex-wrap justify-between items-end gap-4 mb-7">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-spark-purple mb-1.5">Daily Media Intelligence</div>
          <h1 className="text-2xl sm:text-[28px] font-extrabold tracking-tight text-spark-ink leading-none">{todayLabel}</h1>
          <p className="text-[13px] text-spark-muted mt-2">{range.label} 데이터 기준</p>
        </div>
        <div className="flex items-center gap-2">
          <DateRangePicker key={`${range.from}_${range.to}`} from={range.from} to={range.to} min={MIN_DATE} max={fmt(new Date())} company={data.selectedCompany} />
          {canScrap && <Link href="/dashboard/scraps" className="rounded-lg border border-spark-border bg-white px-3 py-1.5 text-sm font-semibold text-spark-ink-soft hover:border-spark-purple/40 hover:text-spark-purple transition-colors whitespace-nowrap">⭐ 스크랩함</Link>}
          <Link href="/dashboard/keywords" className="rounded-lg border border-spark-border bg-white px-3 py-1.5 text-sm font-semibold text-spark-ink-soft hover:border-spark-purple/40 hover:text-spark-purple transition-colors whitespace-nowrap">⚙️ 키워드 관리</Link>
        </div>
      </div>

      {/* 실시간 위기 감지 — 위기 없을 땐 '정상' 상태를 명시해 기능이 살아있음을 표시 */}
      <div className="mb-6 space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-red-700">🚨 실시간 위기 감지</span>
          <InfoTip text={`최근 ${CRISIS_WINDOW_DAYS}일간 포트폴리오사별 부정 논조 기사(부정 키워드·부정 톤)를 모아, 2건 이상 급증한 회사를 감지합니다.\n원인은 AI가 실제 기사 제목에서 요약합니다.`} />
        </div>
        {data.crises.length > 0 ? (
          data.crises.map(c => <CrisisCardView key={c.company} c={c} />)
        ) : (
          <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
            🟢 최근 {CRISIS_WINDOW_DAYS}일 내 감지된 포트폴리오 위기가 없습니다.
            <span className="text-green-600"> 부정 기사가 급증하면 이 자리에 회사별 위기 카드가 자동으로 표시됩니다.</span>
          </div>
        )}
      </div>

      {/* 이슈 급증 배너 */}
      {data.spikes.length > 0 && (
        <div className="mb-6 space-y-2">
          {data.spikes.map(s => <SpikeBanner key={s.company} s={s} />)}
        </div>
      )}

      {/* KPI ROW */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard label="총 수집 기사" value={data.kpi.total} hint="선택한 기간 내 수집된 모든 기사 수 (노이즈 제외)" />
        <KpiCard label="스파크랩 직접 언급" value={data.kpi.sparklabsCount} hint="기사 제목에 '스파크랩'이 언급된 건수" />
        <KpiCard label="포트폴리오사 노출" value={data.kpi.portfolioCount} hint="스파크랩이 투자한 포트폴리오사가 언급된 기사 건수" />
        <KpiCard label="피칭 기회" value={data.kpi.pitchCount} hint="AI가 기획기사 피칭 가능성을 75점 이상으로 평가한 건수" highlight />
      </div>

      {/* ── 스파크랩 (가장 궁금한 정보) ── */}
      <SectionTitle title="🏢 스파크랩" sub="우리 자사가 어디에, 어떤 논조로 보도되는가" />
      <div className="grid lg:grid-cols-2 gap-4 mb-8">
        <div className="bg-white p-5 rounded-2xl border border-spark-border shadow-card">
          <div className="font-bold mb-4">📰 매체별 노출 분포 (스파크랩) <InfoTip text="선택 기간 동안 '스파크랩' 기사를 다룬 매체 분포입니다(주요 26개 매체 기준).\n어느 매체가 우리를 가장 많이 써주는지 보여줍니다." /></div>
          <MediaPanel data={data.sources} defaultCount={12} />
        </div>
        <div className="bg-white p-5 rounded-2xl border border-spark-border shadow-card">
          <div className="font-bold mb-4">💬 톤 분석 (스파크랩) <InfoTip text="'스파크랩' 기사의 긍정·중립·부정 논조 비율입니다. 막대를 클릭하면 해당 기사 목록이 열립니다." /></div>
          <ToneBreakdown articles={data.toneArticles as any} />
        </div>
      </div>

      {/* ── 포트폴리오사 ── */}
      <SectionTitle title="📊 포트폴리오사" sub="어느 포트폴리오사가 활발히 노출되고, 부정 이슈는 없는가" />
      <div className="grid lg:grid-cols-3 gap-4 mb-4">
        <PortfolioPositives items={data.portfolioPositives} rangeLabel={range.label} />

        <div className="bg-white p-5 rounded-2xl border border-spark-border shadow-card">
          <div className="font-bold mb-3">🎯 기획기사 피칭 <InfoTip text={`AI가 각 기사를 0~100점으로 평가한 '기획기사 피칭 점수'입니다.\n이 주제로 우리 포트폴리오사를 엮어 기획기사를 제안하면 성사 가능성이 높은 기사를 뜻합니다.\n· 60점 이상: 아래 목록에 표시\n· 75점 이상: 상단 '피칭 기회' 지표에 집계`} /></div>
          {data.pitches.length > 0 ? (
            <div className="space-y-3">
              {data.pitches.slice(0, 5).map(p => (
                <div key={p.id} className="p-3 bg-gradient-to-br from-amber-50 to-amber-100 border-l-4 border-amber-500 rounded-r-lg">
                  <div className="flex justify-between items-center mb-1">
                    <div className="text-sm font-bold text-amber-900">{p.pitchTopic ?? p.matchedKeyword}</div>
                    <div className="text-xs px-2 py-0.5 bg-amber-500 text-white rounded-full font-bold">{p.pitchScore}점</div>
                  </div>
                  <div className="text-xs text-amber-800 truncate">{p.title}</div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400">{range.label} 내 피칭 기회 (60점 이상) 없음</p>
          )}
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4 mb-8">
        <PortfolioTopList items={data.portfolioTop} rangeLabel={range.label} />
        <PortfolioNegatives items={data.portfolioNegatives} rangeLabel={range.label} />
      </div>

      {/* 경쟁사 모니터링 — Tier1 직접 경쟁 액셀러레이터 언급량·최근 이슈 */}
      <div className="mb-6">
        <CompetitorPanel competitors={data.competitors} sparklabsMentions={data.sparklabsMentions} rangeLabel={range.label} />
      </div>

      {/* 기사 테이블 — 기간/포트폴리오사 필터 + 정렬 + CSV */}
      <div className="bg-white p-5 rounded-2xl border border-spark-border shadow-card">
        <div className="mb-4">
          <div className="flex flex-wrap justify-between items-start gap-3">
            <div>
              <div className="font-bold">📋 {data.selectedCompanyName ? `${data.selectedCompanyName} 기사` : '최근 수집 기사'}</div>
              <div className="text-xs text-gray-500 mt-0.5">
                {data.selectedCompanyName
                  ? `${range.label} · 이 회사 기사 전체 ${data.companyArticles.length}건`
                  : `${range.label} · 최신 상위 ${data.articles.length}건 · 분류·검색·정렬로 탐색`}
              </div>
            </div>
            <PortfolioFilter companies={data.portfolioNames} selected={data.selectedCompany} from={range.from} to={range.to} />
          </div>
          {/* 이 자리에서 바로 기간을 바꿀 수 있게 (맨 위로 안 올라가도 됨) */}
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-spark-border/60 pt-3">
            <span className="text-xs font-semibold text-gray-500 whitespace-nowrap">📅 기간</span>
            <DateRangePicker key={`${range.from}_${range.to}`} from={range.from} to={range.to} min={MIN_DATE} max={fmt(new Date())} company={data.selectedCompany} />
          </div>
        </div>
        {data.selectedCompany ? (
          <ArticleListView
            articles={data.companyArticles as any}
            canScrap={canScrap}
            showSearch={false}
            csvName={data.selectedCompanyName ?? '포트폴리오사'}
            emptyText={`${range.label} 내 ${data.selectedCompanyName} 기사가 없습니다.`}
          />
        ) : (
          <ArticleListView
            articles={data.articles as any}
            canScrap={canScrap}
            showSearch={true}
            showCategory={true}
            csvName="최근수집기사"
            emptyText={`${range.label} 내 기사가 없습니다.`}
          />
        )}
      </div>

    </>
  );
}

function CrisisCardView({ c }: { c: CrisisCard & { cause: string } }) {
  const d = new Date(c.article.pubDate);
  return (
    <div className="rounded-xl border-l-4 border-red-500 bg-gradient-to-r from-red-50 to-white p-4">
      {/* 1줄: 급증 알림 (실제 회사명) */}
      <div className="text-sm font-bold text-red-900">
        {c.company} 관련 부정 기사가 최근 {CRISIS_WINDOW_DAYS}일 내 {c.negCount}건 급증했습니다.
      </div>
      {/* 2줄: AI 원인 요약 (두괄식) */}
      <div className="text-sm text-gray-700 mt-1.5 leading-relaxed">{c.cause}</div>
      {/* 대표 부정기사 1건 */}
      <div className="mt-3 rounded-lg bg-white/70 border border-red-100 p-2.5">
        <div className="text-[10px] font-semibold text-red-400 mb-1">대표 부정기사</div>
        <a href={c.article.link} target="_blank" rel="noopener noreferrer" className="block text-sm text-gray-800 hover:text-spark-purple font-medium">
          {c.article.title}
        </a>
        <div className="text-xs text-gray-500 mt-1">{c.article.source} · {d.getFullYear()}.{d.getMonth() + 1}.{d.getDate()}</div>
      </div>
    </div>
  );
}

function CompetitorPanel({ competitors, sparklabsMentions, rangeLabel }: { competitors: CompetitorStat[]; sparklabsMentions: number; rangeLabel: string }) {
  const max = Math.max(sparklabsMentions, ...competitors.map(c => c.count), 1);
  const totalComp = competitors.reduce((s, c) => s + c.count, 0);
  return (
    <div className="bg-white p-5 rounded-2xl border border-spark-border shadow-card">
      <div className="flex flex-wrap justify-between items-center gap-2 mb-1">
        <div className="font-bold">🏁 경쟁사 모니터링 — 직접 경쟁 액셀러레이터 <InfoTip text={`국내 직접 경쟁 액셀러레이터(Tier 1)의 ${rangeLabel} 언론 노출량과 최근 이슈를 스파크랩과 비교합니다.\n· 수치 = 언론 노출 기사 수\n· '프라이머'는 일반명사 오탐이 많아 투자·데모데이 등 활동 맥락일 때만 집계`} /></div>
        <span className="px-2 py-0.5 bg-spark-light-purple/50 text-spark-purple rounded-full text-[10px] font-semibold whitespace-nowrap">Tier 1 · {rangeLabel}</span>
      </div>
      <p className="text-xs text-gray-500 mb-4">스파크랩과 국내 직접 경쟁 AC의 언론 노출량·최근 이슈를 한눈에 비교합니다.</p>

      {/* 스파크랩 기준선 */}
      <div className="mb-4 pb-4 border-b border-spark-border/60">
        <CompareRow label="스파크랩 (기준)" count={sparklabsMentions} max={max} color="bg-spark-purple" strong />
      </div>

      {totalComp > 0 ? (
        <div className="grid md:grid-cols-2 gap-3 items-start">
          {competitors.map(c => <CompetitorRow key={c.name} c={c} max={max} />)}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-8 text-center text-sm text-gray-500">
          선택 기간에 집계된 경쟁사 기사가 아직 없습니다. 뉴스 수집이 진행되면 경쟁사별 언급량과 최근 이슈가 여기에 표시됩니다.
        </div>
      )}
    </div>
  );
}

function CompetitorRow({ c, max }: { c: CompetitorStat; max: number }) {
  const pct = Math.round((c.count / max) * 100);
  return (
    <div className="rounded-xl border border-spark-border p-3.5">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="text-sm font-bold text-spark-ink truncate">
          {c.name} <span className="text-xs font-normal text-spark-muted">{c.english}</span>
        </div>
        <div className="flex items-center gap-1.5 flex-none">
          {c.negCount > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-600 font-bold">부정 {c.negCount}</span>}
          <span className="text-sm font-bold text-spark-ink tabular-nums">{c.count}<span className="text-xs text-spark-muted font-normal">건</span></span>
        </div>
      </div>
      <div className="h-1.5 bg-spark-subtle rounded overflow-hidden mb-2.5">
        <div className="h-full bg-slate-400 rounded" style={{ width: `${pct}%` }} />
      </div>

      {c.top3.length > 0 ? (
        <>
          <div className="text-[10px] font-semibold text-spark-muted mb-1">최근 기사 TOP {c.top3.length}</div>
          <div className="space-y-1.5">
            {c.top3.map((a, i) => {
              const d = new Date(a.pubDate);
              return (
                <a key={i} href={a.link} target="_blank" rel="noopener noreferrer" className="block group">
                  <div className={`text-xs leading-snug line-clamp-2 group-hover:text-spark-purple ${a.neg ? 'text-red-700' : 'text-spark-ink-soft'}`}>
                    {a.neg && '⚠️ '}{a.title}
                  </div>
                  <div className="text-[10px] text-spark-muted mt-0.5">{a.source} · {d.getMonth() + 1}.{d.getDate()}</div>
                </a>
              );
            })}
          </div>

          {c.negatives.length > 0 && (
            <div className="mt-2.5 pt-2.5 border-t border-spark-border/60">
              <div className="text-[10px] font-semibold text-red-500 mb-1.5">⚠️ 부정 기사 전체 {c.negatives.length}건</div>
              <div className="space-y-1 max-h-44 overflow-y-auto scroll-slim pr-1">
                {c.negatives.map((a, i) => {
                  const d = new Date(a.pubDate);
                  return (
                    <a key={i} href={a.link} target="_blank" rel="noopener noreferrer" className="block rounded-lg border border-red-100 bg-red-50/50 p-1.5 hover:bg-red-50 transition-colors">
                      <div className="text-[11px] text-spark-ink leading-snug line-clamp-2">{a.title}</div>
                      <div className="text-[10px] text-spark-muted mt-0.5">{a.source} · {d.getMonth() + 1}.{d.getDate()}</div>
                    </a>
                  );
                })}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="text-[11px] text-spark-muted/70">최근 기사 없음</div>
      )}
    </div>
  );
}

function CompareRow({ label, count, max, color, strong }: { label: string; count: number; max: number; color: string; strong?: boolean }) {
  const pct = Math.round((count / max) * 100);
  return (
    <div className="flex items-center gap-3 text-sm">
      <div className={`w-40 truncate ${strong ? 'font-bold text-spark-purple' : 'text-gray-600'}`}>{label}</div>
      <div className="flex-1 h-5 bg-gray-100 rounded overflow-hidden">
        <div className={`h-full rounded ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="w-12 text-right font-semibold">{count}</div>
    </div>
  );
}

function SpikeBanner({ s }: { s: SpikeCard }) {
  return (
    <div className="rounded-xl border-l-4 border-spark-purple bg-spark-light-purple/40 p-3 flex items-center gap-2">
      <span className="text-lg">📈</span>
      <span className="text-sm font-semibold text-gray-800">{s.message}</span>
      <span className="text-xs text-gray-500">(최근 3일 {s.recentCount}건)</span>
    </div>
  );
}

function SectionTitle({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-4 mt-4">
      <div className="flex items-center gap-2.5">
        <span className="w-1 h-4 rounded-full bg-spark-purple" />
        <h2 className="text-[17px] font-extrabold tracking-tight text-spark-ink">{title}</h2>
      </div>
      {sub && <span className="text-xs text-spark-muted">{sub}</span>}
    </div>
  );
}

function PortfolioTopList({ items, rangeLabel }: { items: { name: string; count: number }[]; rangeLabel: string }) {
  const max = Math.max(...items.map(i => i.count), 1);
  return (
    <div className="bg-white p-5 rounded-2xl border border-spark-border shadow-card">
      <div className="font-bold mb-1">🔥 가장 많이 언급된 포트폴리오사 TOP 15 <InfoTip text={`${rangeLabel} 동안 언론 노출(기사 수)이 많은 포트폴리오사 순위입니다.\n최근 홍보 활동이 활발하거나 이슈가 되고 있는 회사를 보여줍니다.`} /></div>
      <div className="text-xs text-gray-500 mb-4">{rangeLabel} · 언론 노출 건수 기준</div>
      {items.length > 0 ? (
        <div className="space-y-2">
          {items.map((it, i) => (
            <div key={it.name} className="flex items-center gap-2 text-sm">
              <span className="w-5 text-right text-xs font-bold text-gray-400 tabular-nums">{i + 1}</span>
              <span className="w-28 truncate font-semibold text-gray-700" title={it.name}>{it.name}</span>
              <div className="flex-1 h-4 bg-gray-100 rounded overflow-hidden">
                <div className="h-full rounded bg-spark-purple/80" style={{ width: `${Math.round((it.count / max) * 100)}%` }} />
              </div>
              <span className="w-10 text-right font-bold tabular-nums">{it.count}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-gray-400 py-8 text-center">{rangeLabel} 내 포트폴리오사 노출이 없습니다.</p>
      )}
    </div>
  );
}

function PortfolioPositives({ items, rangeLabel }: { items: { company: string; title: string; source: string; pubDate: Date; link: string }[]; rangeLabel: string }) {
  return (
    <div className="lg:col-span-2 bg-white p-5 rounded-2xl border border-spark-border shadow-card">
      <div className="font-bold mb-1">✨ 포트폴리오 긍정 하이라이트 <InfoTip text={`${rangeLabel} 동안 포트폴리오사의 긍정 논조(투자유치·상장·수상·파트너십 등) 기사입니다.\n홍보·증폭할 좋은 소식을 한눈에 봅니다.`} /></div>
      <div className="text-xs text-spark-muted mb-4">{rangeLabel} · 좋은 소식 {items.length > 0 ? `${items.length}건` : ''}</div>
      {items.length > 0 ? (
        <div className="grid sm:grid-cols-2 gap-2 max-h-[22rem] overflow-y-auto scroll-slim pr-1">
          {items.map((a, i) => {
            const d = new Date(a.pubDate);
            return (
              <a key={i} href={a.link} target="_blank" rel="noopener noreferrer" className="block rounded-lg border border-emerald-100 bg-emerald-50/50 p-2.5 hover:bg-emerald-50 transition-colors">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-bold whitespace-nowrap">{a.company}</span>
                  <span className="text-[10px] text-spark-muted">{a.source} · {d.getMonth() + 1}.{d.getDate()}</span>
                </div>
                <div className="text-xs text-spark-ink leading-snug line-clamp-2">{a.title}</div>
              </a>
            );
          })}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-spark-border bg-spark-subtle px-4 py-12 text-center text-sm text-spark-muted">{rangeLabel} 내 포트폴리오 긍정 기사가 아직 없습니다.</div>
      )}
    </div>
  );
}

function PortfolioNegatives({ items, rangeLabel }: { items: { company: string; title: string; source: string; pubDate: Date; link: string }[]; rangeLabel: string }) {
  return (
    <div className="bg-white p-5 rounded-2xl border border-spark-border shadow-card">
      <div className="font-bold mb-1">⚠️ 포트폴리오 부정 기사 <InfoTip text={`${rangeLabel} 동안 포트폴리오사에 대한 부정 논조(부정 키워드·부정 톤) 기사입니다.\n어떤 회사가 어떤 이슈로 부정 보도됐는지 바로 확인하세요.`} /></div>
      <div className="text-xs text-gray-500 mb-4">{rangeLabel} · 부정 논조 기사 {items.length > 0 ? `${items.length}건` : ''}</div>
      {items.length > 0 ? (
        <div className="space-y-2 max-h-80 overflow-y-auto pr-1 scroll-slim">
          {items.map((a, i) => {
            const d = new Date(a.pubDate);
            return (
              <a key={i} href={a.link} target="_blank" rel="noopener noreferrer" className="block rounded-lg border border-red-100 bg-red-50/50 p-2.5 hover:bg-red-50">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 font-bold whitespace-nowrap">{a.company}</span>
                  <span className="text-[10px] text-gray-400">{a.source} · {d.getMonth() + 1}.{d.getDate()}</span>
                </div>
                <div className="text-xs text-gray-800 leading-snug line-clamp-2">{a.title}</div>
              </a>
            );
          })}
        </div>
      ) : (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-8 text-center text-sm text-green-800">🟢 {rangeLabel} 내 포트폴리오 부정 기사가 없습니다.</div>
      )}
    </div>
  );
}

function InfoTip({ text }: { text: string }) {
  return (
    <span className="relative inline-flex group align-middle" title={text}>
      <span className="text-[11px] cursor-help select-none">🔍</span>
      <span className="pointer-events-none absolute left-0 top-full z-30 mt-1 w-72 whitespace-pre-line rounded-lg bg-gray-900 px-3 py-2 text-xs font-normal leading-relaxed text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100">
        {text}
      </span>
    </span>
  );
}

function KpiCard({ label, value, hint, note, delta, highlight }: { label: string; value: number | string; hint?: string; note?: string; delta?: number; highlight?: boolean }) {
  return (
    <div className={`relative group bg-white p-5 rounded-2xl border shadow-card transition-colors ${highlight ? 'border-spark-purple/25' : 'border-spark-border'}`} title={hint}>
      {highlight && <span className="absolute left-0 top-5 bottom-5 w-[3px] rounded-full bg-spark-purple" />}
      <div className="flex items-center gap-1">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-spark-muted">{label}</div>
        {hint && <span className="text-[10px] cursor-help select-none opacity-50 group-hover:opacity-100 transition-opacity">🔍</span>}
      </div>
      <div className="mt-2.5 flex items-baseline gap-2">
        <div className={`text-[30px] leading-none font-extrabold tracking-tight tabular-nums ${highlight ? 'text-spark-purple' : 'text-spark-ink'}`}>{value}</div>
        {typeof delta === 'number' && delta !== 0 && (
          <span className={`text-xs font-semibold tabular-nums ${delta > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
            {delta > 0 ? '▲' : '▼'}{Math.abs(delta)}%p
          </span>
        )}
      </div>
      {note && <div className="mt-1.5 text-[10px] text-spark-muted">{note}</div>}
      {hint && (
        <div className="pointer-events-none absolute left-3 right-3 top-full z-20 mt-1 whitespace-pre-line rounded-lg bg-gray-900 px-3 py-2 text-xs leading-relaxed text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100">
          {hint}
        </div>
      )}
    </div>
  );
}

function ToneBars({ tones }: { tones: { tone: string; count: number }[] }) {
  const map = new Map(tones.map(t => [t.tone, t.count]));
  const positive = map.get('POSITIVE') ?? 0;
  const neutral = map.get('NEUTRAL') ?? 0;
  const negative = map.get('NEGATIVE') ?? 0;
  const total = positive + neutral + negative || 1;

  return (
    <div className="space-y-3 mt-4">
      <ToneRow label="긍정" count={positive} total={total} color="bg-green-600" />
      <ToneRow label="중립" count={neutral} total={total} color="bg-slate-400" />
      <ToneRow label="부정" count={negative} total={total} color="bg-red-600" />
    </div>
  );
}

function ToneRow({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const pct = (count / total) * 100;
  return (
    <div className="flex items-center gap-3 text-sm">
      <div className="w-12 text-gray-500">{label}</div>
      <div className="flex-1 h-5 bg-gray-100 rounded overflow-hidden">
        <div className={`h-full rounded ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="w-10 text-right font-semibold">{count}</div>
    </div>
  );
}
