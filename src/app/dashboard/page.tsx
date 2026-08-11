// 메인 대시보드 — 기간 선택(달력) 기반. KPI/차트/위기감지/급증/스크랩 지표.
import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { ArticleListView } from '@/components/ArticleListView';
import { PortfolioFilter } from '@/components/PortfolioFilter';
import { ToneBreakdown } from '@/components/ToneBreakdown';
import { CrisisPanel } from '@/components/CrisisPanel';
import { TrendChart } from '@/components/TrendChart';
import { MediaPanel } from '@/components/MediaPanel';
import { DateRangePicker } from '@/components/DateRangePicker';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { OPEN_ACCESS } from '@/lib/flags';
import { canScrap as canScrapEmail } from '@/lib/scrap';
import { normalizeSource } from '@/lib/sparkscope/media';
import { matchesAsToken, isBlockedNoise, normalizeTitleKey } from '@/lib/sparkscope/relevance';
import { clusterArticles } from '@/lib/sparkscope/cluster';
import { NEGATIVE_KEYWORDS, INDUSTRY_TREND_KEYWORDS, PINNED_COMPETITORS, detectCrises, crisisFallbackCause, detectSpikes, type ArticleLite, type SpikeCard } from '@/lib/sparkscope/insights';
import { hasNegativeKeyword, hasCrisisKeyword } from '@/lib/sparkscope/keywords-data';
import { getPrecomputedCrisisCauses, getPrecomputedCompetitorInsights, getPrecomputedCategoryPulses, wasInsightsBatchFreshToday, type InsightSource } from '@/lib/sparkscope/dashboard-insights';
import { summarizeCrisisCause, summarizeCrisisOverview } from '@/lib/sparkscope/analyzer';
import { summarizeCompetitorTrend, summarizeOverallTrend, summarizeCategoryPulse } from '@/lib/sparkscope/competitor-insights';
import { CompetitorPanel, type CompetitorStatView } from '@/components/CompetitorPanel';
import { getCompetitorFundSummaries, getSparkLabsFundSummary } from '@/lib/sparkscope/fund-db';
import { safeArticleHref } from '@/lib/sparkscope/article-link';
import type { SparkLabsFundSummary } from '@/lib/sparkscope/fund-db';
import { RISK_FLAGS } from '@/lib/sparkscope/risk-flags';
import { InterPanel } from '@/components/InterPanel';
import { CompanyNameWithPreview } from '@/components/CompanyNameWithPreview';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;
// DB(Supabase)가 서울(ap-northeast-2)에 있는데 이 함수가 기본 리전(iad1, 미국 동부)에서
// 실행되고 있어서 쿼리마다 태평양을 왕복하는 지연이 있었다(x-vercel-id: icn1::iad1::...로 확인).
// 함수 실행 리전을 서울(icn1)로 고정해 DB와 같은 리전에서 돌게 한다.
export const preferredRegion = 'icn1';

// 대시보드 섹션 탭 — 스크롤 대신 URL(?tab=)로 화면을 나눈다.
const TABS = [
  { id: 'sparklabs', label: '🏢 스파크랩' },
  { id: 'portfolio', label: '📊 포트폴리오사' },
  { id: 'competitor', label: '🏁 업계 모니터링' },
  { id: 'articles', label: '📋 최근 수집 기사' },
] as const;
export type TabId = (typeof TABS)[number]['id'];

function resolveTab(v?: string): TabId {
  return TABS.some(t => t.id === v) ? (v as TabId) : 'sparklabs';
}

// Intra(내부 생태계) / Inter(해외 트렌드) 스코프 전환 — URL(?scope=)로 화면을 나눈다.
const SCOPES = [
  { id: 'intra', label: '🏠 Intra', desc: '내부 생태계 — 스파크랩 · 포트폴리오사 · 경쟁사' },
  { id: 'inter', label: '🔭 Inter', desc: '외부 시장 — 글로벌 트렌드 · 국가별 현황 · 포지셔닝 분석' },
] as const;
type ScopeId = (typeof SCOPES)[number]['id'];
function resolveScope(v?: string): ScopeId {
  return SCOPES.some(s => s.id === v) ? (v as ScopeId) : 'intra';
}

const MIN_DATE = '2023-11-01';
// 추이 차트 상위 N개사 — 색상으로 구분 가능한 최대치(가독성) 기준 6개.
const TREND_TOP_N = 6;
// 실시간 위기 감지: "급증" 판단 시간 창(일). 수집 주기(월·수·금)를 고려한 최근 3일.
const CRISIS_WINDOW_DAYS = 3;
// 위기 카드가 이 개수를 넘으면 개별 카드 대신 AI 종합요약 + "더보기"로 접어서 공간을 아낀다.
const CRISIS_SUMMARY_THRESHOLD = 2;

// getKstNow()가 반환하는 Date는 UTC 필드에 KST 벽시계를 담고 있으므로(아래 설명 참고),
// fmt()는 항상 UTC getter로 읽는다 — 로컬 getter를 쓰면 실행 환경 시스템 시간대에 따라 결과가 달라진다.
function fmt(d: Date) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
function isValidYmd(s?: string): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
}
function clamp(s: string, lo: string, hi: string) {
  return s < lo ? lo : s > hi ? hi : s;
}
// KST(UTC+9, DST 없음) 계산 — 실행 환경의 시스템 시간대(TZ)와 무관하게 항상 같은 결과를 내야 한다.
// 기존엔 toLocaleString으로 KST 문자열을 만든 뒤 다시 Date로 파싱했는데, 이 재파싱이 시스템 TZ를
// 타서 로컬(KST로 설정된 PC)에서 서버(UTC)와 다른 값이 나왔다(2026-08-05, 로컬 대시보드 기사 수가
// 프로덕션과 안 맞던 원인). 실제 epoch에 9시간을 더한 뒤 UTC getter로만 읽는 방식으로 통일한다.
function getKstNow() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000);
}

function resolveRange(searchParams: { from?: string; to?: string }) {
  const todayStr = fmt(getKstNow());
  const def = getKstNow();
  def.setUTCMonth(def.getUTCMonth() - 3); // 기본 기간: 최근 3개월 (유의미한 흐름 파악)
  let from = isValidYmd(searchParams.from) ? clamp(searchParams.from, MIN_DATE, todayStr) : fmt(def);
  let to = isValidYmd(searchParams.to) ? clamp(searchParams.to, MIN_DATE, todayStr) : todayStr;
  if (from > to) [from, to] = [to, from];

  // 라벨: 기본(최근 3개월)이면 "최근 3개월", 아니면 "YYYY.M.D ~ YYYY.M.D"
  const isDefaultRange = to === todayStr && from === fmt(def);
  const pretty = (s: string) => { const [y, m, d] = s.split('-'); return `${y}.${Number(m)}.${Number(d)}`; };
  const label = isDefaultRange ? '최근 3개월' : `${pretty(from)} ~ ${pretty(to)}`;
  return { from, to, label, isDefaultRange };
}

// "최근 수집 기사" 탭용 카테고리별 조회 — priorityScore 상위 N건만 뽑으면, 물량 많고 점수
// 분포가 넓은 카테고리(포트폴리오사 등)는 몇 주 전 고득점 기사가 자리를 계속 차지해 정작
// "최근" 기사가 캡 밖으로 밀려나는 문제가 있었다(2026-08-10, 실사용 확인 — 포트폴리오사 상위
// 150건의 날짜가 7/28까지 걸쳐있고 최근 3일 이내는 7건뿐이었음). guaranteeRecentDays를 주면
// 그 기간 내 기사는 점수 무관하게 전부 먼저 포함하고, 남는 자리만 그 밖 기간에서 점수 높은
// 순으로 채운다 — "최근"이라는 탭 이름에 맞게 최신 기사를 우선 보장한다.
// recentCap: 보장 슬롯 자체의 상한(기본값 take = 무제한). 스타트업계처럼 하루 물량이
// 캡(take)을 훌쩍 넘는 카테고리에 guaranteeRecentDays를 그대로 적용하면 "최근" 슬롯만으로
// take가 꽉 차버려 정작 이 캡의 존재 이유였던 "중요도 높은 기사 위주 노출"이 무력화된다
// (2026-08-11 지적됨). recentCap으로 보장 슬롯을 작게 떼어주면, 최근 기사도 몇 건 보이면서
// 나머지는 여전히 점수 순으로 채워져 두 목적을 같이 만족한다.
async function fetchRecentTabArticles(
  where: Record<string, unknown>,
  category: string,
  take: number,
  now: Date,
  guaranteeRecentDays?: number,
  recentCap: number = take,
) {
  if (!guaranteeRecentDays) {
    return prisma.article.findMany({ where: { ...where, category }, orderBy: [{ priorityScore: 'desc' }, { pubDate: 'desc' }], take });
  }
  const recentSince = new Date(now.getTime() - guaranteeRecentDays * 24 * 60 * 60 * 1000);
  const recent = await prisma.article.findMany({
    where: { ...where, category, pubDate: { gte: recentSince } },
    orderBy: [{ pubDate: 'desc' }],
    take: Math.min(take, recentCap),
  });
  if (recent.length >= take) return recent;
  // recentCap이 take보다 작아 "최근" 창 안에 아직 못 뽑은 기사가 남아있을 수 있으므로,
  // 날짜가 아니라 id 제외로 나머지를 채운다 — 그래야 그 안의 고득점 기사도 여기서 잡힌다.
  const recentIds = recent.map(a => a.id);
  const older = await prisma.article.findMany({
    where: { ...where, category, id: { notIn: recentIds } },
    orderBy: [{ priorityScore: 'desc' }, { pubDate: 'desc' }],
    take: take - recent.length,
  });
  return [...recent, ...older];
}

