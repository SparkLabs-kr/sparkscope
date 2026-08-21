// 본부 업무용 조회 — 기사 검색이 아니라 "그래서 뭘 해야 하나"에 답하는 데이터.
//
// 전부 DB에 이미 있는데 챗봇이 한 번도 안 보던 것들이다:
//   - pitchScore: 수집 때 기사마다 매겨둔 기획기사 피칭 가능성 (27,809건에 있음)
//   - MonitoringTarget: 감시 대상 명단 530곳 — "기사가 안 난 곳"은 이게 있어야 알 수 있다
//   - Digest: 실제로 나간 다이제스트 아카이브
import { prisma } from '@/lib/prisma';
import { normalizeSource, TIER_OF, MEDIA_LIST } from './media';
import { resolvePeriod, dedupeArticles } from './chat-query';
import { categoryLabel, PERIOD_LABEL } from './chat-types';
import { isBlockedNoise, matchesAsToken } from './relevance';
import { NEGATIVE_KEYWORDS, detectCrises, crisisFallbackCause, type ArticleLite } from './insights';
import { getPrecomputedCrisisCauses, wasInsightsBatchFreshToday } from './dashboard-insights';
import type { ChatPeriod, ChatScope, ChatQueryResult } from './chat-types';
import { loadDigestCandidates, buildReviewDigest } from './review';
import { renderDigestHtml } from './digest';

const SCOPE_CATEGORY: Record<ChatScope, string> = {
  portfolio: 'portfolio_company',
  competitor: 'competitor',
  sparklabs: 'sparklabs_self',
  industry: 'industry_trend',
  // inter(해외 트렌드)는 Article 테이블의 카테고리가 아니라 별도 해외 데이터(InterNews)라
  // 여기서 다루는 국내 기사 집계(피칭 소재·노출 사각지대)에는 대응하는 카테고리가 없다.
  // 빈 문자열로 두면 scopeCategories의 filter(Boolean)에서 자연히 빠진다.
  inter: '',
};

function scopeCategories(scopes: ChatScope[]): string[] | null {
  const out = scopes.map((s) => SCOPE_CATEGORY[s]).filter(Boolean);
  return out.length ? out : null;
}

// ───────────────────────── 피칭 기회 ─────────────────────────

/**
 * 기획기사 피칭 소재 — pitchScore가 높은 기사를 뽑는다.
 * 수집 단계에서 이미 점수와 주제(pitchTopic)를 매겨뒀는데 챗봇이 쓰지 않고 있었다.
 */
