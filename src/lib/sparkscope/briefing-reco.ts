/**
 * 데일리 브리핑 추천 헤드라인 5개 + 검수 화면의 교체 후보 목록.
 *
 * 추천은 아래 순서대로 위에서부터 채운다(2026-09-28 소윤 결정). 앞 단계가 5칸을 다 채우면
 * 뒤 단계는 들어가지 않는다 — 분야를 일부러 섞지 않는다.
 *
 *   1. 스파크랩 직접 언급 뉴스      (다이제스트 "스파크랩 직접 언급" 섹션)
 *   2. 포트폴리오사 뉴스             (다이제스트 "포트폴리오 하이라이트" 섹션, 중요도 순, 최소 2건 보장)
 *   3. 이번 주 AI 트렌드            (다이제스트 "AI 트렌드 TOP 5" 섹션)
 *   4. 해외 주요 트렌드 토픽         (다이제스트 "해외 트렌드" 섹션 중 AI)
 *
 * 재료는 다이제스트에 실린 기사뿐이고 기간도 다이제스트를 그대로 따른다 — 여기서 따로 창을 자르지 않는다.
 *
 * 바이오는 추천에도 교체 후보에도 넣지 않는다. AC·VC 업계 동향·스타트업계 뉴스는 추천 대상이
 * 아니지만, 편집자가 직접 고를 수 있게 교체 후보에는 남긴다.
 *
 * 규칙만으로 정하므로 같은 데이터면 늘 같은 답이 나온다. 그래도 수집 1회당 한 번 계산해
 * DashboardInsight(briefing_reco)에 저장한다 — AI 트렌드 목록은 2시간마다 새로 계산되므로,
 * 검수 화면을 본 뒤 발송 전에 목록이 바뀌면 "화면에선 A였는데 영상엔 B"가 될 수 있다.
 */
import { prisma } from '@/lib/prisma';
import { loadDigestCandidates, buildReviewDigest } from './review';
import { attachInterDigest } from './inter-digest';
import { attachAiSignals } from './signal-digest';
import type { AnalyzedArticle, DigestData } from './types';
import { buildSignalFeed } from './signal-feed';
import { BRIEFING_MAX, kstDateKey, type BriefingHeadline } from './briefing';

const KIND_RECO = 'briefing_reco';
/** 교체 후보 중 해외 기사 창 — 검수 화면 후보와 같은 7일 */
const PICKER_WINDOW_DAYS = 7;

const CATEGORY_LABEL: Record<string, string> = {
  sparklabs_self: '🏢 스파크랩 뉴스',
  portfolio_company: '💼 포트폴리오사',
  portfolio_company_tw: '💼 포트폴리오사 · 대만',
  portfolio_company_gv: '💼 포트폴리오사 · 글로벌',
  competitor: '🤝 AC·VC 업계 동향',
  industry_trend: '🌐 스타트업계 뉴스',
};
/** 브리핑에 포트폴리오 기사를 최소 몇 건 넣을지 */
const PORTFOLIO_MIN = 2;
const IMPORTANCE_RANK: Record<string, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
const TREND_LABEL = '📈 이번 주 AI 트렌드';
/**
 * 주가 시황 기사 — 추천에서만 뺀다(교체 후보에는 남긴다). 분석이 이런 기사에도 HIGH를 줘서,
 * 같은 사건 묶음의 대표로 "스카이랩스 주가 2.51% 하락"이 "타임 헬스테크 500 선정" 대신 뽑혔다
 * (2026-09-28). 묶기 전에 빼야 진짜 뉴스가 대표가 된다.
 */
