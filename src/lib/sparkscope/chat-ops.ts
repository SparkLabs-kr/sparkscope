// 본부 업무용 조회 — 기사 검색이 아니라 "그래서 뭘 해야 하나"에 답하는 데이터.
//
// 전부 DB에 이미 있는데 챗봇이 한 번도 안 보던 것들이다:
//   - pitchScore: 수집 때 기사마다 매겨둔 기획기사 피칭 가능성 (27,809건에 있음)
//   - MonitoringTarget: 감시 대상 명단 530곳 — "기사가 안 난 곳"은 이게 있어야 알 수 있다
//   - Digest: 실제로 나간 다이제스트 아카이브
import { prisma } from '@/lib/prisma';
import { normalizeSource } from './media';
import { resolvePeriod, dedupeArticles } from './chat-query';
import { categoryLabel } from './chat-types';
import type { ChatPeriod, ChatScope, ChatQueryResult } from './chat-types';

const SCOPE_CATEGORY: Record<ChatScope, string> = {
  portfolio: 'portfolio_company',
  competitor: 'competitor',
  sparklabs: 'sparklabs_self',
  industry: 'industry_trend',
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
      tone: a.tone,
      riskFlag: a.riskFlag,
      // 피칭 화면에선 "왜 이게 소재가 되는지"가 한 줄 요약보다 중요하다.
      oneLiner: a.pitchTopic ? `[${a.pitchScore}점] ${a.pitchTopic}` : a.oneLiner,
      importance: a.importance,
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