async function loadDashboardData(from: string, to: string, company: string | undefined, isDefaultRange: boolean) {
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

  // "3년" 등 긴 기간을 고르면 직전 기간이 실제 데이터 시작일(2023.1.19) 이전까지 걸쳐서,
  // "직전 3년"이라고 표시해도 사실은 그중 데이터 있는 마지막 몇 개월만 비교하는 셈이라 오해하기
  // 쉬웠음(2026-08-06 확인). 직전 기간의 시작을 실제 데이터가 있는 시점으로 당겨서 라벨에 쓰고,
  // 그 결과 직전 기간이 원래 길이의 절반도 안 남으면 증감%는 아예 표시하지 않는다.
  const earliestPortfolio = await prisma.article.aggregate({
    where: { category: 'portfolio_company', isNoise: false },
    _min: { pubDate: true },
  });
  const earliestPortfolioDate = earliestPortfolio._min.pubDate;
  const effectivePrevSince = earliestPortfolioDate && earliestPortfolioDate > prevSince ? earliestPortfolioDate : prevSince;
  const prevSpanMs = prevUntil.getTime() - prevSince.getTime();
  const effectivePrevSpanMs = prevUntil.getTime() - effectivePrevSince.getTime();
  const portfolioTopHasEnoughPrevData = prevSpanMs <= 0 || effectivePrevSpanMs / prevSpanMs >= 0.5;

  // 급증 배너: 기간 선택과 무관하게 "최근 3일 vs 직전 60일(백필 포함)" — KST 기준
  const now = getKstNow();
  const rc = new Date(now); rc.setUTCDate(rc.getUTCDate() - 3); rc.setUTCHours(0, 0, 0, 0);
  const bl = new Date(now); bl.setUTCDate(bl.getUTCDate() - 63); bl.setUTCHours(0, 0, 0, 0);

  const [
    total, sparklabsCount, portfolioCount, pitchCount, mentionCount,
    prevPortfolioCount, prevMentionCount,
    articles, toneGroups, pitches, trendArticles,
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
    // "최근 수집 기사" 탭용 — 카테고리 통합 후 priorityScore로 자르면 sparklabs_self(100)·
    // portfolio_company(70)가 competitor(50)·industry_trend(40)를 밀어내 AC·VC/스타트업계
    // 필터를 눌러도 몇 건 안 보이는 문제가 있었음(industry_trend은 전체 기사의 대다수를 차지하는데도
    // 우선순위가 낮아 상위 400건 풀에서부터 밀려남). 카테고리별로 따로 뽑아 합쳐 각 필터가
    // 최소한의 건수를 보장받게 한다. AC·VC·스타트업계는 노이즈성 기사가 상대적으로 많아
    // priorityScore 상위 50건으로 더 좁게(=중요하다고 판단된 것만) 제한.
    // 4개 카테고리 모두 최근 3일은 점수 무관하게 보장(guaranteeRecentDays=3, 2026-08-11).
    // 단, 스타트업계·업계 모니터링은 하루 물량이 캡(50)을 훌쩍 넘어서(스타트업계 하루 40건+)
    // 보장을 무제한으로 주면 "최근 3일"만으로 캡이 꽉 차 애초에 이 캡을 둔 이유(중요도 높은
    // 기사 위주 노출)가 무력화된다. recentCap으로 보장 슬롯을 15건으로 제한해, 최근 기사도
    // 몇 건 보이면서 나머지 35건은 여전히 점수 순으로 채워지게 한다. 포트폴리오사·스파크랩은
    // 원래 하루 물량이 적어(3일치가 take를 넘지 않음) recentCap 제한이 없어도 문제되지 않는다.
    Promise.all(Object.entries({ sparklabs_self: 150, portfolio_company: 150, competitor: 50, industry_trend: 50 }).map(([category, take]) =>
      fetchRecentTabArticles(where, category, take, now, 3, category === 'competitor' || category === 'industry_trend' ? 15 : take),
    )).then(arr => arr.flat()),
    // 톤 분석 — 스파크랩 기준
    prisma.article.groupBy({ by: ['tone'], where: sparklabsWhere, _count: { _all: true } }),
    prisma.article.findMany({ where: { ...where, pitchScore: { gte: 60 } }, orderBy: { pitchScore: 'desc' }, take: 20 }),
    prisma.article.findMany({ where: portfolioWhere, select: { matchedKeyword: true, pubDate: true }, take: 20000 }),
    prisma.article.findMany({ where: { pubDate: { gte: rc, lte: now }, isNoise: false, category: 'portfolio_company' }, select: { id: true, title: true, link: true, source: true, pubDate: true, matchedKeyword: true, category: true, tone: true } }),
    prisma.article.findMany({ where: { pubDate: { gte: bl, lt: rc }, isNoise: false, category: 'portfolio_company' }, select: { matchedKeyword: true } }),
    // 실시간 위기 감지용: 기간 선택과 무관하게 "최근 3일" 포트폴리오 부정 기사
    prisma.article.findMany({ where: { pubDate: { gte: rc, lte: now }, isNoise: false, category: 'portfolio_company', OR: negOr }, select: { id: true, title: true, link: true, source: true, pubDate: true, matchedKeyword: true, category: true, tone: true }, take: 800 }),
    // 표시 단계 관련성 가드용: 포트폴리오 감시대상 키워드맵 (primaryKeyword → [이름·영문·보조])
    prisma.monitoringTarget.findMany({ where: { category: 'portfolio_company', status: 'ACTIVE' }, select: { primaryKeyword: true, name: true, englishName: true, helperKeywords: true, portfolioStatus: true } }),
    // 포트폴리오 vs 타 하우스 비교용: competitor(타 AC·VC 하우스) 노출 상위 3개 (실제 이름) — 업계 키워드 제외
    prisma.article.groupBy({ by: ['matchedKeyword'], where: { pubDate: { gte: since, lte: until }, isNoise: false, category: 'competitor', matchedKeyword: { notIn: INDUSTRY_TREND_KEYWORDS } }, _count: { _all: true }, orderBy: { _count: { matchedKeyword: 'desc' } }, take: 3 }),
    // 경쟁사 모니터링 섹션용: 기간 내 competitor 기사 전체(matchedKeyword=실제 경쟁사명별 집계)
    prisma.article.findMany({ where: { pubDate: { gte: since, lte: until }, isNoise: false, category: 'competitor' }, orderBy: { pubDate: 'desc' }, select: { id: true, title: true, source: true, pubDate: true, link: true, tone: true, matchedKeyword: true }, take: 3000 }),
    // 경쟁사 비교 기준선: 기간 내 '스파크랩' 언급 기사 수 (엔티티 자체 + 제목 언급)
    prisma.article.count({ where: { pubDate: { gte: since, lte: until }, isNoise: false, OR: [{ category: 'sparklabs_self' }, { title: { contains: '스파크랩' } }] } }),
    // 가장 많이 언급된 포트폴리오사 TOP 15 (기간 내 노출 건수) — 업계 키워드 제외
    prisma.article.groupBy({ by: ['matchedKeyword'], where: { ...portfolioWhere, matchedKeyword: { notIn: INDUSTRY_TREND_KEYWORDS } }, _count: { _all: true }, orderBy: { _count: { matchedKeyword: 'desc' } }, take: 15 }),
    // 포트폴리오 부정 기사 (기간 내 부정 논조 — 회사·제목 확인용)
    prisma.article.findMany({ where: { ...portfolioWhere, OR: negOr }, orderBy: { pubDate: 'desc' }, select: { id: true, title: true, link: true, source: true, pubDate: true, matchedKeyword: true, tone: true, riskFlag: true }, take: 80 }),
    // 스파크랩 자사 기사 (톤 분석 클릭 시 펼쳐볼 목록)
    prisma.article.findMany({ where: sparklabsWhere, orderBy: { pubDate: 'desc' }, select: { id: true, title: true, link: true, source: true, pubDate: true, tone: true, matchedKeyword: true, category: true, riskFlag: true }, take: 300 }),
    // 포트폴리오 긍정 하이라이트 (호재 기사)
    prisma.article.findMany({ where: { ...portfolioWhere, OR: posOr }, orderBy: [{ priorityScore: 'desc' }, { pubDate: 'desc' }], select: { id: true, title: true, link: true, source: true, pubDate: true, matchedKeyword: true, tone: true }, take: 120 }),
  ]);

  // TOP15 증감%(같은 길이 직전 기간 대비) — TOP15 회사로만 범위 좁혀 추가 조회
  const top15Keywords = portfolioTop15.map(g => g.matchedKeyword);
  const [prevTop15Counts, top15RecentByCompany] = top15Keywords.length > 0 ? await Promise.all([
    prisma.article.groupBy({ by: ['matchedKeyword'], where: { pubDate: { gte: prevSince, lte: prevUntil }, isNoise: false, category: 'portfolio_company', matchedKeyword: { in: top15Keywords } }, _count: { _all: true } }),
    // 회사 이름에 마우스를 올리면(모바일은 탭) 뜨는 미리보기용 — 회사별로 개별 조회해야
    // 언급량이 큰 회사가 "최근" 슬롯을 다 차지하는 걸 막고 회사마다 최근 기사를 보장받는다.
    // 같은 사건이 여러 매체에 다른 문구로 실려 3칸이 전부 같은 내용으로 채워지는 걸 막기 위해
    // 넉넉히(15건) 가져온 뒤 clusterArticles로 같은 사건을 묶어 대표 1건씩만 남긴다.
    Promise.all(top15Keywords.map(k =>
      prisma.article.findMany({ where: { ...portfolioWhere, matchedKeyword: k }, orderBy: { pubDate: 'desc' }, select: { id: true, title: true, link: true, source: true, pubDate: true }, take: 15 }),
    )),
  ]) : [[], []];
  const prevCountOf = new Map(prevTop15Counts.map(g => [g.matchedKeyword, g._count._all]));

  // 스포츠·게임·연예·광고 강제 제외 (제목·URL·매체) — 표시되는 모든 기사 리스트에 공통 적용
  const notNoise = (a: { title: string; link: string; source: string }) =>
    !isBlockedNoise({ title: a.title, link: a.link, source: a.source });

  const recentArticlesOf = new Map(top15Keywords.map((k, i) => {
    const filtered = top15RecentByCompany[i]!.filter(notNoise);
    // matchedKeyword를 안 넘겨서 회사명 일치가 아니라 순수 제목 유사도로만 묶는다 —
    // 이 회사의 다른 사건(예: 투자유치와 신제품출시)까지 하나로 뭉치면 안 되기 때문.
    const deduped = clusterArticles(filtered).map(c => c.rep);
    return [k, deduped.slice(0, 3)];
  }));

  // 경쟁사 모니터링 통계: DB에 실제 수집된 경쟁사(matchedKeyword)별 노출량·TOP3 기사·부정 기사.
  // (주가 기사 등 competitor 카테고리 노이즈는 지금은 그대로 — 추후 프롬프트 튜닝에서 정리)
  // 경쟁사 영문명 (카드 부제로 표시) — DB의 감시대상 정보에서 가져온다
  const competitorTargets = await prisma.monitoringTarget.findMany({
    where: { category: 'competitor' },
    select: { primaryKeyword: true, englishName: true },
  });
  const competitorEnglishOf = new Map(
    competitorTargets.filter(t => t.englishName).map(t => [t.primaryKeyword, t.englishName as string]),
  );

  type CompetitorAgg = Omit<CompetitorStatView, 'trend'> & { titles: string[] };
  const competitorStatMap = new Map<string, CompetitorAgg>();
  // 카드의 "기사" 탭에 보여줄 최대 개수 — 예전엔 3건 고정이었는데, 스크롤로 더 볼 수 있게 늘림.
  const ARTICLES_PER_CARD = 20;
  for (const a of competitorArticles) {
    if (!notNoise(a)) continue;
    const name = a.matchedKeyword;
    if (!name) continue;
    let s = competitorStatMap.get(name);
    if (!s) {
      s = { name, english: competitorEnglishOf.get(name) ?? '', count: 0, negCount: 0, articles: [], negatives: [], titles: [] };
      competitorStatMap.set(name, s);
    }
    s.count++;
    // 토큰 경계 매칭(hasNegativeKeyword/hasCrisisKeyword) — 부분일치(예: "우수사례"의 "수사")로
    // 인한 오탐을 피한다. 2026-08-05, tone 필드 오탐과 같은 원인으로 여기도 같이 발견·수정.
    const neg = a.tone === 'NEGATIVE' || hasNegativeKeyword(a.title) || !!hasCrisisKeyword(a.title);
    if (neg) s.negCount++;
    const art = { id: a.id, title: a.title, source: normalizeSource(a.source), pubDate: a.pubDate, link: a.link, neg }; // 입력이 최신순
    if (s.articles.length < ARTICLES_PER_CARD) s.articles.push(art);
    if (neg) s.negatives.push(art);
    if (s.titles.length < 40) s.titles.push(a.title); // AI 트렌드 요약 입력용(최신순)
  }
  // 바차트·AI 총평: 건수 내림차순 상위 10곳 (기존 동작 유지)
  const competitorAggs = Array.from(competitorStatMap.values()).sort((a, b) => b.count - a.count).slice(0, 10);

  // 카드: 고정 12개 (순서 고정, 기사 수와 무관) — 목록은 insights.ts에서 가져옴(사전계산과 공유)
  const pinnedAggs = PINNED_COMPETITORS.map(({ keyword, displayName }) => {
    const agg = competitorStatMap.get(keyword);
    const name = displayName ?? keyword;
    if (!agg) return { name, english: competitorEnglishOf.get(keyword) ?? '', count: 0, negCount: 0, articles: [], negatives: [], titles: [] };
    return { ...agg, name };
  });

  // 대시보드 AI 요약(위기 원인·경쟁사 트렌드) 사전계산 배치가 오늘(KST) 정상 실행됐는지 —
  // 이 값 하나로 두 섹션(경쟁사 트렌드/아래 위기 카드) 모두 "사전계산 신뢰 여부"를 판단한다.
  // 배치가 안 돌았으면(크론 실패) 예전처럼 그 자리에서 실시간 AI 호출로 자동 대체한다.
  const batchFresh = await wasInsightsBatchFreshToday();

  // AI 트렌드 요약(대시보드 상위 10곳 + 고정 12개 카드) — 기본 기간(최근 3개월)일 때만
  // 사전계산 결과를 쓴다. 사용자가 기간을 직접 고르면(비기본 범위) 그 조합은 크론이 미리
  // 계산해두지 않으므로 예전처럼 그 자리에서 계산한다.
  // (2026-07-31: 고정 12개 카드도 top10과 함께 사전계산 대상에 포함 — 예전엔 카드 12개가
  //  매 로드마다 실시간 LLM 호출이라 대시보드가 여전히 느렸다.)
  // 요약 실패는 화면을 막지 않는다(해당 블록만 빠짐).
  let overallTrend: string[] | null;
  let companyTrends: (string[] | null)[];
  let pinnedCompanyTrends: (string[] | null)[];
  // 하루 한 번만 재계산 — 오늘 날짜(KST)를 키에 포함해 같은 날엔 몇 번을 봐도 캐시 재사용
  const trendCacheKey = `${from}_${to}_${fmt(getKstNow())}`;
  // 프롬프트에 "이 기간" 대신 실제 기간을 쓰게 — 일수를 보기 좋은 단위로 변환 (예: 3개월간, 7일간)
  const periodDays = Math.max(1, Math.round((new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) / 86400000) + 1);
  const periodPhrase = periodDays >= 300 ? `${Math.round(periodDays / 365)}년간`
    : periodDays >= 25 ? `${Math.round(periodDays / 30)}개월간`
    : `${periodDays}일간`;
  if (isDefaultRange && batchFresh) {
    const pre = await getPrecomputedCompetitorInsights();
    overallTrend = pre.overall?.lines ?? null;
    companyTrends = competitorAggs.map(c => pre.byCompany.get(c.name)?.points ?? null);
    pinnedCompanyTrends = pinnedAggs.map(c => pre.byCompany.get(c.name)?.points ?? null);
  } else {
    [overallTrend, companyTrends, pinnedCompanyTrends] = await Promise.all([
      summarizeOverallTrend(
        competitorAggs.map(c => ({ name: c.name, count: c.count, negCount: c.negCount })),
        competitorAggs.flatMap(c => c.titles.slice(0, 6)),
        sparklabsMentions,
        trendCacheKey,
        periodPhrase,
      ),
      Promise.all(
        competitorAggs.map(c =>
          summarizeCompetitorTrend(c.name, c.titles, sparklabsMentions, c.count, trendCacheKey, periodPhrase),
        ),
      ),
      Promise.all(
        pinnedAggs.map(c =>
          summarizeCompetitorTrend(c.name, c.titles, sparklabsMentions, c.count, trendCacheKey, periodPhrase),
        ),
      ),
    ]);
  }
  // AC·VC(경쟁사)/스타트업계(업계동향) "지금 흐름" 한 줄 — 포트폴리오 급증 배너 옆에 나란히 표시.
  // 급증 배너와 같은 "최근 3일" 창(rc~now)을 그대로 써서 두 배너의 시점이 어긋나 보이지 않게 한다.
  let categoryPulses: Map<string, string>;
  if (batchFresh) {
    const pre = await getPrecomputedCategoryPulses();
    categoryPulses = new Map([...pre].map(([k, v]) => [k, v.line]));
  } else {
    const pulseCacheKey = `pulse_${fmt(getKstNow())}`;
    const [competitorRecent, industryRecent] = await Promise.all([
      prisma.article.findMany({ where: { pubDate: { gte: rc, lte: now }, isNoise: false, category: 'competitor' }, select: { title: true, link: true, source: true }, take: 300 }),
      prisma.article.findMany({ where: { pubDate: { gte: rc, lte: now }, isNoise: false, category: 'industry_trend' }, select: { title: true, link: true, source: true }, take: 300 }),
    ]);
    const [competitorPulse, industryPulse] = await Promise.all([
      summarizeCategoryPulse('AC·VC(경쟁사)', competitorRecent.filter(a => !isBlockedNoise(a)).map(a => a.title), pulseCacheKey, '최근 3일간'),
      summarizeCategoryPulse('스타트업계(업계동향)', industryRecent.filter(a => !isBlockedNoise(a)).map(a => a.title), pulseCacheKey, '최근 3일간'),
    ]);
    categoryPulses = new Map();
    if (competitorPulse) categoryPulses.set('competitor', competitorPulse);
    if (industryPulse) categoryPulses.set('industry_trend', industryPulse);
  }

  const [fundSummaries, sparkLabsFundSummary] = await Promise.all([
    getCompetitorFundSummaries(pinnedAggs.map(c => c.name)),
    getSparkLabsFundSummary(),
  ]);
  const competitors: CompetitorStatView[] = competitorAggs.map(({ titles, ...c }, i) => ({
    ...c,
    trend: companyTrends[i],
    fundSummary: fundSummaries.get(c.name) ?? null,
  }));
  const pinnedCompetitors: CompetitorStatView[] = pinnedAggs.map(({ titles, ...c }, i) => ({
    ...c,
    trend: pinnedCompanyTrends[i],
    fundSummary: fundSummaries.get(c.name) ?? null,
  }));

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
  // KPI 카드("기사 제목에 '스파크랩'이 언급된 건수")·매체별 노출 분포·톤 분석 세 곳이 항상 같은
  // 숫자를 보도록, sparklabsWhere로 가져온 sparklabsArticles를 그대로(추가 필터 없이) 공통 기준으로 사용.
  // (요청에 따라 passesName 제목-토큰 재검증을 뺀 상태 — 동명이인·부분일치 오탐이 섞일 수 있음을 감안한 결정)
  const sparklabsCountFiltered = sparklabsArticles.length;
  // 중복 기사 제거: 제목 정규화 키 또는 동일 URL 기준으로 대표 1건만 (articles는 우선순위 desc 정렬 → 대표=상위)
  const dedupeSeen = new Set<string>();
  const cleanedArticles = articles
    .filter(notNoise)
    .filter(passesName)
    .filter(a => {
      const tk = normalizeTitleKey(a.title);
      const lk = 'L:' + a.link;
      if ((tk && dedupeSeen.has(tk)) || dedupeSeen.has(lk)) return false;
      if (tk) dedupeSeen.add(tk);
      dedupeSeen.add(lk);
      return true;
    });

  const mentionRate = portfolioCount > 0 ? Math.round((mentionCount / portfolioCount) * 100) : 0;
  const prevMentionRate = prevPortfolioCount > 0 ? Math.round((prevMentionCount / prevPortfolioCount) * 100) : 0;

  // 위기 카드: 최근 3일 부정 기사로 감지(항상 실시간) 후, 회사별 AI 원인요약 문장만 주입.
  // 원인 문장은 사전계산(daily-collect 크론) 결과를 우선 쓰고, 아래 3가지 경우로 나뉜다.
  // - 오늘 배치가 정상 실행됐고 이 회사 결과가 있음 → 그대로 사용(source: ai)
  // - 오늘 배치는 정상 실행됐는데 이 회사만 없음(신규 위기·신규 회사) → 휴리스틱으로 대체,
  //   폴백임을 화면에 명시(source: fallback) — 두 경우를 구분해야 "AI가 실제로 분석한 원인"과
  //   "그냥 키워드 매칭 기본 문구"를 혼동하지 않는다.
  // - 오늘 배치 자체가 안 돎(크론 실패) → 예전처럼 그 자리에서 실시간 호출, 화면은 평소와 동일
  // (센터/기관 명칭 제외는 detectCrises() 내부(insights.ts)에서 처리 — page.tsx에서 중복 필터링하지 않음)
  const crisesRaw = detectCrises(crisisNeg.filter(notNoise).filter(passesName) as ArticleLite[]);
  const precomputedCauses = batchFresh
    ? await getPrecomputedCrisisCauses(crisesRaw.map(c => c.company))
    : new Map<string, { cause: string; computedAt: Date }>();
  const crises = await Promise.all(
    crisesRaw.map(async c => {
      const pre = precomputedCauses.get(c.company);
      if (pre) return { ...c, cause: pre.cause, causeSource: 'ai' as InsightSource, causeComputedAt: pre.computedAt as Date | null };
      if (batchFresh) return { ...c, cause: crisisFallbackCause(c.reasonKeywords), causeSource: 'fallback' as InsightSource, causeComputedAt: null };
      const realtime = await summarizeCrisisCause(c.company, c.titles);
      return realtime
        ? { ...c, cause: realtime, causeSource: 'ai' as InsightSource, causeComputedAt: null }
        : { ...c, cause: crisisFallbackCause(c.reasonKeywords), causeSource: 'fallback' as InsightSource, causeComputedAt: null };
    }),
  );
  // 위기 카드가 많을 때만 상단에 종합요약 — 1~2건이면 카드 자체가 이미 짧아 요약이 불필요.
  const crisisOverview = crises.length > CRISIS_SUMMARY_THRESHOLD
    ? await summarizeCrisisOverview(crises.map(c => ({ company: c.company, negCount: c.negCount, cause: c.cause })))
    : null;

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
  const portfolioStatusOf = new Map(portfolioTargets.map(t => [t.primaryKeyword, t.portfolioStatus]));
  const enrichedArticles = cleanedArticles.map(a => ({
    ...a,
    companyName: a.category === 'portfolio_company' ? (portfolioNameOf.get(a.matchedKeyword) ?? a.matchedKeyword) : undefined,
    portfolioStatus: a.category === 'portfolio_company' ? (portfolioStatusOf.get(a.matchedKeyword) ?? null) : null,
  }));
  const enrichedCompanyArticles = companyArticles.map(a => ({
    ...a,
    companyName: portfolioNameOf.get(a.matchedKeyword) ?? a.matchedKeyword,
    portfolioStatus: portfolioStatusOf.get(a.matchedKeyword) ?? null,
  }));
  const portfolioTop = portfolioTop15.map(g => {
    const count = g._count._all;
    const prevCount = prevCountOf.get(g.matchedKeyword) ?? 0;
    const changePct = prevCount > 0 ? Math.round(((count - prevCount) / prevCount) * 100) : (count > 0 ? null : 0);
    return {
      name: portfolioNameOf.get(g.matchedKeyword) ?? g.matchedKeyword,
      count,
      portfolioStatus: portfolioStatusOf.get(g.matchedKeyword) ?? null,
      changePct,
      recentArticles: recentArticlesOf.get(g.matchedKeyword) ?? [],
    };
  });
  // 증감% 비교 기준(직전 동일 기간) 안내용 — "2026.7.22 ~ 2026.7.28 대비" 형태로 표시
  const prettyUtc = (d: Date) => `${d.getUTCFullYear()}.${d.getUTCMonth() + 1}.${d.getUTCDate()}`;
  const portfolioTopPrevRangeLabel = `${prettyUtc(effectivePrevSince)} ~ ${prettyUtc(prevUntil)}`;
  // 긍정/부정 하이라이트: 회사(matchedKeyword)별로 묶어 "언급 매체 수" 많은 순 → 동률이면 최신순, TOP 3만.
  // (Article에 검색노출도 필드가 없어 매체 다양성을 대리 지표로 사용)
  const top3ByMedia = (rows: { matchedKeyword: string; title: string; source: string; pubDate: Date; link: string; riskFlag?: string | null }[]) => {
    const g = new Map<string, { company: string; sources: Set<string>; rep: (typeof rows)[number] }>();
    for (const a of rows) {
      if (!notNoise(a)) continue;
      const keys = portfolioKeyMap.get(a.matchedKeyword) ?? [a.matchedKeyword];
      if (!keys.some(k => matchesAsToken(a.title, k))) continue;
      let e = g.get(a.matchedKeyword);
      if (!e) { e = { company: portfolioNameOf.get(a.matchedKeyword) ?? a.matchedKeyword, sources: new Set(), rep: a }; g.set(a.matchedKeyword, e); }
      e.sources.add(normalizeSource(a.source));
      if (new Date(a.pubDate).getTime() > new Date(e.rep.pubDate).getTime()) e.rep = a;
    }
    return Array.from(g.values())
      .sort((x, y) => y.sources.size - x.sources.size || new Date(y.rep.pubDate).getTime() - new Date(x.rep.pubDate).getTime())
      .slice(0, 3)
      .map(e => ({ company: e.company, title: e.rep.title, source: normalizeSource(e.rep.source), pubDate: e.rep.pubDate, link: e.rep.link, mediaCount: e.sources.size, riskFlag: e.rep.riskFlag ?? null }));
  };
  const portfolioNegatives = top3ByMedia(portfolioNeg);
  const portfolioPositives = top3ByMedia(portfolioPos);

  // 기획 피칭 중복 제거: 다양성 우선(서로 다른 기업·다른 주제).
  // 같은 기업(matchedKeyword) 1건, 같은 주제(pitchTopic 정규화) 1건만 — 나머지 접기.
  // pitches는 pitchScore desc 정렬 → 먼저 등장한 대표(고득점)를 남김.
  const seenPitchCompany = new Set<string>();
  const seenPitchTopic = new Set<string>();
  const dedupedPitches = pitches.filter(p => {
    const c = (p.matchedKeyword ?? '').trim();
    const t = normalizeTitleKey(p.pitchTopic ?? '');
    if (c && seenPitchCompany.has(c)) return false;
    if (t && seenPitchTopic.has(t)) return false;
    if (c) seenPitchCompany.add(c);
    if (t) seenPitchTopic.add(t);
    return true;
  });

  return {
    range: { from, to },
    kpi: { total, sparklabsCount: sparklabsCountFiltered, portfolioCount, pitchCount, mentionRate, mentionDelta: mentionRate - prevMentionRate },
    articles: enrichedArticles,
    portfolioNames,
    selectedCompany: company,
    selectedCompanyName,
    companyArticles: enrichedCompanyArticles,
    // 매체별 노출 분포 — 아래 톤 분석(toneArticles)과 반드시 같은 범위로 집계해야
    // "매체별 합계"와 "톤 분석 총합"이 서로 어긋나지 않는다. (passesName 제목-토큰 재검증 없음)
    sources: sourcesFromArticles(sparklabsArticles),
    tones: toneGroups.map(t => ({ tone: t.tone ?? 'NEUTRAL', count: t._count._all })),
    pitches: dedupedPitches,
    crises,
    crisisOverview,
    spikes: detectSpikes(spikeRecent as ArticleLite[], spikeBaseline, 3, 60),
    categoryPulses,
    trendData: buildTrendData(trendArticles, since, until),
    compare: {
      sparkCount: portfolioCount,
      houses: competitorTop.map(g => ({ name: g.matchedKeyword, count: g._count._all })),
    },
    competitors,
    pinnedCompetitors,
    overallTrend,
    sparklabsMentions,
    sparkLabsFundSummary,
    portfolioTop,
    portfolioTopPrevRangeLabel,
    portfolioTopHasEnoughPrevData,
    portfolioNegatives,
    portfolioPositives,
    toneArticles: sparklabsArticles.map(a => ({
      id: a.id,
      title: a.title,
      link: a.link,
      source: normalizeSource(a.source),
      pubDate: a.pubDate,
      tone: (a.tone ?? 'NEUTRAL') as string,
      riskFlag: a.riskFlag as string | null,
    })),
  };
}