export async function runPitchQuery(input: {
  period: ChatPeriod;
  scopes: ChatScope[];
  minScore?: number;
  limit?: number;
}): Promise<ChatQueryResult> {
  const minScore = input.minScore ?? 70;
  const limit = Math.min(input.limit ?? 20, 50);
  const range = resolvePeriod(input.period);
  const cats = scopeCategories(input.scopes);

  const where: any = { isNoise: false, pitchScore: { gte: minScore } };
  if (range) where.pubDate = { gte: range.gte, lte: range.lte };
  if (cats) where.category = { in: cats };

  const [rows, total] = await Promise.all([
    prisma.article.findMany({
      where,
      orderBy: [{ pitchScore: 'desc' }, { pubDate: 'desc' }],
      take: 200,
      select: {
        id: true, title: true, link: true, source: true, pubDate: true, category: true,
        matchedKeyword: true, tone: true, riskFlag: true, oneLiner: true, ourTake: true,
        importance: true, pitchScore: true, pitchTopic: true, priorityScore: true,
      },
    }),
    prisma.article.count({ where }),
  ]);

  const clean = dedupeArticles(rows);
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  const topic = new Map<string, number>();
  const comp = new Map<string, number>();
  const src = new Map<string, number>();
  const cat = new Map<string, number>();
  for (const a of clean) {
    if (a.pitchTopic) bump(topic, a.pitchTopic);
    if (a.matchedKeyword) bump(comp, a.matchedKeyword);
    bump(src, normalizeSource(a.source));
    bump(cat, a.category);
  }
  const top = (m: Map<string, number>, n: number) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([name, count]) => ({ name, count }));

  return {
    terms: [`피칭 점수 ${minScore}점 이상`],
    periodLabel: '',
    total,
    sampled: rows.length >= 200,
    prevTotal: null,
    deltaPct: null,
    byCategory: [...cat.entries()].sort((a, b) => b[1] - a[1]).map(([category, count]) => ({ category, count })),
    topSources: top(src, 5),
    // 이 자리는 화면에서 "회사·키워드"로 보인다. 피칭 질문에선 주제가 더 유용하다.
    topCompanies: top(topic, 6),
    negativeCount: clean.filter((a) => a.tone === 'NEGATIVE').length,
    riskCount: clean.filter((a) => a.riskFlag).length,
    monthly: null,
    noisyKeywords: null,
    articles: clean.slice(0, limit).map((a) => ({
      id: a.id,
      title: a.title,
      link: a.link,
      source: normalizeSource(a.source),
      pubDate: a.pubDate.toISOString(),
      category: a.category,
      matchedKeyword: a.matchedKeyword,
      // 업계동향은 matchedKeyword가 "벤처캐피탈"·"스타트업"처럼 회사명이 아니라 주제 태그다.
      // 이걸 빠뜨리면 화면에 "🏢 관련 포트폴리오사: 스타트업"처럼 표시돼 헷갈린다(2026-08-12 피드백).
      tagKind: a.category === 'industry_trend' ? 'topic' : 'company',
      tone: a.tone,
      riskFlag: a.riskFlag,
      // "[92점] 벤처캐피탈, 스타트업, ..."처럼 점수+태그 나열이 자연스러운 요약보다 오히려
      // 안 읽혔다(2026-08-12 피드백) — 점수는 이제 위쪽 피칭 점수 막대그래프에 이미 나오니
      // 여기선 원래 AI 한 줄 요약(자연스러운 문장)을 그대로 쓰고, 그마저 없을 때만 주제 태그로
      // 대체한다.
      oneLiner: a.oneLiner ?? (a.pitchTopic ? `피칭 포인트: ${a.pitchTopic}` : null),
      importance: a.importance,
      // 피칭 점수 순위 막대그래프용.
      pitchScore: a.pitchScore,
      priorityScore: a.priorityScore,
    })),
  };
}

/** 모델에게 줄 압축 형태 — 본부 관점 코멘트(ourTake)까지 함께 준다. */
export async function pitchDetailsForModel(input: {
  period: ChatPeriod;
  scopes: ChatScope[];
  minScore?: number;
}) {
  const range = resolvePeriod(input.period);
  const cats = scopeCategories(input.scopes);
  const where: any = { isNoise: false, pitchScore: { gte: input.minScore ?? 70 } };
  if (range) where.pubDate = { gte: range.gte, lte: range.lte };
  if (cats) where.category = { in: cats };

  const rows = await prisma.article.findMany({
    where,
    orderBy: [{ pitchScore: 'desc' }, { pubDate: 'desc' }],
    take: 18,
    select: {
      title: true, source: true, pubDate: true, matchedKeyword: true,
      pitchScore: true, pitchTopic: true, ourTake: true, oneLiner: true,
    },
  });
  return rows.map((a) => ({
    title: a.title,
    company: a.matchedKeyword,
    source: normalizeSource(a.source),
    date: a.pubDate.toISOString().slice(0, 10),
    pitchScore: a.pitchScore,
    pitchTopic: a.pitchTopic,
    // 수집 때 뽑아둔 본부 관점 한 줄. 있으면 피칭 각도를 잡는 데 그대로 쓸 수 있다.
    ourTake: a.ourTake ?? a.oneLiner,
  }));
}

// ───────────────────────── 노출 사각지대 ─────────────────────────

/**
 * 감시 대상 중 해당 기간에 기사가 하나도 안 난 곳.
 *
 * 기사 테이블만 봐서는 절대 못 구하는 값이다 — "없는 것"을 찾으려면 명단이 필요하다.
 * 홍보 담당에게는 많이 나온 곳보다 이쪽이 더 급한 정보일 수 있다.
 */
