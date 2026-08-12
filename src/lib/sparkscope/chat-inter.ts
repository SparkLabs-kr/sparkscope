// 해외 트렌드(Inter) 조회 — 챗봇이 InterNews를 볼 수 있게 한다.
//
// 여태 챗봇은 Article 테이블 하나만 봤다. 그래서 화면의 "해외 트렌드" 칩이 실제로는
// 국내 기사 중 industry_trend(업계동향)를 검색했고, 진짜 해외 데이터 3,270건은
// 옆에 그대로 있는데 한 번도 안 나왔다.
//
// 결과 모양은 ChatQueryResult에 맞춘다 — 화면 카드가 국내/해외를 구분하지 않아도 되도록.
// 다만 담기는 내용이 다르다:
//   분류    → 도메인(바이오/AI)
//   회사    → 이 기사에 엮인 포트폴리오사(InterPortfolioMatch)
//   매체    → TechCrunch, Wired 같은 해외 매체
import { prisma } from '@/lib/prisma';
import { PERIOD_LABEL } from './chat-types';
import type { ChatPeriod, ChatQueryResult } from './chat-types';
import { resolvePeriod, previousRange, dedupeArticles } from './chat-query';

export type InterInput = {
  period: ChatPeriod;
  /** 'bio' | 'ai' — 안 주면 둘 다 */
  domain?: string | null;
  /** 'us' | 'cn' | 'jp' | 'sa' | 'in' | 'other' */
  country?: string | null;
  /** 투자·딜 / 규제·승인 / 연구성과 / 제품·상용화 / 시장·인물 */
  eventType?: string | null;
  /** 신약발굴, 생성형AI·콘텐츠 같은 주제 섹터 */
  topicSector?: string | null;
  /** 포트폴리오사와 엮인 기사만 볼지 */
  portfolioOnly?: boolean;
  /** 특정 포트폴리오사와 엮인 기사만 */
  company?: string | null;
  limit?: number;
};

const DOMAIN_LABEL: Record<string, string> = { bio: '바이오', ai: 'AI' };
export const COUNTRY_LABEL: Record<string, string> = {
  us: '미국', cn: '중국', jp: '일본', sa: '사우디', in: '인도', other: '기타',
};

function buildWhere(input: InterInput, range: { gte: Date; lte: Date } | null) {
  const where: any = { relevant: true };
  if (input.domain) where.domain = input.domain;
  if (input.country) where.country = input.country;
  if (input.eventType) where.eventType = input.eventType;
  if (input.topicSector) where.topicSector = input.topicSector;
  if (input.company) where.matches = { some: { companyName: { contains: input.company, mode: 'insensitive' } } };
  else if (input.portfolioOnly) where.matches = { some: {} };
  // 발행일 기준으로 자른다(수집 시각이 아니라). 국내 기사 조회와 같은 기준.
  if (range) where.news = { publishedAt: { gte: range.gte, lte: range.lte } };
  return where;
}

export type InterOutcome = {
  /** 화면 카드용 — 국내 조회와 같은 모양 */
  result: ChatQueryResult;
  /** 모델에게 흐름을 읽히기 위한 축별 집계 (화면에는 안 쓴다) */
  facets: {
    byTopic: { name: string; count: number }[];
    byEventType: { name: string; count: number }[];
    byCountry: { name: string; count: number }[];
  };
};

