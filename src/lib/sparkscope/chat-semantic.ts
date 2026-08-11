// 의미 검색 — 글자가 아니라 뜻으로 기사를 찾는다.
//
// 키워드 검색(chat-query.ts)은 제목에 그 글자가 있어야 잡힌다. "돈 잘 굴러가는 포폴사"에
// 해당하는 제목은 세상에 없으므로 원리적으로 못 찾는다. 여기서는 질문을 임베딩해서
// 기사 임베딩과 코사인 거리로 가까운 것을 찾는다.
//
// 결과 모양(ChatQueryResult)은 키워드 검색과 똑같이 맞춘다 — 화면 카드가 둘을 구분하지
// 않아도 되도록.
import { prisma } from '@/lib/prisma';
import { normalizeSource } from './media';
import { isBlockedNoise } from './relevance';
import { embedOne, toVectorLiteral } from './embedding';
import { resolvePeriod, previousRange, dedupeArticles } from './chat-query';
import { PERIOD_LABEL, categoryLabel } from './chat-types';
import type { ChatPeriod, ChatScope, ChatQueryResult } from './chat-types';

/** 검색 범위 → category 목록. 비우면 전체. */
function scopeCategories(scopes: ChatScope[]): string[] | null {
  if (!scopes.length) return null;
  const out: string[] = [];
  for (const s of scopes) {
    if (s === 'portfolio') out.push('portfolio_company');
    else if (s === 'competitor') out.push('competitor');
    else if (s === 'sparklabs') out.push('sparklabs_self');
    else if (s === 'industry') out.push('industry_trend');
  }
  return out.length ? out : null;
}

type Row = {
  id: string;
  title: string;
  link: string;
  source: string;
  pubDate: Date;
  category: string;
  matchedKeyword: string;
  tone: string | null;
  riskFlag: string | null;
  oneLiner: string | null;
  importance: string | null;
  priorityScore: number;
  score: number;
};

export type SemanticInput = {
  /** 찾고 싶은 내용을 문장으로. 키워드가 아니라 뜻을 적는다. */
  meaning: string;
  period: ChatPeriod;
  scopes: ChatScope[];
  onlyNegative?: boolean;
  /** 화면에 보여줄 기사 수 */
  limit?: number;
  /**
   * 1등과의 유사도 차이 허용폭. 1등 점수에서 이만큼 안에 드는 기사만 남긴다.
   *
   * 절대 기준값(예: 0.35 이상)을 쓰지 않는 이유: 짧은 한국어 제목은 점수가 촘촘하게
   * 뭉쳐서(실측 1등 0.469 / 100등 0.325) 질문마다 적정 컷이 달라진다. 고정값을 두면
   * 어떤 질문엔 다 통과하고 어떤 질문엔 다 잘린다. 1등 기준 상대값이 훨씬 안정적이다.
   */
  scoreMargin?: number;
  /** 후보로 훑을 기사 수 */
  pool?: number;
};

/** 벡터 검색은 관련이 없어도 "가장 가까운 것"을 늘 돌려준다. 이 밑은 무조건 버린다. */
const ABSOLUTE_FLOOR = 0.25;
/** 상대 컷이 너무 많이 잘라냈을 때 최소한 남겨줄 건수 */
const MIN_KEEP = 8;

