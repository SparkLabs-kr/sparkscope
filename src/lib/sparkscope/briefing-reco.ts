/**
 * 데일리 브리핑 추천 헤드라인 5개 + 검수 화면의 교체 후보 목록.
 *
 * 추천은 아래 순서대로 위에서부터 채운다(2026-09-28 소윤 결정). 앞 단계가 5칸을 다 채우면
 * 뒤 단계는 들어가지 않는다 — 분야를 일부러 섞지 않는다.
 *
 *   1. 스파크랩 직접 언급 뉴스              (Article sparklabs_self)
 *   2. 포트폴리오사 뉴스 중 중요도 HIGH 이상  (Article portfolio_company*, 회사당 1건)
 *   3. 이번 주 AI 트렌드                    (메일 "🤖 AI 트렌드 TOP 5"와 같은 목록 — signal-feed.ts)
 *   4. 해외 주요 트렌드 토픽                 (Inter 기사 중 AI, 포트폴리오 연결 많은 순)
 *
 * 바이오는 추천에도 교체 후보에도 넣지 않는다. AC·VC 업계 동향·스타트업계 뉴스는 추천 대상이
 * 아니지만, 편집자가 직접 고를 수 있게 교체 후보에는 남긴다.
 *
 * 규칙만으로 정하므로 같은 데이터면 늘 같은 답이 나온다. 그래도 수집 1회당 한 번 계산해
 * DashboardInsight(briefing_reco)에 저장한다 — AI 트렌드 목록은 2시간마다 새로 계산되므로,
 * 검수 화면을 본 뒤 발송 전에 목록이 바뀌면 "화면에선 A였는데 영상엔 B"가 될 수 있다.
 */
import { prisma } from '@/lib/prisma';
import { loadDigestCandidates, type ReviewArticle } from './review';
import { buildClusteredPool } from './digest';
import { buildSignalFeed } from './signal-feed';
import { BRIEFING_MAX, kstDateKey, type BriefingHeadline } from './briefing';

const KIND_RECO = 'briefing_reco';
/** 추천 대상 창 — 발송 재료 창(loadSendArticles 3일)과 같게 둔다. 교체 후보는 검수 화면과 같은 7일. */
const RECO_WINDOW_DAYS = 3;
const PICKER_WINDOW_DAYS = 7;

const CATEGORY_LABEL: Record<string, string> = {
  sparklabs_self: '🏢 스파크랩 뉴스',
  portfolio_company: '💼 포트폴리오사',
  portfolio_company_tw: '💼 포트폴리오사 · 대만',
  portfolio_company_gv: '💼 포트폴리오사 · 글로벌',
  competitor: '🤝 AC·VC 업계 동향',
  industry_trend: '🌐 스타트업계 뉴스',
};
const PORTFOLIO_CATEGORIES = new Set(['portfolio_company', 'portfolio_company_tw', 'portfolio_company_gv']);
const IMPORTANCE_RANK: Record<string, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
const TREND_LABEL = '📈 이번 주 AI 트렌드';
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

/**
 * 국내 후보 — 검수 화면과 같은 가드를 통과한 기사를 중요도 순으로.
 * cluster=true(추천용)면 같은 사건은 하나로 묶는다. 교체 목록은 묶지 않는다 — 묶으면 대표 1건만
 * 남아서, 편집자가 원하는 매체의 기사(예: 영문 대표에 가려진 한국어 기사)를 고를 수 없다.
 * windowDays=null이면 검수 화면 후보 창 그대로(7일 전 0시부터) — 시간 단위로 다시 자르면
 * 검수 목록엔 있는 기사가 교체 목록에선 빠진다.
 */
async function loadIntra(windowDays: number | null, cluster: boolean): Promise<IntraCandidate[]> {
  const since = windowDays === null ? null : daysAgo(windowDays);
  const all = (await loadDigestCandidates()).filter(a => !since || new Date(a.pubDate) >= since);
  // buildClusteredPool은 id 자리에 링크를 넣으므로, 대표 기사의 id를 링크로 되찾는다.
  const idByLink = new Map(all.map(a => [a.link, a.id]));
  const pool = cluster ? (buildClusteredPool(all) as ReviewArticle[]) : all;
  return pool
    .sort((a, b) =>
      (IMPORTANCE_RANK[b.importance] ?? 0) - (IMPORTANCE_RANK[a.importance] ?? 0)
      || b.priorityScore - a.priorityScore)
    .map(a => ({
      kind: 'intra' as const,
      ref: idByLink.get(a.link) ?? a.id,
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
    loadIntra(null, false),
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

/** 4단계 규칙으로 5칸을 채운다. */
async function pickByTiers(): Promise<{ picked: BriefingCandidate[]; tiers: number[] }> {
  const [intra, trends, inter] = await Promise.all([
    loadIntra(RECO_WINDOW_DAYS, true),
    loadTrends().catch(e => { console.error('[briefing-reco] AI 트렌드 읽기 실패(건너뜀):', e); return [] as BriefingCandidate[]; }),
    loadInter(RECO_WINDOW_DAYS),
  ]);

  // 2단계: 포트폴리오사 HIGH 이상, 회사당 1건 — 같은 회사 기사 두 개가 두 칸을 차지하지 않게.
  const usedCompany = new Set<string>();
  const portfolioHigh = intra.filter(a => {
    if (!PORTFOLIO_CATEGORIES.has(a.category)) return false;
    if ((IMPORTANCE_RANK[a.importance ?? ''] ?? 0) < IMPORTANCE_RANK.HIGH) return false;
    if (usedCompany.has(a.company)) return false;
    usedCompany.add(a.company);
    return true;
  });

  const tierLists: BriefingCandidate[][] = [
    intra.filter(a => a.category === 'sparklabs_self'),
    portfolioHigh,
    trends,
    inter,
  ];
  const picked: BriefingCandidate[] = [];
  const tiers: number[] = [];
  const seenUrl = new Set<string>();
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