export async function runCoverageGap(input: {
  period: ChatPeriod;
  scopes: ChatScope[];
  /** 포트폴리오 티어(A/B/C)로 좁히기 */
  tier?: string | null;
}) {
  const range = resolvePeriod(input.period);
  const cats = scopeCategories(input.scopes) ?? ['portfolio_company'];

  const targetWhere: any = { status: 'ACTIVE', category: { in: cats } };
  if (input.tier) targetWhere.tier = input.tier;

  const targets = await prisma.monitoringTarget.findMany({
    where: targetWhere,
    select: { name: true, category: true, tier: true, portfolioStatus: true },
  });

  // 기간 내 기사가 있는 감시대상 이름을 한 번에 모은다.
  const articleWhere: any = { isNoise: false, category: { in: cats } };
  if (range) articleWhere.pubDate = { gte: range.gte, lte: range.lte };
  const covered = await prisma.article.groupBy({
    by: ['matchedKeyword'],
    where: articleWhere,
    _count: { _all: true },
  });
  const countByName = new Map(covered.map((c) => [c.matchedKeyword, c._count._all]));

  const withCount = targets.map((t) => ({
    name: t.name,
    category: categoryLabel(t.category),
    tier: t.tier,
    portfolioStatus: t.portfolioStatus,
    count: countByName.get(t.name) ?? 0,
  }));

  const silent = withCount.filter((t) => t.count === 0);
  const thin = withCount.filter((t) => t.count > 0 && t.count <= 2).sort((a, b) => a.count - b.count);

  return {
    totalTargets: targets.length,
    silentCount: silent.length,
    thinCount: thin.length,
    // 이름만 길게 나열하면 토큰만 먹는다. 티어가 있으면 높은 쪽부터.
    silent: silent
      .sort((a, b) => (a.tier ?? 'Z').localeCompare(b.tier ?? 'Z'))
      .slice(0, 60)
      .map((t) => (t.tier ? `${t.name}(${t.tier})` : t.name)),
    thin: thin.slice(0, 30).map((t) => `${t.name} ${t.count}건`),
  };
}

// ───────────────────────── 위기 감지 ─────────────────────────

/**
 * 부정 기사가 몰린 회사를 찾는다 — 대시보드 위기 카드와 같은 판정.
 *
 * 챗봇엔 부정 톤 "기사 목록"을 주는 필터(only_negative)밖에 없어서, "지금 위기인 포폴사
 * 있어?"에 기사만 죽 나열하고 정작 "어느 회사에 몰렸는지"를 못 알려줬다(2026-08-19).
 * 대시보드는 detectCrises()로 회사 단위로 묶어 보여주는데 그 로직을 챗봇이 안 쓰고 있었다.
 *
 * 판정 로직(detectCrises·negativeInfo)과 원인 문장(사전계산 → 폴백)을 대시보드와 그대로
 * 공유한다. 두 화면이 같은 회사를 두고 다른 소리를 하면 안 된다.
 */
