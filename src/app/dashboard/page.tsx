// 메인 대시보드 — 기간 선택(달력) 기반. KPI/차트/위기감지/급증/스크랩 지표.
import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { DashboardSearchProvider, DashboardSearchBox, DashboardArticleList } from '@/components/DashboardSearch';
import { TrendChart } from '@/components/TrendChart';
import { MediaPanel } from '@/components/MediaPanel';
import { DateRangePicker } from '@/components/DateRangePicker';
import { RoadmapPreview } from '@/components/RoadmapPreview';
import { NightReviewNotes } from '@/components/NightReviewNotes';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { OPEN_ACCESS } from '@/lib/flags';
import { canScrap as canScrapEmail } from '@/lib/scrap';
import { normalizeSource, isKnownMedia } from '@/lib/sparkscope/media';
import { matchesAsToken, isBlockedNoise } from '@/lib/sparkscope/relevance';
import { NEGATIVE_KEYWORDS, detectCrises, crisisFallbackCause, detectSpikes, type ArticleLite, type CrisisCard, type SpikeCard } from '@/lib/sparkscope/insights';
import { summarizeCrisisCause } from '@/lib/sparkscope/analyzer';

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
  def.setDate(def.getDate() - 7);
  let from = isValidYmd(searchParams.from) ? clamp(searchParams.from, MIN_DATE, todayStr) : fmt(def);
  let to = isValidYmd(searchParams.to) ? clamp(searchParams.to, MIN_DATE, todayStr) : todayStr;
  if (from > to) [from, to] = [to, from];

  // 라벨: 기본(최근 7일)이면 "최근 7일", 아니면 "YYYY.M.D ~ YYYY.M.D"
  const isDefault7 = to === todayStr && from === fmt(def);
  const pretty = (s: string) => { const [y, m, d] = s.split('-'); return `${y}.${Number(m)}.${Number(d)}`; };
  const label = isDefault7 ? '최근 7일' : `${pretty(from)} ~ ${pretty(to)}`;
  return { from, to, label };
}