// 매체별 노출 건수 + 톤 성향(긍정/중립/부정) — 톤 분석(toneArticles)과 정확히 같은 기사 집합에서
// 뽑아야 "매체별 합계"와 "톤 분석 총합"이 서로 어긋나지 않는다.
// (이전엔 "확정 26개 매체"만 표시했으나, 그 목록에 없는 매체가 실제로 상당수 기사를
// 다뤄서 — 특히 긍정 톤 기사 다수가 화이트리스트 밖 매체였음 — 총합이 맞지 않아 보이는
// 혼란을 낳았다. 정규화 후 병합, 노출 많은 순 정렬만 하고 매체 자체는 제한하지 않는다.)
function sourcesFromArticles(articles: { source: string; tone: string | null }[]) {
  const merged = new Map<string, { count: number; tones: { POSITIVE: number; NEUTRAL: number; NEGATIVE: number } }>();
  for (const a of articles) {
    const name = normalizeSource(a.source);
    const tone = (a.tone ?? 'NEUTRAL') as 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE';
    let e = merged.get(name);
    if (!e) { e = { count: 0, tones: { POSITIVE: 0, NEUTRAL: 0, NEGATIVE: 0 } }; merged.set(name, e); }
    e.count += 1;
    e.tones[tone] = (e.tones[tone] ?? 0) + 1;
  }
  return Array.from(merged.entries())
    .map(([source, e]) => ({ source, count: e.count, tones: e.tones }))
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

export default async function DashboardPage({ searchParams }: { searchParams: { from?: string; to?: string; company?: string; tab?: string; scope?: string; domain?: string; country?: string } }) {
  const range = resolveRange(searchParams);
  const company = typeof searchParams.company === 'string' && searchParams.company ? searchParams.company : undefined;
  const tab = resolveTab(searchParams.tab);
  const scope = resolveScope(searchParams.scope);
  const data = await loadDashboardData(range.from, range.to, company, range.isDefaultRange);
  const session = await getServerSession(authOptions);
  const canScrap = canScrapEmail(session?.user?.email ?? null);
  const pendingSuggestionCount = canScrap ? await prisma.noiseSuggestion.count({ where: { status: 'PENDING' } }) : 0;
  // .catch(() => 0): NoiseReportRequest 테이블이 아직 DB에 반영 안 됐어도(prisma db push 전) 대시보드가
  // 죽지 않도록 방어 — 반영 전엔 그냥 0건으로 표시된다.
  const pendingReportCount = canScrap
    ? await prisma.noiseReportRequest.count({ where: { status: 'PENDING' } }).catch(() => 0)
    : 0;
  const userId = (session?.user as any)?.id as string | undefined;
  const canBookmark = !!userId;
  // 관리자는 즉시 처리(NoiseReportButton)가 있으니, 신고 "요청" 버튼은 로그인한 비관리자에게만.
  const canRequestReport = canBookmark && !canScrap;
  const bookmarkedIds = userId
    ? new Set((await prisma.bookmark.findMany({ where: { userId }, select: { articleId: true } })).map(b => b.articleId))
    : new Set<string>();
  const articlesWithBookmark = data.articles.map(a => ({ ...a, isBookmarked: bookmarkedIds.has(a.id) }));
  const companyArticlesWithBookmark = data.companyArticles.map(a => ({ ...a, isBookmarked: bookmarkedIds.has(a.id) }));
  // getKstNow()의 KST 값은 UTC 필드에 들어있으므로, toLocaleDateString도 timeZone: 'UTC'로
  // 읽어야 한다 — 안 그러면 실행 환경 시스템 시간대에 따라 다시 밀린다.
  const todayLabel = getKstNow().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long', timeZone: 'UTC' });

  // 탭 링크: 현재 기간·회사 필터를 유지한 채 tab만 바꾼다.
  const tabHref = (t: TabId) => {
    const params = new URLSearchParams({ from: range.from, to: range.to, tab: t, scope });
    if (data.selectedCompany) params.set('company', data.selectedCompany);
    return `/dashboard?${params.toString()}`;
  };
  // 스코프 링크: Intra ↔ Inter 전환, 기간·탭 필터는 유지.
  const scopeHref = (s: ScopeId) => {
    const params = new URLSearchParams({ from: range.from, to: range.to, tab, scope: s });
    if (data.selectedCompany) params.set('company', data.selectedCompany);
    return `/dashboard?${params.toString()}`;
  };
  const activeScope = SCOPES.find(s => s.id === scope)!;

  return (
    <>
      {/* 스코프 전환 — Intra(내부 생태계) / Inter(해외 트렌드) */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div data-tour="scope-switch" className="flex gap-0.5 rounded-lg bg-spark-cream p-0.5">
          {SCOPES.map(s => {
            const active = s.id === scope;
            const activeCls = s.id === 'inter' ? 'bg-emerald-600 text-white' : 'bg-spark-purple text-white';
            return (
              <Link
                key={s.id}
                href={scopeHref(s.id)}
                className={`rounded-md px-4 py-1.5 text-xs font-bold transition-colors whitespace-nowrap ${active ? activeCls : 'text-spark-muted hover:text-spark-ink-soft'}`}
              >
                {s.label}
              </Link>
            );
          })}
        </div>
        <span className="text-[11px] text-spark-muted">{activeScope.desc}</span>
      </div>

      {/* 헤더(오늘 날짜 · 제목 · 스크랩함) — Intra/Inter 두 스코프에서 동일하게 보인다.
          Inter에도 같은 헤더를 두어 "지금 며칠 기준 화면인지"가 항상 같은 자리에 있게 한다. */}
      <div className="flex flex-wrap justify-between items-end gap-4 mb-5">
        <div>
          <div className={`text-[11px] font-semibold uppercase tracking-[0.18em] mb-1.5 ${scope === 'inter' ? 'text-emerald-600' : 'text-spark-purple'}`}>
            {scope === 'inter' ? 'Global Trend Intelligence' : 'Daily Media Intelligence'}
          </div>
          <h1 className="text-2xl sm:text-[28px] font-extrabold tracking-tight text-spark-ink leading-none">{todayLabel}</h1>
          <p className="text-[13px] text-spark-muted mt-2">
            {scope === 'inter' ? `${range.label} 해외 매체·논문 데이터 기준` : `${range.label} 데이터 기준`}
          </p>
        </div>
        <div data-tour="header-actions" className="flex items-center gap-2">
          {canScrap && <Link href="/dashboard/scraps" className="rounded-lg border border-spark-border bg-white px-3 py-1.5 text-sm font-semibold text-spark-ink-soft hover:border-spark-purple/40 hover:text-spark-purple transition-colors whitespace-nowrap">⭐ 스크랩함</Link>}
          {canBookmark && <Link href="/dashboard/bookmarks" className="rounded-lg border border-spark-border bg-white px-3 py-1.5 text-sm font-semibold text-spark-ink-soft hover:border-spark-purple/40 hover:text-spark-purple transition-colors whitespace-nowrap">🔖 내 북마크</Link>}
          {canScrap && <Link href="/dashboard/keywords" className="rounded-lg border border-spark-border bg-white px-3 py-1.5 text-sm font-semibold text-spark-ink-soft hover:border-spark-purple/40 hover:text-spark-purple transition-colors whitespace-nowrap">⚙️ 키워드 관리</Link>}
          {canScrap && <Link href="/dashboard/noise-suggestions" className="rounded-lg border border-spark-border bg-white px-3 py-1.5 text-sm font-semibold text-spark-ink-soft hover:border-spark-purple/40 hover:text-spark-purple transition-colors whitespace-nowrap">🔍 노이즈 제안{(pendingSuggestionCount + pendingReportCount) > 0 ? ` (${pendingSuggestionCount + pendingReportCount})` : ''}</Link>}
        </div>
      </div>

      {scope === 'inter' ? (
        // 기간 선택은 InterPanel 안(국가 필터 바로 위)에서 렌더된다 — 기간·국가를 같이 고르고
        // '확인'을 눌러야 조회되는 흐름이라 두 컨트롤이 한 카드에 있어야 한다.
        <InterPanel from={range.from} to={range.to} min={MIN_DATE} max={fmt(getKstNow())} canScrap={canScrap} />
      ) : (
      <>
      {/* 섹션 탭 — 스크롤 대신 화면 전환. 선택된 탭만 보라색으로 강조. */}
      <nav data-tour="intra-tabs" className="flex flex-wrap gap-2 mb-3" aria-label="대시보드 섹션">
        {TABS.map(t => {
          const active = t.id === tab;
          return (
            <Link
              key={t.id}
              href={tabHref(t.id)}
              aria-current={active ? 'page' : undefined}
              className={`rounded-xl px-4 py-2 text-sm font-bold transition-colors whitespace-nowrap border ${
                active
                  ? 'bg-spark-purple border-spark-purple text-white shadow-sm'
                  : 'bg-white border-spark-border text-spark-ink-soft hover:border-spark-purple/40 hover:text-spark-purple'
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>

      {/* 기간 선택 — 탭 바로 아래에 두어 어느 탭에서도 같은 자리에서 기간을 바꿀 수 있게 한다. */}
      <div data-tour="date-range" className="mb-6">
        <DateRangePicker key={`${range.from}_${range.to}`} from={range.from} to={range.to} min={MIN_DATE} max={fmt(getKstNow())} company={data.selectedCompany} tab={tab} />
      </div>


      {/* 이슈 급증 배너 + KPI — 경쟁사 탭 제외 */}
      {tab !== 'competitor' && (
        <>
          {data.spikes.length > 0 && (
            <div data-tour="spike-banner" className="mb-6 space-y-2">
              {data.spikes.map(s => <SpikeBanner key={s.company} s={s} />)}
            </div>
          )}
          {tab === 'articles' && (data.categoryPulses.get('competitor') || data.categoryPulses.get('industry_trend')) && (
            <div className="mb-6 space-y-2">
              {data.categoryPulses.get('competitor') && (
                <CategoryPulseBanner label="AC·VC" line={data.categoryPulses.get('competitor')!} color="red" />
              )}
              {data.categoryPulses.get('industry_trend') && (
                <CategoryPulseBanner label="스타트업계" line={data.categoryPulses.get('industry_trend')!} color="amber" />
              )}
            </div>
          )}
          <div data-tour="kpi" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <KpiCard label="총 수집 기사" value={data.kpi.total} hint="선택한 기간 내 수집된 모든 기사 수 (노이즈 제외)" />
            <KpiCard label="스파크랩 직접 언급" value={data.kpi.sparklabsCount} hint="기사 제목에 '스파크랩'이 언급된 건수" />
            <KpiCard label="포트폴리오사 노출" value={data.kpi.portfolioCount} hint="스파크랩이 투자한 포트폴리오사가 언급된 기사 건수" />
            <KpiCard label="피칭 기회" value={data.kpi.pitchCount} hint="AI가 기획기사 피칭 가능성을 75점 이상으로 평가한 건수" highlight />
          </div>
        </>
      )}

      {/* ── 스파크랩 (가장 궁금한 정보) ── */}
      {tab === 'sparklabs' && <>
      <SectionTitle title="🏢 스파크랩" sub="우리 자사가 어디에, 어떤 논조로 보도되는가" />
      <div className="flex flex-col gap-4 mb-8">
        <div data-tour="media-panel" className="bg-white p-5 rounded-2xl border border-spark-border shadow-card">
          <div className="font-bold mb-4">📰 매체별 노출 분포 (스파크랩) <InfoTip text="선택 기간 동안 '스파크랩' 기사를 다룬 매체 분포입니다(주요 26개 매체 기준).\n어느 매체가 우리를 가장 많이 써주는지 보여줍니다." /></div>
          <MediaPanel data={data.sources} defaultCount={12} />
        </div>
        <div data-tour="tone-panel" className="bg-white p-5 rounded-2xl border border-spark-border shadow-card">
          <div className="font-bold mb-4">💬 톤 분석 (스파크랩) <InfoTip text="'스파크랩' 기사의 긍정·중립·부정 논조 비율입니다. 각 논조의 기사 목록이 바로 아래에 표시됩니다." /></div>
          <ToneBreakdown articles={data.toneArticles as any} />
        </div>

        {/* 스파크랩 펀드 현황 */}
        {data.sparkLabsFundSummary && (
          <div data-tour="fund-panel" className="bg-white p-5 rounded-2xl border border-spark-border shadow-card">
            <div className="font-bold mb-4">🏦 스파크랩 펀드 현황</div>
            <div className="flex flex-wrap gap-4 mb-4">
              <div className="flex flex-col items-center px-4 py-3 rounded-xl bg-spark-light-purple/40 min-w-[80px]">
                <span className="text-2xl font-extrabold text-spark-purple tabular-nums">{data.sparkLabsFundSummary.fundCount}</span>
                <span className="text-xs text-spark-muted mt-0.5">펀드 수</span>
              </div>
              {data.sparkLabsFundSummary.latestVintage && (
                <div className="flex flex-col items-center px-4 py-3 rounded-xl bg-spark-light-purple/40 min-w-[80px]">
                  <span className="text-2xl font-extrabold text-spark-purple tabular-nums">{data.sparkLabsFundSummary.latestVintage}</span>
                  <span className="text-xs text-spark-muted mt-0.5">최근 빈티지</span>
                </div>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-spark-border text-spark-muted text-left">
                    <th className="py-2 pr-4 font-semibold">펀드명</th>
                    <th className="py-2 pr-4 font-semibold text-right tabular-nums">빈티지</th>
                    <th className="py-2 pr-4 font-semibold">상태</th>
                    <th className="py-2 font-semibold text-right tabular-nums">만기 D-day</th>
                  </tr>
                </thead>
                <tbody>
                  {data.sparkLabsFundSummary.funds.map((f, i) => {
                    const dday = f.maturityDate ? computeDday(f.maturityDate) : null;
                    return (
                      <tr key={i} className="border-b border-spark-border/50 last:border-0 hover:bg-spark-subtle">
                        <td className="py-2 pr-4 text-spark-ink">{f.name}</td>
                        <td className="py-2 pr-4 text-right tabular-nums text-spark-muted">{f.vintage ?? '—'}</td>
                        <td className="py-2 pr-4">
                          {f.status && (
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${f.status === '운용 중' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                              {f.status}
                            </span>
                          )}
                        </td>
                        <td className="py-2 text-right tabular-nums">
                          {dday !== null ? (
                            <span className={`font-semibold ${dday <= 0 ? 'text-red-500' : dday <= 180 ? 'text-amber-500' : 'text-indigo-500'}`}>
                              {dday <= 0 ? `D+${Math.abs(dday)}` : `D-${dday}`}
                            </span>
                          ) : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
      </>}

      {/* ── 포트폴리오사 ── */}
      {tab === 'portfolio' && <>
      <SectionTitle title="📊 포트폴리오사" sub="어느 포트폴리오사가 활발히 노출되고, 부정 이슈는 없는가" />

      {/* 실시간 위기 감지 — 위기 없을 땐 '정상' 상태를 명시해 기능이 살아있음을 표시 */}
      <div data-tour="crisis-panel" className="mb-6">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-sm font-bold text-red-700">🚨 실시간 위기 감지</span>
          <InfoTip text={`최근 ${CRISIS_WINDOW_DAYS}일간 포트폴리오사별 부정 논조 기사(부정 키워드·부정 톤)를 모아, 2건 이상 급증한 회사를 감지합니다.\n원인은 AI가 실제 기사 제목에서 요약합니다.`} />
        </div>
        <CrisisPanel crises={data.crises} overview={data.crisisOverview} windowDays={CRISIS_WINDOW_DAYS} summaryThreshold={CRISIS_SUMMARY_THRESHOLD} />
      </div>

      {/* 긍정·부정 나란히 (대비가 한눈에) */}
      <div data-tour="pos-neg" className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <PortfolioPositives items={data.portfolioPositives} rangeLabel={range.label} />
        <PortfolioNegatives items={data.portfolioNegatives} rangeLabel={range.label} />
      </div>

      {/* 포트폴리오 TOP15 → 기획기사 피칭 (위아래 배치) */}
      <div className="grid grid-cols-1 gap-4 mb-8">
        <div data-tour="top15">
          <PortfolioTopList items={data.portfolioTop} rangeLabel={range.label} prevRangeLabel={data.portfolioTopPrevRangeLabel} showChange={data.portfolioTopHasEnoughPrevData} />
        </div>
        <div data-tour="pitch" className="bg-white p-5 rounded-2xl border border-spark-border shadow-card">
          <div className="font-bold mb-3">🎯 기획기사 피칭 <InfoTip text={`AI가 각 기사를 0~100점으로 평가한 '기획기사 피칭 점수'입니다.\n이 주제로 우리 포트폴리오사를 엮어 기획기사를 제안하면 성사 가능성이 높은 기사를 뜻합니다.\n· 60점 이상: 아래 목록에 표시\n· 75점 이상: 상단 '피칭 기회' 지표에 집계`} /></div>
          {data.pitches.length > 0 ? (
            <div className="space-y-3">
              {data.pitches.slice(0, 5).map(p => (
                <div key={p.id} className="p-3 bg-gradient-to-br from-amber-50 to-amber-100 border-l-4 border-amber-500 rounded-r-lg">
                  <div className="flex items-center gap-2 mb-1 min-w-0">
                    <div className="text-sm font-bold text-amber-900 flex-1 min-w-0 truncate">{p.pitchTopic ?? p.matchedKeyword}</div>
                    <div className="text-xs px-2 py-0.5 bg-amber-500 text-white rounded-full font-bold flex-shrink-0 whitespace-nowrap">{p.pitchScore}점</div>
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
      </>}

      {/* 경쟁사 모니터링 — Tier1 직접 경쟁 액셀러레이터 언급량·최근 이슈 */}
      {tab === 'competitor' && (
        <div data-tour="competitor-panel" className="mb-6">
          <CompetitorPanel
            competitors={data.competitors}
            cardCompetitors={data.pinnedCompetitors}
            sparklabsMentions={data.sparklabsMentions}
            rangeLabel={range.label}
            overallTrend={data.overallTrend}
          />
        </div>
      )}

      {/* 기사 테이블 — 기간/포트폴리오사 필터 + 정렬 + CSV */}
      {tab === 'articles' &&
      <div data-tour="article-table" className="bg-white p-5 rounded-2xl border border-spark-border shadow-card">
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
            <PortfolioFilter companies={data.portfolioNames} selected={data.selectedCompany} from={range.from} to={range.to} tab={tab} />
          </div>
          {/* 이 자리에서 바로 기간을 바꿀 수 있게 (맨 위로 안 올라가도 됨) */}
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-spark-border/60 pt-3">
            <span className="text-xs font-semibold text-gray-500 whitespace-nowrap">📅 기간</span>
            <DateRangePicker key={`${range.from}_${range.to}`} from={range.from} to={range.to} min={MIN_DATE} max={fmt(getKstNow())} company={data.selectedCompany} tab={tab} />
          </div>
        </div>
        {data.selectedCompany ? (
          <ArticleListView
            articles={companyArticlesWithBookmark as any}
            canScrap={canScrap}
            canBookmark={canBookmark}
            canReport={canScrap}
            canRequestReport={canRequestReport}
            showSearch={false}
            csvName={data.selectedCompanyName ?? '포트폴리오사'}
            emptyText={`${range.label} 내 ${data.selectedCompanyName} 기사가 없습니다.`}
          />
        ) : (
          <ArticleListView
            articles={articlesWithBookmark as any}
            canScrap={canScrap}
            canBookmark={canBookmark}
            canReport={canScrap}
            canRequestReport={canRequestReport}
            showSearch={true}
            showCategory={true}
            csvName="최근수집기사"
            emptyText={`${range.label} 내 기사가 없습니다.`}
          />
        )}
      </div>
      }
      </>
      )}
    </>
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

// AC·VC/스타트업계 "지금 흐름" 한 줄 — "최근 수집 기사" 탭의 카테고리 배지 색(AC·VC=red, 스타트업계=amber)과 통일.
function CategoryPulseBanner({ label, line, color }: { label: string; line: string; color: 'red' | 'amber' }) {
  const cls = color === 'red'
    ? 'border-red-500 bg-red-50 text-red-700'
    : 'border-amber-500 bg-amber-50 text-amber-700';
  return (
    <div className={`rounded-xl border-l-4 p-3 flex items-center gap-2 ${cls.split(' ').slice(0, 2).join(' ')}`}>
      <span className="text-lg">📊</span>
      <span className={`text-xs font-bold flex-shrink-0 ${cls.split(' ')[2]}`}>{label}</span>
      <span className="text-sm font-semibold text-gray-800">{line}</span>
    </div>
  );
}

function computeDday(maturityDateIso: string): number | null {
  if (maturityDateIso.startsWith('9999') || maturityDateIso.startsWith('2099')) return null; // 만기 미정 placeholder
  const mat = new Date(maturityDateIso);
  mat.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.ceil((mat.getTime() - today.getTime()) / 86400000);
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

// portfolioStatus(Live/Exit/Written-off) 라벨 — Live는 기본 상태라 배지 없이 생략, 그 외만 표시.
function PortfolioStatusBadge({ status }: { status: string | null }) {
  if (!status || status === 'Live') return null;
  const cls = status === 'Exit'
    ? 'bg-blue-50 text-blue-600 border-blue-200'
    : 'bg-gray-100 text-gray-500 border-gray-200';
  return <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold border ${cls}`}>{status}</span>;
}

function PortfolioTopList({ items, rangeLabel, prevRangeLabel, showChange }: { items: { name: string; count: number; portfolioStatus?: string | null; changePct: number | null; recentArticles: { title: string; link: string; source: string; pubDate: Date }[] }[]; rangeLabel: string; prevRangeLabel: string; showChange: boolean }) {
  const max = Math.max(...items.map(i => i.count), 1);
  return (
    <div className="bg-white p-5 rounded-2xl border border-spark-border shadow-card">
      <div className="font-bold mb-1">🔥 가장 많이 언급된 포트폴리오사 TOP 15 <InfoTip text={`${rangeLabel} 동안 언론 노출(기사 수)이 많은 포트폴리오사 순위입니다.\n최근 홍보 활동이 활발하거나 이슈가 되고 있는 회사를 보여줍니다.\n증감은 선택한 기간과 같은 길이의 직전 기간 대비입니다 (예: 최근 7일 선택 시 직전 7일과 비교).\n회사명에 마우스를 올리면(모바일은 탭) 최근 기사를 바로 볼 수 있습니다.`} /></div>
      <div className="text-xs text-gray-500 mb-4">
        {rangeLabel} · 언론 노출 건수 기준
        {showChange ? ` · 증감은 직전 기간(${prevRangeLabel}) 대비` : ' · 선택 기간이 길어 직전 기간 데이터가 부족해 증감은 표시하지 않음'}
      </div>
      {items.length > 0 ? (
        <div className="space-y-2">
          {items.map((it, i) => (
            <div key={it.name} className="flex items-center gap-2 text-sm">
              <span className="w-5 text-right text-xs font-bold text-gray-400 tabular-nums">{i + 1}</span>
              <CompanyNameWithPreview name={it.name} articles={it.recentArticles} />
              <PortfolioStatusBadge status={it.portfolioStatus ?? null} />
              <div className="flex-1 h-4 bg-gray-100 rounded overflow-hidden">
                <div className="h-full rounded bg-spark-purple/80" style={{ width: `${Math.round((it.count / max) * 100)}%` }} />
              </div>
              <span className="w-10 text-right font-bold tabular-nums">{it.count}</span>
              {showChange && (
                <span className={`w-14 text-right text-xs font-semibold tabular-nums whitespace-nowrap ${
                  it.changePct === null ? 'text-blue-500' : it.changePct > 0 ? 'text-emerald-600' : it.changePct < 0 ? 'text-red-500' : 'text-gray-400'
                }`}>
                  {it.changePct === null ? '신규' : it.changePct === 0 ? '0%' : `${it.changePct > 0 ? '+' : ''}${it.changePct}%`}
                </span>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-gray-400 py-8 text-center">{rangeLabel} 내 포트폴리오사 노출이 없습니다.</p>
      )}
    </div>
  );
}

function PortfolioPositives({ items, rangeLabel }: { items: { company: string; title: string; source: string; pubDate: Date; link: string; mediaCount?: number }[]; rangeLabel: string }) {
  return (
    <div className="bg-white p-5 rounded-2xl border border-spark-border shadow-card">
      <div className="font-bold mb-1">✨ 포트폴리오 긍정 하이라이트 <InfoTip text={`${rangeLabel} 동안 포트폴리오사의 긍정 논조(투자유치·상장·수상·파트너십 등) 기사 중, 여러 매체가 다룬 순으로 TOP 3.`} /></div>
      <div className="text-xs text-spark-muted mb-4">{rangeLabel} · 매체 노출 많은 순 TOP {items.length}</div>
      {items.length > 0 ? (
        <div className="space-y-2 max-h-80 overflow-y-auto scroll-slim pr-1">
          {items.map((a, i) => {
            const d = new Date(a.pubDate);
            return (
              <a key={i} href={safeArticleHref(a.link, a.title, a.source)} target="_blank" rel="noopener noreferrer" className="block rounded-lg border border-emerald-100 bg-emerald-50/50 p-2.5 hover:bg-emerald-50 transition-colors">
                <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-bold whitespace-nowrap">{a.company}</span>
                  {a.mediaCount && a.mediaCount > 1 ? <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-600/10 text-emerald-700 font-semibold whitespace-nowrap">{a.mediaCount}개 매체</span> : null}
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

function PortfolioNegatives({ items, rangeLabel }: { items: { company: string; title: string; source: string; pubDate: Date; link: string; mediaCount?: number; riskFlag?: string | null }[]; rangeLabel: string }) {
  return (
    <div className="bg-white p-5 rounded-2xl border border-spark-border shadow-card">
      <div className="font-bold mb-1">⚠️ 포트폴리오 부정 기사 <InfoTip text={`${rangeLabel} 동안 포트폴리오사 부정 논조 기사 중, 여러 매체가 다룬 순으로 TOP 3.`} /></div>
      <div className="text-xs text-gray-500 mb-4">{rangeLabel} · 매체 노출 많은 순 TOP {items.length}</div>
      {items.length > 0 ? (
        <div className="space-y-2 max-h-80 overflow-y-auto pr-1 scroll-slim">
          {items.map((a, i) => {
            const d = new Date(a.pubDate);
            return (
              <a key={i} href={safeArticleHref(a.link, a.title, a.source)} target="_blank" rel="noopener noreferrer" className="block rounded-lg border border-red-100 bg-red-50/50 p-2.5 hover:bg-red-50">
                <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 font-bold whitespace-nowrap">{a.company}</span>
                  {a.riskFlag && RISK_FLAGS[a.riskFlag] && (
                    <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold whitespace-nowrap ${RISK_FLAGS[a.riskFlag].cls}`}>
                      {RISK_FLAGS[a.riskFlag].label}
                    </span>
                  )}
                  {a.mediaCount && a.mediaCount > 1 ? <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-600/10 text-red-700 font-semibold whitespace-nowrap">{a.mediaCount}개 매체</span> : null}
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