export async function runCrisisWatch(input: {
  /** 며칠치를 볼지. 대시보드 기본값은 3일 */
  days?: number;
  /** 부정 기사 몇 건부터 위기로 볼지. 대시보드 기본값은 2건 */
  threshold?: number;
  /** 특정 회사만 보고 싶을 때 */
  company?: string | null;
}) {
  const days = Math.min(Math.max(input.days ?? 3, 1), 90);
  const threshold = Math.max(input.threshold ?? 2, 1);

  const since = new Date();
  since.setDate(since.getDate() - days);
  since.setHours(0, 0, 0, 0);

  // 대시보드와 같은 조건: 부정 톤이거나 제목에 부정 키워드가 있는 포트폴리오사 기사.
  const negOr = [
    { tone: 'NEGATIVE' as string | null },
    ...NEGATIVE_KEYWORDS.map((k) => ({ title: { contains: k } })),
  ];
  const where: any = {
    pubDate: { gte: since },
    isNoise: false,
    category: 'portfolio_company',
    OR: negOr,
  };
  if (input.company) where.matchedKeyword = input.company;

  const [rows, targets] = await Promise.all([
    prisma.article.findMany({
      where,
      select: {
        id: true, title: true, link: true, source: true, pubDate: true,
        matchedKeyword: true, category: true, tone: true,
      },
      take: 800,
    }),
    prisma.monitoringTarget.findMany({
      where: { category: 'portfolio_company', status: 'ACTIVE' },
      select: { primaryKeyword: true, name: true, englishName: true, helperKeywords: true },
    }),
  ]);

  // 회사명이 제목에 토큰으로 실제 등장하는지 확인 — 부분문자열 오탐(동명이인 등)을 막는다.
  // 대시보드의 passesName과 같은 기준.
  const keyMap = new Map<string, string[]>();
  for (const t of targets) {
    const keys = [t.primaryKeyword, t.name, t.englishName, ...(t.helperKeywords?.split(',') ?? [])]
      .map((k) => k?.trim())
      .filter((k): k is string => !!k);
    keyMap.set(t.primaryKeyword, keys.length ? keys : [t.primaryKeyword]);
  }
  const clean = rows.filter((a) => {
    if (isBlockedNoise({ title: a.title, link: a.link, source: a.source })) return false;
    const keys = keyMap.get(a.matchedKeyword) ?? [a.matchedKeyword];
    return keys.some((k) => matchesAsToken(a.title, k));
  });

  const cards = detectCrises(clean as ArticleLite[], threshold);

  // 원인 문장 — 대시보드와 같은 우선순위(오늘 배치 결과 → 폴백 문구).
  // 챗봇에서는 실시간 LLM 호출까지는 하지 않는다(이미 에이전트가 답변을 쓰면서
  // 기사 제목을 직접 읽고 원인을 설명한다 — 여기서 또 부르면 중복 비용이다).
  const batchFresh = await wasInsightsBatchFreshToday();
  const precomputed = batchFresh
    ? await getPrecomputedCrisisCauses(cards.map((c) => c.company))
    : new Map<string, { cause: string; computedAt: Date }>();

  return {
    windowDays: days,
    threshold,
    crisisCount: cards.length,
    // 0건도 의미 있는 답이다 — "조용하다"는 걸 분명히 말해주라고 붙인다.
    note: cards.length
      ? undefined
      : `최근 ${days}일간 부정 기사가 ${threshold}건 이상 몰린 포트폴리오사는 없다. 조용한 상태라고 답해라.`,
    companies: cards.map((c) => {
      const pre = precomputed.get(c.company);
      return {
        company: c.company,
        negCount: c.negCount,
        reasonKeywords: c.reasonKeywords,
        cause: pre?.cause ?? crisisFallbackCause(c.reasonKeywords),
        causeSource: pre ? ('ai' as const) : ('keyword' as const),
        titles: c.titles,
        representative: {
          title: c.article.title,
          source: normalizeSource(c.article.source),
          date: c.article.pubDate.toISOString().slice(0, 10),
        },
      };
    }),
  };
}

/** 위기 감지 결과를 화면 카드(ChatQueryResult)로도 보여주기 위한 기사 목록. */
export async function crisisArticlesForUi(input: {
  days?: number;
  threshold?: number;
  company?: string | null;
}): Promise<ChatQueryResult> {
  const days = Math.min(Math.max(input.days ?? 3, 1), 90);
  const since = new Date();
  since.setDate(since.getDate() - days);
  since.setHours(0, 0, 0, 0);

  const watch = await runCrisisWatch(input);
  const companies = new Set(watch.companies.map((c) => c.company));

  const rows = companies.size
    ? await prisma.article.findMany({
        where: {
          pubDate: { gte: since },
          isNoise: false,
          category: 'portfolio_company',
          matchedKeyword: { in: [...companies] },
          OR: [{ tone: 'NEGATIVE' }, ...NEGATIVE_KEYWORDS.map((k) => ({ title: { contains: k } }))],
        },
        orderBy: [{ pubDate: 'desc' }],
        take: 200,
        select: {
          id: true, title: true, link: true, source: true, pubDate: true, category: true,
          matchedKeyword: true, tone: true, riskFlag: true, oneLiner: true, importance: true,
          priorityScore: true,
        },
      })
    : [];

  const clean = dedupeArticles(rows);
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  const comp = new Map<string, number>();
  const src = new Map<string, number>();
  for (const a of clean) {
    if (a.matchedKeyword) bump(comp, a.matchedKeyword);
    bump(src, normalizeSource(a.source));
  }
  const top = (m: Map<string, number>, n: number) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([name, count]) => ({ name, count }));

  return {
    terms: [`최근 ${days}일 위기 감지`],
    periodLabel: `최근 ${days}일`,
    total: clean.length,
    sampled: false,
    prevTotal: null,
    deltaPct: null,
    byCategory: [{ category: 'portfolio_company', count: clean.length }],
    topSources: top(src, 5),
    topCompanies: top(comp, 6),
    negativeCount: clean.filter((a) => a.tone === 'NEGATIVE').length,
    riskCount: clean.filter((a) => a.riskFlag).length,
    monthly: null,
    noisyKeywords: null,
    articles: clean.slice(0, 30).map((a) => ({
      id: a.id,
      title: a.title,
      link: a.link,
      source: normalizeSource(a.source),
      pubDate: a.pubDate.toISOString(),
      category: a.category,
      matchedKeyword: a.matchedKeyword,
      tagKind: 'company' as const,
      tone: a.tone,
      riskFlag: a.riskFlag,
      oneLiner: a.oneLiner,
      importance: a.importance,
      priorityScore: a.priorityScore,
    })),
  };
}