export async function runInterQuery(input: InterInput): Promise<InterOutcome> {
  const limit = Math.min(input.limit ?? 20, 50);
  const range = resolvePeriod(input.period);
  const where = buildWhere(input, range);

  const [rows, total, prevTotal] = await Promise.all([
    prisma.interNewsVerdict.findMany({
      where,
      orderBy: { news: { publishedAt: 'desc' } },
      take: 300,
      select: {
        id: true,
        titleKo: true,
        domain: true,
        country: true,
        eventType: true,
        topicSector: true,
        reason: true,
        news: { select: { title: true, url: true, source: true, publishedAt: true } },
        matches: { select: { companyName: true, reason: true } },
      },
    }),
    prisma.interNewsVerdict.count({ where }),
    range
      ? prisma.interNewsVerdict.count({ where: buildWhere(input, previousRange(range)) })
      : Promise.resolve(null),
  ]);

  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  const dom = new Map<string, number>();
  const src = new Map<string, number>();
  const comp = new Map<string, number>();
  for (const r of rows) {
    if (r.domain) bump(dom, r.domain);
    bump(src, r.news.source);
    for (const m of r.matches) bump(comp, m.companyName);
  }
  const top = (m: Map<string, number>, n: number) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([name, count]) => ({ name, count }));

  // 축별 집계 — 모델이 "무슨 흐름인지"를 말하려면 주제·사건유형·국가 분포가 필요하다.
  const facet = (key: 'topicSector' | 'eventType' | 'country') => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const v = r[key];
      if (v) bump(m, v);
    }
    return top(m, 6);
  };
  const facets = {
    byTopic: facet('topicSector'),
    byEventType: facet('eventType'),
    byCountry: facet('country').map((c) => ({ name: COUNTRY_LABEL[c.name] ?? c.name, count: c.count })),
  };

  const result: ChatQueryResult = {
    terms: [
      input.domain ? DOMAIN_LABEL[input.domain] ?? input.domain : null,
      input.topicSector,
      input.eventType,
      input.country ? COUNTRY_LABEL[input.country] ?? input.country : null,
      input.company,
      input.portfolioOnly && !input.company ? '포트폴리오사 연관' : null,
    ].filter(Boolean) as string[],
    periodLabel: PERIOD_LABEL[input.period],
    total,
    sampled: rows.length >= 300,
    prevTotal,
    deltaPct: null,
    deltaUnavailableReason: null,
    deltaCaution: null,
    byCategory: top(dom, 5).map((d) => ({ category: d.name, count: d.count })),
    topSources: top(src, 5),
    topCompanies: top(comp, 6),
    negativeCount: 0,
    riskCount: 0,
    monthly: null,
    noisyKeywords: null,
    // 같은 사건을 매체마다 다른 문구로 다룬 기사가 그대로 다 나오는 문제가 있었다
    // (예: "시온나 낭성섬유증 임상 실패" 기사가 BioPharma Dive·Endpoints News 두 곳에
    // 각각 실려 화면에 2번 뜸, 2026-08-11 발견). 국내 검색(runChatQuery)이 이미 쓰는
    // dedupeArticles를 여기도 적용한다 — limit으로 자르기 전에, 300건 전체 풀에서
    // 먼저 접어야 진짜 서로 다른 사건 수만큼 화면에 채워진다.
    articles: dedupeArticles(
      rows.map((r) => ({
        id: r.id,
        // 한국어 번역이 있으면 그걸 보여주고, 원문 제목은 아래 줄에 남긴다.
        title: r.titleKo || r.news.title,
        link: r.news.url,
        source: r.news.source,
        pubDate: r.news.publishedAt.toISOString(),
        category: r.domain ?? 'inter',
        // 이 자리는 화면에서 "회사·키워드"로 보인다 — 엮인 포폴사가 있으면 그게 제일 유용하다.
        matchedKeyword: r.matches.map((m) => m.companyName).join(', ') || r.topicSector || '해외',
        // 위 matchedKeyword가 포폴사 이름인지 주제 태그인지 구분 — 화면에서 "쿼드메디슨"이
        // 회사인지 주제인지 헷갈리는 문제가 있었다(2026-08-12).
        tagKind: (r.matches.length > 0 ? 'company' : 'topic') as 'company' | 'topic',
        tone: null as string | null,
        riskFlag: null as string | null,
        oneLiner: r.titleKo ? r.news.title : r.reason,
        importance: null as string | null,
      }))
    ).slice(0, limit),
  };

  return { result, facets };
}

/** 도구 결과에 실어 보낼 압축 형태 */
export function compactInter({ result: r, facets }: InterOutcome) {
  return {
    total: r.total,
    prevTotal: r.prevTotal,
    byDomain: r.byCategory.map((c) => ({ name: DOMAIN_LABEL[c.category] ?? c.category, count: c.count })),
    ...facets,
    portfolioLinked: r.topCompanies,
    sources: r.topSources,
    articles: r.articles.slice(0, 18).map((a) => ({
      title: a.title,
      originalTitle: a.oneLiner,
      linkedPortfolioCompanies: a.matchedKeyword,
      source: a.source,
      date: a.pubDate.slice(0, 10),
    })),
  };
}