export async function runSemanticQuery(input: SemanticInput): Promise<ChatQueryResult> {
  const limit = Math.min(input.limit ?? 20, 50);
  const pool = Math.min(input.pool ?? 300, 1000);
  const margin = input.scoreMargin ?? 0.07;
  const range = resolvePeriod(input.period);
  const cats = scopeCategories(input.scopes);

  const vec = toVectorLiteral(await embedOne(input.meaning));

  const conds = [`a."isNoise" = false`];
  if (range) conds.push(`a."pubDate" >= $2 AND a."pubDate" <= $3`);
  if (cats) conds.push(`a.category = ANY($${range ? 4 : 2}::text[])`);
  if (input.onlyNegative) conds.push(`(a.tone = 'NEGATIVE' OR a."riskFlag" IS NOT NULL)`);

  const params: any[] = [vec];
  if (range) params.push(range.gte, range.lte);
  if (cats) params.push(cats);

  const select = `SELECT a.id, a.title, a.link, a.source, a."pubDate", a.category, a."matchedKeyword",
            a.tone, a."riskFlag", a."oneLiner", a.importance, a."priorityScore",
            1 - (e.embedding <=> $1::vector) AS score
     FROM "ArticleEmbedding" e
     JOIN "Article" a ON a.id = e."articleId"
     WHERE ${conds.join(' AND ')}
     ORDER BY e.embedding <=> $1::vector
     LIMIT ${pool}`;

  const prev = range ? previousRange(range) : null;
  const prevParams: any[] = prev ? [vec, prev.gte, prev.lte, ...(cats ? [cats] : [])] : [];
  const prevSelect = `SELECT 1 - (e.embedding <=> $1::vector) AS score
     FROM "ArticleEmbedding" e JOIN "Article" a ON a.id = e."articleId"
     WHERE a."isNoise" = false AND a."pubDate" >= $2 AND a."pubDate" <= $3
       ${cats ? `AND a.category = ANY($4::text[])` : ''}
       ${input.onlyNegative ? `AND (a.tone = 'NEGATIVE' OR a."riskFlag" IS NOT NULL)` : ''}
     ORDER BY e.embedding <=> $1::vector
     LIMIT ${pool}`;

  // HNSW는 필터를 나중에 적용하므로(post-filter) 기간·범위가 좁으면 후보가 모자란다.
  // ef_search를 pool보다 크게 잡아 넉넉히 훑게 한다.
  // SET LOCAL은 트랜잭션 안에서만 유효하므로 조회와 같은 트랜잭션에 묶어야 한다.
  const ef = Math.max(pool + 100, 200);
  const [, rows, prevRows] = (await prisma.$transaction([
    prisma.$executeRawUnsafe(`SET LOCAL hnsw.ef_search = ${ef}`),
    prisma.$queryRawUnsafe<Row[]>(select, ...params),
    prisma.$queryRawUnsafe<{ score: number }[]>(prev ? prevSelect : `SELECT 0::float AS score WHERE false`, ...prevParams),
  ])) as [unknown, Row[], { score: number }[]];

  // 1등 점수 기준으로 컷을 정하고, 같은 사안을 받아쓴 중복 기사를 접는다.
  const cut = rows.length ? Math.max(ABSOLUTE_FLOOR, rows[0].score - margin) : ABSOLUTE_FLOOR;
  const usable = rows.filter((r) => !isBlockedNoise(r) && r.score >= ABSOLUTE_FLOOR);
  let clean = dedupeArticles(usable.filter((r) => r.score >= cut));
  // 범위·톤 필터가 좁으면 후보 자체가 몇 건 안 남아, 1등 기준 컷이 나머지를 다 잘라낸다
  // (부정 톤만 보는 질문에서 1건만 나오던 문제). 이럴 땐 컷을 풀고 상위 몇 건은 남긴다.
  if (clean.length < MIN_KEEP) clean = dedupeArticles(usable).slice(0, MIN_KEEP);
  // 직전 같은 기간에 같은 뜻의 기사가 몇 건이었는지 — 같은 컷을 적용해야 비교가 된다.
  const prevTotal = prev ? prevRows.filter((r) => r.score >= cut).length : null;

  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  const cat = new Map<string, number>();
  const src = new Map<string, number>();
  const comp = new Map<string, number>();
  let negativeCount = 0;
  let riskCount = 0;
  for (const a of clean) {
    if (a.riskFlag) riskCount++;
    bump(cat, a.category);
    bump(src, normalizeSource(a.source));
    if (a.matchedKeyword) bump(comp, a.matchedKeyword);
    if (a.tone === 'NEGATIVE') negativeCount++;
  }
  const top = (m: Map<string, number>, n: number) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([name, count]) => ({ name, count }));

  return {
    // 화면에는 "무슨 뜻으로 찾았는지"를 보여준다(키워드가 아니므로).
    terms: [input.meaning],
    periodLabel: PERIOD_LABEL[input.period],
    // 벡터 검색은 후보 pool 안에서만 세므로 total은 "찾아낸 관련 기사 수"다.
    total: clean.length,
    sampled: rows.length >= pool,
    prevTotal,
    deltaPct: null,
    deltaUnavailableReason: null,
    deltaCaution: null,
    byCategory: [...cat.entries()].sort((a, b) => b[1] - a[1]).map(([category, count]) => ({ category, count })),
    topSources: top(src, 5),
    topCompanies: top(comp, 5),
    negativeCount,
    riskCount,
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
      oneLiner: a.oneLiner,
      importance: a.importance,
    })),
  };
}

/** 도구 결과 설명용 — 어떤 분류가 얼마나 잡혔는지 한 줄로 */
export const describeCategories = (r: ChatQueryResult) =>
  r.byCategory.map((c) => `${categoryLabel(c.category)} ${c.count}`).join(', ');