// ───────────────────────── 다이제스트 아카이브 ─────────────────────────

/** 실제로 나간 다이제스트 기록. "지난주 메일에 뭐 나갔더라" 같은 질문용. */
export async function runDigestArchive(input: { limit?: number; on?: string | null }) {
  const where: any = {};
  if (input.on) {
    const d = new Date(input.on);
    if (!Number.isNaN(+d)) {
      const next = new Date(d);
      next.setDate(next.getDate() + 1);
      where.date = { gte: d, lt: next };
    }
  }
  const rows = await prisma.digest.findMany({
    where,
    orderBy: { date: 'desc' },
    take: Math.min(input.limit ?? 10, 30),
    select: { date: true, subject: true, recipients: true, sentAt: true, errorMsg: true },
  });
  return rows.map((d) => ({
    date: d.date.toISOString().slice(0, 10),
    subject: d.subject,
    recipients: d.recipients,
    sent: !!d.sentAt,
    error: d.errorMsg ?? undefined,
  }));
}

// ───────────────────────── 저장한 기사(스크랩·북마크) ─────────────────────────

/**
 * "내가 저장해둔 기사" 조회.
 *
 * 저장 방식이 두 가지인데 성격이 다르다 — 섞어서 한 덩어리로 답하면 안 된다.
 *   - 스크랩(Article.isScrapped): 본부 **공용**. 커뮤니케이션 본부 지정 계정이 찍고
 *     팀 전체가 같은 목록을 본다. 그래서 누가 찍었는지(scrappedBy)를 같이 보여준다.
 *   - 북마크(Bookmark): **개인용**. 로그인한 본인 것만 보인다.
 *
 * 화면(대시보드 스크랩/북마크 탭)과 같은 데이터를 그대로 읽는다.
 */