const STOCK_TICKER = /주가|특징주|급등락|상한가|하한가|장중|시황|[‘'"]上[’'"]|[‘'"]下[’'"]/;
const INTER_LABEL = '🔭 해외 트렌드 · AI';

/** 교체 후보 한 줄 — 헤드라인 + 화면에 보여줄 보조 정보 */
export interface BriefingCandidate extends BriefingHeadline {
  pubDate: string;
  /** 국내: CRITICAL/HIGH/MEDIUM/LOW. 해외·트렌드는 없음 */
  importance?: string;
  /** 해외: 연결된 포트폴리오사 수 */
  matchCount?: number;
}

export interface BriefingRecommendation {
  headlines: BriefingHeadline[];
  /** 'rule' — 4단계 규칙. 'ai'는 2026-09-28 이전 방식(AI 순위)으로 만든 캐시다 */
  method: 'ai' | 'rule';
  /** 헤드라인마다 몇 단계(1~4)에서 뽑혔는지 — headlines와 같은 순서 */
  tiers?: number[];
  /** 이 추천의 근거가 된 수집 완료 시각(ISO) — 바뀌면 다시 계산한다 */
  basis: string;
  computedAt: string;
}

type IntraCandidate = BriefingCandidate & { category: string; company: string };

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

/** 교체 후보(국내) — 검수 화면 후보 전체, 묶지 않고 중요도 순. 묶으면 대표 1건만 남아 원하는 매체 기사를 못 고른다. */
async function loadIntraPicker(): Promise<IntraCandidate[]> {
  const all = await loadDigestCandidates();
  return [...all]
    .sort((a, b) =>
      (IMPORTANCE_RANK[b.importance] ?? 0) - (IMPORTANCE_RANK[a.importance] ?? 0)
      || b.priorityScore - a.priorityScore)
    .map(a => ({
      kind: 'intra' as const,
      ref: a.id,
      title: a.title,
      summary: a.oneLiner || a.title,
      source: a.source,
      url: a.link,
      label: CATEGORY_LABEL[a.category] ?? a.category,
      pubDate: new Date(a.pubDate).toISOString(),
      importance: a.importance,
      category: a.category,
      company: a.matchedKeyword,
    }));
}

/** 해외 후보 — 관련 판정된 Inter 기사 중 AI만(바이오 제외). 포트폴리오 연결이 많은 것 → 최신 순. */
async function loadInter(windowDays: number): Promise<BriefingCandidate[]> {
  const rows = await prisma.interNewsVerdict.findMany({
    where: { relevant: true, domain: 'ai', news: { publishedAt: { gte: daysAgo(windowDays) } } },
    select: {
      titleKo: true, reason: true,
      news: { select: { title: true, url: true, source: true, publishedAt: true } },
      _count: { select: { matches: true } },
    },
  });
  const seen = new Set<string>();
  return rows
    .filter(r => (seen.has(r.news.url) ? false : (seen.add(r.news.url), true)))
    .sort((a, b) => b._count.matches - a._count.matches
      || b.news.publishedAt.getTime() - a.news.publishedAt.getTime())
    .map(r => ({
      kind: 'inter' as const,
      ref: r.news.url,
      title: r.titleKo || r.news.title,
      summary: r.reason,
      source: r.news.source,
      url: r.news.url,
      label: INTER_LABEL,
      pubDate: r.news.publishedAt.toISOString(),
      matchCount: r._count.matches,
    }));
}

/** 이번 주 AI 트렌드 — 메일의 AI 트렌드 TOP 5와 같은 목록(사전계산을 읽으므로 빠르다). */
async function loadTrends(): Promise<BriefingCandidate[]> {
  const feed = await buildSignalFeed('ai');
  return feed.items.map(it => ({
    kind: 'trend' as const,
    ref: it.url,
    title: it.titleKo || it.title,
    summary: it.summaryKo || it.title,
    source: it.source,
    url: it.url,
    label: TREND_LABEL,
    pubDate: it.publishedAt ?? feed.generatedAt,
  }));
}

/** 화면·저장용 헤드라인만 남긴다(보조 정보 제거). */
function toHeadline(c: BriefingCandidate & Partial<IntraCandidate>): BriefingHeadline {
  const { pubDate: _p, importance: _i, matchCount: _m, category: _c, company: _k, ...h } = c;
  return h;
}
function toCandidate(c: IntraCandidate): BriefingCandidate {
  const { category: _c, company: _k, ...rest } = c;
  return rest;
}

/** 검수 화면 교체 후보 전체. 국내(7일) → AI 트렌드 → 해외 AI(7일). 바이오는 없다. */
export async function loadBriefingCandidates(): Promise<BriefingCandidate[]> {
  const [intra, trends, inter] = await Promise.all([
    loadIntraPicker(),
    loadTrends().catch(() => [] as BriefingCandidate[]),
    loadInter(PICKER_WINDOW_DAYS),
  ]);
  return [...intra.map(toCandidate), ...trends, ...inter];
}

async function currentBasis(): Promise<string> {
  const last = await prisma.runLog.findFirst({
    where: { runType: 'daily-collect', status: 'SUCCESS', finishedAt: { not: null } },
    orderBy: { finishedAt: 'desc' },
    select: { finishedAt: true },
  });
  return last?.finishedAt?.toISOString() ?? 'none';
}

/**
 * 최근 7일 동안 이미 브리핑에 나간 기사 url — 발송 때 저장된 스냅샷(daily_briefing)에서 읽는다.
 * 포트폴리오를 7일까지 넓혀 찾으므로, 이게 없으면 수요일에 나간 기사가 금·월에 또 나간다.
 * 오늘 스냅샷은 빼고 본다(오늘 재발송·재계산 때 자기 자신을 지우지 않게).
 */
async function recentlyBriefedUrls(): Promise<Set<string>> {
  const today = kstDateKey();
  const keys = Array.from({ length: 7 }, (_, i) => kstDateKey(new Date(Date.now() - (i + 1) * 864e5)));
  const rows = await prisma.dashboardInsight.findMany({
    where: { kind: 'daily_briefing', key: { in: keys.filter(k => k !== today) } },
    select: { value: true },
  });
  const urls = new Set<string>();
  for (const r of rows) {
    try { for (const h of (JSON.parse(r.value).headlines ?? [])) urls.add(h.url); } catch { /* 깨진 행은 무시 */ }
  }
  return urls;
}

/**
 * 다이제스트에 실린 기사만 재료로 쓴다(2026-09-28 소윤 결정 — "다이제스트에 나온 것 중 뽑는다,
 * 기간도 다이제스트를 그대로 따라간다"). 예전엔 여기서 3일·7일 창을 따로 잘라서, 다이제스트에
 * 버젓이 실린 스파크랩 기사 3건(9/21~22)이 추천에서는 빠졌다.
 * 검수 화면 미리보기와 같은 조립(review.ts buildReviewDigest)을 쓴다 — 편집자가 보는 메일이 기준.
 */
async function buildDigestForBriefing(): Promise<DigestData> {
  const candidates = await loadDigestCandidates();
  return attachAiSignals(await attachInterDigest(buildReviewDigest(candidates)));
}

function fromArticle(a: AnalyzedArticle & { id?: string }, idByLink: Map<string, string>): IntraCandidate {
  return {
    kind: 'intra',
    ref: idByLink.get(a.link) ?? a.id ?? a.link,
    title: a.title,
    summary: a.oneLiner || a.title,
    source: a.source,
    url: a.link,
    label: CATEGORY_LABEL[a.category] ?? a.category,
    pubDate: new Date(a.pubDate).toISOString(),
    importance: a.importance,
    category: a.category,
    company: a.matchedKeyword,
  };
}

/** 제목에 한글이 있는가 — 영문 기사(같은 사건의 영문판)를 국내 단계에서 거르는 용도 */
const isKorean = (t: string) => /[가-힣]/.test(t);

/** 4단계 규칙으로 5칸을 채운다 — 재료는 전부 다이제스트 섹션. */
async function pickByTiers(): Promise<{ picked: BriefingCandidate[]; tiers: number[] }> {
  const [briefed, data, candidates] = await Promise.all([
    recentlyBriefedUrls(),
    buildDigestForBriefing(),
    loadDigestCandidates(),
  ]);
  const idByLink = new Map(candidates.map(a => [a.link, a.id]));
  const rankOf = (a: IntraCandidate) => IMPORTANCE_RANK[a.importance ?? ''] ?? 0;

  // ① 스파크랩 직접 언급 섹션 — 한국어 기사만. 다이제스트엔 같은 사건이 한국어·영문 기사로 둘 다
  //    실리는데(중앙아시아 펀드 9/21), 브리핑은 한국어 음성이라 영문 제목은 읽기도 어색하다.
  const sparklabsAll = data.sparklabsArticles.filter(a => isKorean(a.title)).map(a => fromArticle(a, idByLink));

  // ② 포트폴리오 하이라이트 섹션(이미 회사당 1건) — 중요도 → 섹션 순서. 최소 PORTFOLIO_MIN건.
  //    주가 시황 기사는 뺀다. 지난 7일 브리핑에 나간 회사도 뺀다(같은 사건을 또 내보내지 않게).
  const briefedCompanies = new Set(
    candidates.filter(a => briefed.has(a.link)).map(a => a.matchedKeyword));
  //    섹션 대표가 주가 기사면 버리지 않고 같은 회사의 다른 기사로 바꾼다 — 다이제스트엔 스카이랩스가
  //    "주가 2.51% 하락"으로 실렸지만 같은 주 진짜 뉴스는 "타임 헬스테크 500 선정"이었다.
  const byCompany = (company: string) => candidates
    .filter(c => c.matchedKeyword === company && !STOCK_TICKER.test(c.title) && isKorean(c.title))
    .sort((x, y) => (IMPORTANCE_RANK[y.importance] ?? 0) - (IMPORTANCE_RANK[x.importance] ?? 0) || y.priorityScore - x.priorityScore)[0];
  const portfolio = data.portfolioArticles
    .map(a => (STOCK_TICKER.test(a.title) || !isKorean(a.title) ? byCompany(a.matchedKeyword) : a))
    .filter((a): a is NonNullable<typeof a> => !!a)
    .map(a => fromArticle(a, idByLink))
    .filter(a => !briefedCompanies.has(a.company))
    .map((a, i) => ({ a, i }))
    .sort((x, y) => rankOf(y.a) - rankOf(x.a) || x.i - y.i)
    .map(x => x.a);

  // ③ AI 트렌드 TOP 5 섹션
  const trends: BriefingCandidate[] = (data.aiSignals?.items ?? []).map(it => ({
    kind: 'trend' as const,
    ref: it.url,
    title: it.titleKo || it.title,
    summary: it.summaryKo || it.title,
    source: it.source,
    url: it.url,
    label: TREND_LABEL,
    pubDate: it.publishedAt ?? data.aiSignals!.generatedAt,
  }));

  // ④ 해외 트렌드 섹션 중 AI 카드(바이오 제외)
  const inter: BriefingCandidate[] = (data.inter?.cards ?? [])
    .filter(c => c.domainLabel === 'AI')
    .map(c => ({
      kind: 'inter' as const,
      ref: c.url,
      title: c.title,
      summary: c.cellLabel,
      source: c.media,
      url: c.url,
      label: INTER_LABEL,
      pubDate: new Date().toISOString(),
      matchCount: c.companies.length,
      companies: c.companies.map(x => x.name),
    }));

  // 스파크랩 기사가 많은 날에도 포트폴리오 자리를 남긴다.
  const reserved = Math.min(PORTFOLIO_MIN, portfolio.length);
  const sparklabs = sparklabsAll.filter(a => !briefed.has(a.url)).slice(0, BRIEFING_MAX - reserved);

  const tierLists: BriefingCandidate[][] = [sparklabs, portfolio, trends, inter];
  const picked: BriefingCandidate[] = [];
  const tiers: number[] = [];
  // 지난 브리핑에 나간 기사는 건너뛴다.
  const seenUrl = new Set<string>(briefed);
  tierLists.forEach((list, i) => {
    for (const c of list) {
      if (picked.length >= BRIEFING_MAX) return;
      if (seenUrl.has(c.url)) continue;
      seenUrl.add(c.url);
      picked.push(c);
      tiers.push(i + 1);
    }
  });
  return { picked, tiers };
}

/**
 * 오늘의 추천 5개. 같은 수집 결과로 이미 계산해 둔 게 있으면 그대로 돌려준다.
 * force=true면 새로 계산한다(검수 화면의 "추천 다시 받기").
 */
export async function getBriefingRecommendation(force = false): Promise<BriefingRecommendation> {
  const dateKey = kstDateKey();
  const basis = await currentBasis();
  if (!force) {
    const row = await prisma.dashboardInsight.findUnique({
      where: { kind_key: { kind: KIND_RECO, key: dateKey } },
      select: { value: true },
    });
    if (row) {
      try {
        const cached = JSON.parse(row.value) as BriefingRecommendation;
        // 'ai'는 예전 방식으로 만든 캐시 — 규칙이 바뀌었으니 다시 계산한다.
        if (cached.basis === basis && cached.method === 'rule' && cached.headlines?.length > 0) return cached;
      } catch { /* 깨진 캐시는 새로 계산 */ }
    }
  }

  const { picked, tiers } = await pickByTiers();
  const rec: BriefingRecommendation = {
    headlines: picked.map(toHeadline),
    method: 'rule',
    tiers,
    basis,
    computedAt: new Date().toISOString(),
  };
  const value = JSON.stringify(rec);
  await prisma.dashboardInsight.upsert({
    where: { kind_key: { kind: KIND_RECO, key: dateKey } },
    create: { kind: KIND_RECO, key: dateKey, value },
    update: { value },
  });
  return rec;
}
