// 챗봇 질문 → DB 조회. 이 단계에서는 LLM을 쓰지 않는다.
// 질문에서 키워드·기간·범위를 규칙 기반으로 뽑아 Prisma where 절을 만들고,
// 기사 목록 + 집계(건수·매체·회사)를 함께 돌려준다.
import { prisma } from '@/lib/prisma';
import { normalizeSource } from './media';
import { isBlockedNoise } from './relevance';
import { PERIOD_LABEL, type ChatPeriod, type ChatScope, type ChatArticle, type ChatQueryResult } from './chat-types';

export type { ChatPeriod, ChatScope, ChatArticle, ChatQueryResult };

/** 기간 → pubDate 범위. 대시보드와 같은 기준(기본 최근 3개월). */
export function resolvePeriod(period: ChatPeriod): { gte: Date; lte: Date } | null {
  if (period === 'all') return null;
  const now = new Date();
  const gte = new Date(now);
  if (period === 'today') gte.setHours(0, 0, 0, 0);
  else if (period === 'week') gte.setDate(gte.getDate() - 7);
  else if (period === 'month') gte.setMonth(gte.getMonth() - 1);
  else gte.setMonth(gte.getMonth() - 3);
  return { gte, lte: now };
}

/** 검색 범위 칩 → category 조건. 아무것도 안 고르면 전체. */
function scopeWhere(scopes: ChatScope[]) {
  if (scopes.length === 0) return undefined;
  const or: any[] = [];
  for (const s of scopes) {
    if (s === 'portfolio') or.push({ category: 'portfolio_company' });
    else if (s === 'competitor') or.push({ category: 'competitor' });
    else if (s === 'sparklabs') {
      or.push({ category: 'sparklabs_self' });
      or.push({ title: { contains: '스파크랩' } });
    } else if (s === 'inter') or.push({ category: 'industry_trend' });
  }
  return or.length ? or : undefined;
}

// 질문에서 검색어를 뽑을 때 버리는 말들. 조사·시간표현·요청 표현.
const STOPWORDS = new Set([
  '기사', '뉴스', '기사만', '기사를', '기사는', '보도', '관련', '알려줘', '보여줘', '찾아줘', '정리해줘',
  '모아줘', '뽑아줘', '해줘', '있어', '있나', '알려', '어때', '뭐야', '무슨', '어떤', '어디', '누구',
  '이번', '지난', '최근', '오늘', '어제', '이번주', '지난주', '이번달', '지난달', '올해', '작년',
  '주간', '월간', '분기', '개월', '주일', '전체', '순위', '건수', '몇건', '몇', '개',
  '우리', '저희', '요즘', '지금', '현재', '그리고', '또는', '중에', '중에서', '대해', '대한', '까지',
  '부터', '보다', '으로', '에서', '한테', '에게', '하고', '이랑', '랑', '와', '과', '의', '을', '를',
  '이', '가', '은', '는', '도', '만', '좀', '다시', '전부', '모든', '것', '거', '수집', '리스트', '목록',
]);

/** 질문 문장에서 검색 키워드 후보 추출 (규칙 기반, LLM 없음) */
export function extractTerms(question: string): string[] {
  const cleaned = question.replace(/[^\p{L}\p{N}\s]/gu, ' ');
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const raw of cleaned.split(/\s+/)) {
    const w = raw.trim();
    if (w.length < 2) continue;
    if (STOPWORDS.has(w)) continue;
    // 흔한 조사 꼬리를 떼서 한 번 더 시도 ("카카오의" → "카카오")
    const stripped = w.replace(/(에서|으로|에게|한테|까지|부터|이라는|라는|의|을|를|은|는|이|가|도|만)$/u, '');
    const key = stripped.length >= 2 ? stripped : w;
    if (STOPWORDS.has(key) || seen.has(key)) continue;
    seen.add(key);
    terms.push(key);
    if (terms.length >= 5) break;
  }
  return terms;
}

export type ChatQueryInput = {
  question: string;
  period: ChatPeriod;
  scopes: ChatScope[];
  /** 의도 분석기가 뽑아준 검색어. 없으면 질문에서 규칙 기반으로 뽑는다. */
  terms?: string[];
  limit?: number;
};

export async function runChatQuery(input: ChatQueryInput): Promise<ChatQueryResult> {
  const limit = Math.min(input.limit ?? 20, 50);
  const range = resolvePeriod(input.period);
  const terms = input.terms ?? extractTerms(input.question);

  const where: any = { isNoise: false };
  if (range) where.pubDate = { gte: range.gte, lte: range.lte };

  const and: any[] = [];
  const scopeOr = scopeWhere(input.scopes);
  if (scopeOr) and.push({ OR: scopeOr });
  if (terms.length) {
    and.push({
      OR: terms.flatMap((t) => [
        { title: { contains: t, mode: 'insensitive' } },
        { matchedKeyword: { contains: t, mode: 'insensitive' } },
      ]),
    });
  }
  if (and.length) where.AND = and;

  // 집계용으로 넉넉히 가져와 서버에서 세고(매체명 정규화·노이즈 재검사가 필요해서),
  // 화면에는 limit 만큼만 보낸다.
  const [rows, total] = await Promise.all([
    prisma.article.findMany({
      where,
      orderBy: [{ pubDate: 'desc' }],
      take: 1000,
      select: {
        id: true,
        title: true,
        link: true,
        source: true,
        pubDate: true,
        category: true,
        matchedKeyword: true,
        tone: true,
        riskFlag: true,
        priorityScore: true,
      },
    }),
    prisma.article.count({ where }),
  ]);

  const clean = rows.filter((a) => !isBlockedNoise(a));

  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  const cat = new Map<string, number>();
  const src = new Map<string, number>();
  const comp = new Map<string, number>();
  let negativeCount = 0;
  for (const a of clean) {
    bump(cat, a.category);
    bump(src, normalizeSource(a.source));
    if (a.matchedKeyword) bump(comp, a.matchedKeyword);
    if (a.tone === 'NEGATIVE') negativeCount++;
  }
  const top = (m: Map<string, number>, n: number) =>
    [...m.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([name, count]) => ({ name, count }));

  const articles = clean
    .slice()
    .sort((a, b) => b.priorityScore - a.priorityScore || +b.pubDate - +a.pubDate)
    .slice(0, limit)
    .map((a) => ({
      id: a.id,
      title: a.title,
      link: a.link,
      source: normalizeSource(a.source),
      pubDate: a.pubDate.toISOString(),
      category: a.category,
      matchedKeyword: a.matchedKeyword,
      tone: a.tone,
      riskFlag: a.riskFlag,
    }));

  return {
    terms,
    periodLabel: PERIOD_LABEL[input.period],
    // 1000건 상한에 걸리지 않았으면 정제 후 개수가 더 정확하다.
    total: rows.length < 1000 ? clean.length : total,
    byCategory: [...cat.entries()].sort((a, b) => b[1] - a[1]).map(([category, count]) => ({ category, count })),
    topSources: top(src, 5),
    topCompanies: top(comp, 5),
    negativeCount,
    articles,
  };
}