export async function runSavedArticles(input: {
  kind?: 'scrap' | 'bookmark' | 'both';
  userEmail: string;
  days?: number | null;
  limit?: number;
}): Promise<{
  kind: 'scrap' | 'bookmark' | 'both';
  scrapCount: number;
  bookmarkCount: number;
  periodLabel: string;
  note?: string;
  result: ChatQueryResult;
}> {
  const kind = input.kind ?? 'both';
  const limit = Math.min(Math.max(input.limit ?? 30, 1), 100);
  // days를 안 주면 기간 제한 없이 전부 본다 — 저장은 오래된 걸 다시 찾으려고 하는 것이라
  // 기본값으로 최근 며칠만 자르면 오히려 원하는 걸 못 찾는다.
  const days = typeof input.days === 'number' && input.days > 0 ? Math.min(input.days, 3650) : null;
  const since = days ? new Date(Date.now() - days * 86400_000) : null;

  const SELECT = {
    id: true, title: true, link: true, source: true, pubDate: true, category: true,
    matchedKeyword: true, tone: true, riskFlag: true, oneLiner: true, importance: true,
    priorityScore: true, isScrapped: true, scrappedAt: true, scrappedBy: true,
  } as const;

  const wantScrap = kind === 'scrap' || kind === 'both';
  const wantBookmark = kind === 'bookmark' || kind === 'both';

  // 북마크는 Bookmark.userId 기준인데 챗봇이 아는 건 이메일뿐이라 User를 한 번 거친다.
  const user = wantBookmark
    ? await prisma.user.findUnique({ where: { email: input.userEmail }, select: { id: true } })
    : null;

  const [scrapRows, bookmarkRows] = await Promise.all([
    wantScrap
      ? prisma.article.findMany({
          where: { isScrapped: true, ...(since ? { scrappedAt: { gte: since } } : {}) },
          orderBy: [{ scrappedAt: 'desc' }],
          take: 200,
          select: SELECT,
        })
      : Promise.resolve([]),
    user
      ? prisma.bookmark.findMany({
          where: { userId: user.id, ...(since ? { createdAt: { gte: since } } : {}) },
          orderBy: [{ createdAt: 'desc' }],
          take: 200,
          select: { articleId: true },
        })
      : Promise.resolve([]),
  ]);

  // Bookmark에는 Article 관계가 걸려 있지 않아(articleId만 있다) 기사를 따로 읽는다.
  // 북마크한 기사가 그 사이 지워졌으면 그냥 빠진다.
  const bookmarkIds = bookmarkRows.map((b) => b.articleId);
  const bookmarked = bookmarkIds.length
    ? await prisma.article.findMany({ where: { id: { in: bookmarkIds } }, select: SELECT })
    : [];

  // 같은 기사를 스크랩도 하고 북마크도 했으면 한 번만 센다.
  const merged = new Map<string, typeof scrapRows[number]>();
  for (const a of [...scrapRows, ...bookmarked]) merged.set(a.id, a);
  const rows = [...merged.values()].sort((a, b) => +b.pubDate - +a.pubDate);

  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  const comp = new Map<string, number>();
  const src = new Map<string, number>();
  const cat = new Map<string, number>();
  for (const a of rows) {
    if (a.matchedKeyword) bump(comp, a.matchedKeyword);
    bump(src, normalizeSource(a.source));
    bump(cat, a.category);
  }
  const top = (m: Map<string, number>, n: number) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([name, count]) => ({ name, count }));

  const periodLabel = days ? `최근 ${days}일 저장` : '저장한 기사 전체';

  // 0건일 때 왜 0건인지 구분해서 알려준다 — "저장한 게 없다"와 "볼 권한이 없다"는 다르다.
  let note: string | undefined;
  if (rows.length === 0) {
    if (wantBookmark && !user) {
      note = wantScrap
        ? '이 계정으로 북마크한 기록을 찾지 못했다(계정 정보 없음). 스크랩만 확인한 결과다.'
        : '이 계정으로 북마크한 기록을 찾지 못했다(계정 정보 없음).';
    } else {
      note = days
        ? `최근 ${days}일 안에 저장한 기사가 없다. 기간을 빼고 다시 조회하면 예전 것까지 볼 수 있다.`
        : '저장해둔 기사가 아직 없다. 대시보드 기사 목록에서 별표(스크랩)나 북마크를 찍으면 여기서 다시 찾을 수 있다.';
    }
  }

  return {
    kind,
    scrapCount: scrapRows.length,
    bookmarkCount: bookmarked.length,
    periodLabel,
    note,
    result: {
      terms: [periodLabel],
      periodLabel,
      total: rows.length,
      sampled: false,
      prevTotal: null,
      deltaPct: null,
      byCategory: [...cat.entries()].map(([category, count]) => ({ category, count })),
      topSources: top(src, 5),
      topCompanies: top(comp, 6),
      negativeCount: rows.filter((a) => a.tone === 'NEGATIVE').length,
      riskCount: rows.filter((a) => a.riskFlag).length,
      monthly: null,
      noisyKeywords: null,
      articles: rows.slice(0, limit).map((a) => ({
        id: a.id,
        title: a.title,
        link: a.link,
        source: normalizeSource(a.source),
        pubDate: a.pubDate.toISOString(),
        category: a.category,
        matchedKeyword: a.matchedKeyword,
        tagKind: 'company' as const,
        tone: a.tone,
        riskFlag: a.riskFlag,
        oneLiner: a.oneLiner,
        importance: a.importance,
        priorityScore: a.priorityScore,
      })),
    },
  };
}

// ───────────────────────── 매체 분석 ─────────────────────────

/**
 * "어느 매체가 우리를 다루나 / 어디에 아직 안 실렸나".
 *
 * 기사 검색도 상위 매체 5곳은 돌려주지만, 그건 "많이 나온 순"일 뿐이라
 * 홍보 판단에 필요한 두 가지를 답하지 못한다:
 *   1) 티어 — 조선·중앙 같은 종합일간지(티어1)에 실린 비중. 건수만 많고 전부
 *      티어4면 "노출은 됐지만 파급은 약하다"는 뜻인데 건수로는 안 보인다.
 *   2) 아직 안 실린 주요 매체 — 다음에 어디를 뚫어야 하는지. 없는 것을 찾는 거라
 *      기사 목록을 아무리 봐도 나오지 않는다(coverage_gap과 같은 발상).
 */