async function loadDashboardData(from: string, to: string) {
  const since = new Date(`${from}T00:00:00`);
  const until = new Date(`${to}T23:59:59`);
  const where = { pubDate: { gte: since, lte: until }, isNoise: false };
  const portfolioWhere = { ...where, category: 'portfolio_company' };
  const negOr = [{ tone: 'NEGATIVE' as string | null }, ...NEGATIVE_KEYWORDS.map(k => ({ title: { contains: k } }))];

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
  ] = await Promise.all([
    prisma.article.count({ where }),
    prisma.article.count({ where: { ...where, category: 'sparklabs_self' } }),
    prisma.article.count({ where: portfolioWhere }),
    prisma.article.count({ where: { ...where, pitchScore: { gte: 75 } } }),
    prisma.article.count({ where: { ...portfolioWhere, title: { contains: '스파크랩' } } }),
    prisma.article.count({ where: prevPortfolioWhere }),
    prisma.article.count({ where: { ...prevPortfolioWhere, title: { contains: '스파크랩' } } }),
    prisma.article.findMany({ where, orderBy: [{ priorityScore: 'desc' }, { pubDate: 'desc' }], take: 220 }),
    prisma.article.groupBy({ by: ['source'], where, _count: { _all: true }, orderBy: { _count: { source: 'desc' } }, take: 120 }),
    prisma.article.groupBy({ by: ['tone'], where: portfolioWhere, _count: { _all: true } }),
    prisma.article.findMany({ where: { ...where, pitchScore: { gte: 60 } }, orderBy: { pitchScore: 'desc' }, take: 20 }),
    prisma.article.findMany({ where: portfolioWhere, select: { matchedKeyword: true, pubDate: true }, take: 20000 }),
    prisma.article.findMany({ where: { pubDate: { gte: rc, lte: now }, isNoise: false, category: 'portfolio_company' }, select: { id: true, title: true, link: true, source: true, pubDate: true, matchedKeyword: true, category: true, tone: true } }),
    prisma.article.findMany({ where: { pubDate: { gte: bl, lt: rc }, isNoise: false, category: 'portfolio_company' }, select: { matchedKeyword: true } }),
    // 실시간 위기 감지용: 기간 선택과 무관하게 "최근 3일" 포트폴리오 부정 기사
    prisma.article.findMany({ where: { pubDate: { gte: rc, lte: now }, isNoise: false, category: 'portfolio_company', OR: negOr }, select: { id: true, title: true, link: true, source: true, pubDate: true, matchedKeyword: true, category: true, tone: true }, take: 800 }),
    // 표시 단계 관련성 가드용: 회사명 매칭 카테고리(포트폴리오+스파크랩) 강한 식별자 맵
    prisma.monitoringTarget.findMany({ where: { category: { in: ['portfolio_company', 'sparklabs_self'] }, status: 'ACTIVE' }, select: { primaryKeyword: true, name: true, englishName: true } }),
    // 포트폴리오 vs 타 하우스 비교용: competitor(타 AC·VC 하우스) 노출 상위 3개 (실제 이름)
    prisma.article.groupBy({ by: ['matchedKeyword'], where: { pubDate: { gte: since, lte: until }, isNoise: false, category: 'competitor' }, _count: { _all: true }, orderBy: { _count: { matchedKeyword: 'desc' } }, take: 3 }),
  ]);

  // 기존 DB에 쌓인 부분일치 노이즈(예: '노리'→'노리지만', '리코'→'인실리코')를
  // 표시 단계에서 토큰 매칭으로 제거. (DB는 수정하지 않음 — 아침 승인 후 cleanup 스크립트로 영구정리 예정)
  // 강한 식별자(회사명·영문명·주키워드)만 저장 — helperKeywords(대표자명 등)는 단독 통과 불가
  const portfolioKeyMap = new Map<string, string[]>();
  for (const t of portfolioTargets) {
    const keys = [t.primaryKeyword, t.name, t.englishName]
      .map(k => (k ?? '').trim())
      .filter(k => k.length >= 2);
    portfolioKeyMap.set(t.primaryKeyword, Array.from(new Set(keys)));
  }
  const NAME_MATCH_CATS = new Set(['portfolio_company', 'sparklabs_self']);
  const cleanedArticles = articles
    // 확정 매체 26개만 표시 (media.ts)
    .filter(a => isKnownMedia(a.source))
    // 스포츠·게임·연예·광고 강제 제외 (제목·URL·매체)
    .filter(a => !isBlockedNoise({ title: a.title, link: a.link, source: a.source }))
    // 회사/조직명(강한 식별자)이 제목에 토큰으로 등장해야 통과 (포트폴리오+스파크랩)
    .filter(a => {
      if (!NAME_MATCH_CATS.has(a.category)) return true;
      const keys = portfolioKeyMap.get(a.matchedKeyword) ?? [a.matchedKeyword];
      return keys.some(k => matchesAsToken(a.title, k));
    })
    .slice(0, 30);

  const mentionRate = portfolioCount > 0 ? Math.round((mentionCount / portfolioCount) * 100) : 0;
  const prevMentionRate = prevPortfolioCount > 0 ? Math.round((prevMentionCount / prevPortfolioCount) * 100) : 0;

  // 위기 카드: 최근 3일 부정 기사로 감지 후, 회사별 AI 원인요약 주입(실패 시 fallback).
  const crisesRaw = detectCrises(crisisNeg as ArticleLite[]);
  const crises = await Promise.all(
    crisesRaw.map(async c => ({
      ...c,
      cause: (await summarizeCrisisCause(c.company, c.titles)) ?? crisisFallbackCause(c.reasonKeywords),
    })),
  );

  return {
    range: { from, to },
    kpi: { total, sparklabsCount, portfolioCount, pitchCount, mentionRate, mentionDelta: mentionRate - prevMentionRate },
    articles: cleanedArticles,
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

export default async function DashboardPage({ searchParams }: { searchParams: { from?: string; to?: string } }) {
  const range = resolveRange(searchParams);
  const data = await loadDashboardData(range.from, range.to);
  const session = await getServerSession(authOptions);
  const canScrap = canScrapEmail(session?.user?.email ?? null);
  const todayLabel = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });

  return (
    <DashboardSearchProvider>
      <div className="flex flex-wrap justify-between items-end gap-4 mb-4">
        <div>
          <h1 className="text-3xl font-bold">{todayLabel}</h1>
          <p className="text-sm text-gray-500 mt-1">{range.label} 데이터 기준</p>
        </div>
        <div className="flex items-center gap-2">
          <DateRangePicker from={range.from} to={range.to} min={MIN_DATE} max={fmt(new Date())} />
          {canScrap && <Link href="/dashboard/scraps" className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-semibold text-gray-600 hover:bg-gray-50 whitespace-nowrap">⭐ 스크랩함</Link>}
          <Link href="/dashboard/keywords" className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-semibold text-gray-600 hover:bg-gray-50 whitespace-nowrap">⚙️ 키워드 관리</Link>
        </div>
      </div>

      {/* 검색창 — 달력 바로 아래. 하단 '최근 수집 기사' 목록을 실시간 필터 */}
      <div className="mb-6">
        <DashboardSearchBox />
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
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        <KpiCard label="총 수집 기사" value={data.kpi.total} hint="선택한 기간 내 수집된 모든 기사 수 (노이즈 제외)" />
        <KpiCard label="스파크랩 직접 언급" value={data.kpi.sparklabsCount} hint="기사 제목에 '스파크랩'이 언급된 건수" />
        <KpiCard label="포트폴리오사 노출" value={data.kpi.portfolioCount} hint="스파크랩이 투자한 포트폴리오사가 언급된 기사 건수" />
        <KpiCard label="피칭 기회" value={data.kpi.pitchCount} hint="AI가 기획기사 피칭 가능성을 75점 이상으로 평가한 건수" highlight />
        <KpiCard
          label="스파크랩 언급률"
          value={`${data.kpi.mentionRate}%`}
          hint="포트폴리오사 기사 중 '스파크랩'이 함께 언급된 비율"
          note="참고 지표 · 본문 미저장 기반"
          delta={data.kpi.mentionDelta}
        />
      </div>

      {/* 추이 차트 + 피칭 */}
      <div className="grid lg:grid-cols-3 gap-4 mb-6">
        <div className="lg:col-span-2 bg-white p-5 rounded-xl border border-gray-200">
          <div className="flex justify-between items-center mb-4">
            <div>
              <div className="font-bold">📈 포트폴리오사 노출 추이 ({range.label}) <InfoTip text="상위 6개 포트폴리오사의 일별 노출 추이" /></div>
              <div className="text-xs text-gray-500 mt-0.5">구글·네이버 뉴스 기준 · 선택 기간 누적 언론 노출 건수 상위 6개사</div>
            </div>
          </div>
          <TrendChart {...data.trendData} />
        </div>

        <div className="bg-white p-5 rounded-xl border border-gray-200">
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

      {/* 매체 + 톤 */}
      <div className="grid lg:grid-cols-2 gap-4 mb-6">
        <div className="bg-white p-5 rounded-xl border border-gray-200">
          <div className="font-bold mb-4">📰 매체별 노출 분포 <InfoTip text="선택 기간 동안 스타트업 주요 26개 핵심 매체별 집계" /></div>
          <MediaPanel data={data.sources} defaultCount={12} />
        </div>
        <div className="bg-white p-5 rounded-xl border border-gray-200">
          <div className="font-bold mb-4">💬 톤 분석 (포트폴리오) <InfoTip text="포트폴리오사 기사의 긍정·중립·부정 논조 비율" /></div>
          <ToneBars tones={data.tones} />
        </div>
      </div>

      {/* 포트폴리오 vs 타 하우스 노출 비교 (실데이터) */}
      <div className="mb-6">
        <CompareCard sparkCount={data.compare.sparkCount} houses={data.compare.houses} rangeLabel={range.label} />
      </div>

      {/* 기사 테이블 (실시간 검색 필터 포함) */}
      <div className="bg-white p-5 rounded-xl border border-gray-200">
        <div className="flex justify-between items-center mb-4">
          <div>
            <div className="font-bold">📋 최근 수집 기사</div>
            <div className="text-xs text-gray-500 mt-0.5">{range.label} · 상위 30건 · 확정 매체 26개 · 위 검색창으로 필터</div>
          </div>
        </div>
        <DashboardArticleList articles={data.articles as any} canScrap={canScrap} emptyText={`${range.label} 내 기사가 없습니다.`} />
      </div>

      {OPEN_ACCESS && <RoadmapPreview />}
      {OPEN_ACCESS && <NightReviewNotes />}
    </DashboardSearchProvider>
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

function CompareCard({ sparkCount, houses, rangeLabel }: { sparkCount: number; houses: { name: string; count: number }[]; rangeLabel: string }) {
  const hasData = houses.length > 0 && (sparkCount > 0 || houses.some(h => h.count > 0));
  const max = Math.max(sparkCount, ...houses.map(h => h.count), 1);
  return (
    <div className="bg-white p-5 rounded-xl border border-gray-200">
      <div className="flex flex-wrap justify-between items-center gap-2 mb-4">
        <div className="font-bold">⚔️ 포트폴리오 VS 타 하우스 AC·VC 포트폴리오 노출 비교 <InfoTip text={`${rangeLabel} 동안 스파크랩 포트폴리오사 노출 건수와, 타 AC·VC 하우스(감시대상 competitor) 노출 상위 3곳을 비교합니다.\n· 수치 = 언론 노출 기사 수 (확정 매체 26개 기준)`} /></div>
      </div>
      {hasData ? (
        <>
          <div className="space-y-3">
            <CompareRow label="스파크랩 포트폴리오" count={sparkCount} max={max} color="bg-spark-purple" strong />
            {houses.map((h, i) => (
              <CompareRow key={h.name} label={h.name} count={h.count} max={max} color={i === 0 ? 'bg-slate-500' : i === 1 ? 'bg-slate-400' : 'bg-slate-300'} />
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-4">{rangeLabel} 언론 노출 건수(기사 수) 기준 · 타 하우스는 노출 상위 3곳 실제 이름</p>
        </>
      ) : (
        <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-8 text-center text-sm text-gray-500">
          데이터 준비 중 — 선택 기간에 비교할 타 하우스(AC·VC) 노출 데이터가 아직 없습니다.
        </div>
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
    <div className="relative group bg-white p-5 rounded-xl border border-gray-200" title={hint}>
      <div className="flex items-center gap-1">
        <div className="text-xs font-semibold text-gray-500">{label}</div>
        {hint && <span className="text-[11px] cursor-help select-none">🔍</span>}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <div className={`text-3xl font-bold ${highlight ? 'text-spark-purple' : 'text-gray-900'}`}>{value}</div>
        {typeof delta === 'number' && delta !== 0 && (
          <span className={`text-xs font-semibold ${delta > 0 ? 'text-green-600' : 'text-red-600'}`}>
            {delta > 0 ? '▲' : '▼'}{Math.abs(delta)}%p
          </span>
        )}
      </div>
      {note && <div className="mt-1 text-[10px] text-gray-400">{note}</div>}
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