export async function runMediaAnalysis(input: {
  period: ChatPeriod;
  scopes: ChatScope[];
  company?: string | null;
  limit?: number;
}): Promise<{
  periodLabel: string;
  total: number;
  byTier: { tier: number; label: string; count: number; pct: number }[];
  topMedia: { name: string; tier: number | null; count: number; pct: number }[];
  unreachedMajor: { name: string; tier: number }[];
  company?: string;
  note?: string;
}> {
  const range = resolvePeriod(input.period);
  const cats = scopeCategories(input.scopes);
  const limit = Math.min(Math.max(input.limit ?? 12, 3), 30);

  // 기사를 통째로 읽어와 세지 않고 DB에서 매체별로 집계한다.
  //   기간이 넓으면 기사가 수만 건이라, take로 잘라 세면 분포가 조용히 틀린다
  //   (2026-08-19: take 5000으로 3개월을 세다가 4,996건에서 잘려 나갔다).
  // 대신 isBlockedNoise 재검사는 못 건다(제목·링크가 필요해서). 수집 때 매긴
  // isNoise 플래그까지만 걸리는데, 실측상 그 차이는 5,000건에 4건 수준이고
  // 여기서 필요한 건 "정확한 건수"가 아니라 매체 분포 비율이라 이 쪽이 낫다.
  const grouped = await prisma.article.groupBy({
    by: ['source'],
    where: {
      isNoise: false,
      ...(range ? { pubDate: { gte: range.gte, lte: range.lte } } : {}),
      ...(cats ? { category: { in: cats } } : {}),
      ...(input.company ? { matchedKeyword: { contains: input.company, mode: 'insensitive' } } : {}),
    },
    _count: { _all: true },
  });

  // 매체명 표기 흔들림(도메인·별칭)을 정규화하면서 합친다.
  const counts = new Map<string, number>();
  for (const g of grouped) {
    const name = normalizeSource(g.source);
    counts.set(name, (counts.get(name) ?? 0) + g._count._all);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);

  const TIER_LABEL: Record<number, string> = {
    1: '종합일간지', 2: '통신사·경제일간지', 3: '디지털 경제·종합', 4: '스타트업 전문',
  };
  const tierCount = new Map<number, number>();
  for (const [name, c] of counts) {
    // 등록 안 된 매체는 0번(기타)으로 모은다 — 티어를 함부로 부여하지 않는다.
    const t = TIER_OF.get(name) ?? 0;
    tierCount.set(t, (tierCount.get(t) ?? 0) + c);
  }

  const byTier = [...tierCount.entries()]
    .sort((a, b) => (a[0] || 99) - (b[0] || 99))
    .map(([tier, count]) => ({
      tier,
      label: tier === 0 ? '기타(미등록 매체)' : `티어${tier} ${TIER_LABEL[tier]}`,
      count,
      pct: pct(count),
    }));

  const topMedia = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, count]) => ({ name, tier: TIER_OF.get(name) ?? null, count, pct: pct(count) }));

  // 티어1·2 중 이 기간에 한 건도 안 실린 곳. "다음에 어디를 뚫을까"의 후보다.
  const unreachedMajor = MEDIA_LIST
    .filter((m) => m.tier <= 2 && !counts.has(m.name))
    .map((m) => ({ name: m.name, tier: m.tier }));

  return {
    periodLabel: PERIOD_LABEL[input.period] ?? String(input.period),
    total,
    byTier,
    topMedia,
    unreachedMajor,
    ...(input.company ? { company: input.company } : {}),
    ...(total === 0
      ? { note: '이 조건으로는 기사가 없어 매체 분포를 낼 수 없다. 기간이나 범위를 넓혀보라고 안내해라.' }
      : {}),
  };
}

// ───────────────────────── 다이제스트 미리보기(레이아웃 그대로) ─────────────────────────

/**
 * 다이제스트 질문에 실제 메일과 같은 레이아웃을 그려서 돌려준다.
 *
 * 왜 따로 두는가 — 예전엔 모델이 기사 제목·매체·날짜를 답변 문장 안에 전부 다시
 * 타이핑했다. 출력 토큰(비싼 쪽)이 상한 가까이 차는데 결과물은 그냥 긴 목록이었다.
 * 레이아웃은 이미 renderDigestHtml()이 AI 없이 그리므로, 렌더링은 서버가 하고
 * 모델은 인트로 한두 문장만 쓰게 한다. 추가 비용은 사실상 0이고 출력은 오히려 준다
 * (2026-08-21 소윤 요청).
 *
 * ★ 반환되는 html은 모델에게 주지 않는다 — 모델 컨텍스트에 넣으면 절약한 토큰을
 *   그대로 도로 쓰는 꼴이다. 화면에만 내려보낸다.
 */
export async function runDigestPreview(input: {
  source: 'archive' | 'draft';
  /** archive일 때 특정 날짜(YYYY-MM-DD). 없으면 가장 최근 발송본 */
  on?: string | null;
  /** draft일 때 모델이 써 준 편집자 한 줄 */
  intro?: string | null;
}): Promise<{
  html: string | null;
  meta: {
    source: 'archive' | 'draft';
    dateLabel: string | null;
    subject: string | null;
    sent: boolean | null;
    recipients: number | null;
    stats: Record<string, number> | null;
    note: string;
  };
}> {
  if (input.source === 'archive') {
    const where: Record<string, unknown> = {};
    if (input.on) {
      const d = new Date(input.on);
      if (!Number.isNaN(+d)) {
        const next = new Date(d);
        next.setDate(next.getDate() + 1);
        where.date = { gte: d, lt: next };
      }
    }
    const row = await prisma.digest.findFirst({
      where,
      orderBy: { date: 'desc' },
      select: { date: true, subject: true, htmlBody: true, recipients: true, sentAt: true },
    });
    if (!row) {
      return {
        html: null,
        meta: {
          source: 'archive', dateLabel: null, subject: null, sent: null, recipients: null, stats: null,
          note: input.on
            ? `${input.on}에 발송된 다이제스트 기록이 없다. 날짜를 확인하거나 최근 발송본을 보겠냐고 물어라.`
            : '발송된 다이제스트 기록이 아직 없다.',
        },
      };
    }
    return {
      html: row.htmlBody,
      meta: {
        source: 'archive',
        dateLabel: row.date.toISOString().slice(0, 10),
        subject: row.subject,
        sent: !!row.sentAt,
        recipients: row.recipients,
        stats: null,
        note:
          '실제로 발송된 그 메일을 화면에 그대로 띄웠다. 기사 목록을 다시 나열하지 마라 — ' +
          '사용자 화면에 이미 전부 보인다. 언제 몇 명에게 나갔는지와 눈에 띄는 점만 두세 줄로 짚어라.',
      },
    };
  }

  // draft — 검수 콘솔이 쓰는 것과 같은 후보·같은 렌더러. AI 호출 없음.
  const candidates = await loadDigestCandidates();
  if (candidates.length === 0) {
    return {
      html: null,
      meta: {
        source: 'draft', dateLabel: null, subject: null, sent: null, recipients: null, stats: null,
        note: '최근 7일 안에 다이제스트에 실을 만한 기사가 없다. 초안을 만들 수 없다고 답해라.',
      },
    };
  }
  const intro = (input.intro ?? '').trim();
  const data = buildReviewDigest(candidates, intro ? { editorIntro: intro } : {});
  return {
    html: renderDigestHtml(data),
    meta: {
      source: 'draft',
      dateLabel: data.dateLabel,
      subject: null,
      sent: null,
      recipients: null,
      stats: data.stats as unknown as Record<string, number>,
      note:
        '초안 레이아웃을 실제 발송 메일과 같은 형태로 화면에 그렸다(후보는 최근 7일, ' +
        '검수 콘솔과 같은 기준). 기사 제목을 다시 나열하지 마라 — 화면에 이미 다 있다. ' +
        '무엇을 골랐고 왜 그렇게 묶였는지, 검수에서 손볼 만한 곳은 어딘지만 짧게 써라. ' +
        '아직 발송된 것이 아니라 초안이라는 점을 반드시 밝혀라.',
    },
  };
}
