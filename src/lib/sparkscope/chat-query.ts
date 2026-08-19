// 챗봇 질문 → DB 조회. 이 단계에서는 LLM을 쓰지 않는다.
// 질문에서 키워드·기간·범위를 규칙 기반으로 뽑아 Prisma where 절을 만들고,
// 기사 목록 + 집계(건수·매체·회사)를 함께 돌려준다.
import { prisma } from '@/lib/prisma';
import { normalizeSource } from './media';
import { isBlockedNoise } from './relevance';
import { expandTerms } from './term-expand';
import { PERIOD_LABEL, categoryLabel, type ChatPeriod, type ChatScope, type ChatArticle, type ChatQueryResult, type NoisyKeyword } from './chat-types';

export type { ChatPeriod, ChatScope, ChatArticle, ChatQueryResult };

// 카테고리별 데이터 시작일(가장 오래된 pubDate) 캐시.
//
// 백필 범위가 카테고리마다 다르다. 스파크랩·포트폴리오사는 2023년치까지 백필돼 있지만,
// 경쟁사·업계동향은 정기 수집을 시작한 2026-05부터만 있다. 그래서 "직전 3개월 대비"를
// 그냥 계산하면 업계동향이 0건이던 구간과 비교돼 +4403% 같은 숫자가 나온다.
// 비교 가능 여부는 이 커버리지를 카테고리별로 확인해서 판단한다.
let coverageCache: { at: number; value: Map<string, Date> } | null = null;

async function getCategoryCoverage(): Promise<Map<string, Date>> {
  const now = Date.now();
  if (coverageCache && now - coverageCache.at < 60 * 60 * 1000) return coverageCache.value;
  const rows = await prisma.article.groupBy({
    by: ['category'],
    where: { isNoise: false },
    _min: { pubDate: true },
  });
  const value = new Map<string, Date>();
  for (const r of rows) if (r._min.pubDate) value.set(r.category, r._min.pubDate);
  coverageCache = { at: now, value };
  return value;
}

/**
 * 카테고리별 수집 시작일 + 연도별 건수.
 * 에이전트가 "이 숫자를 믿어도 되나"를 스스로 판단할 수 있게 노출한다.
 * (2026-05 이전은 백필 구간이라 스파크랩·포폴사만 있고 밀도도 훨씬 낮다)
 */
export async function getCoverageSummary() {
  const [coverage, yearly] = await Promise.all([
    getCategoryCoverage(),
    prisma.$queryRawUnsafe<{ y: number; c: number }[]>(
      `SELECT date_part('year',"pubDate")::int y, count(*)::int c
       FROM "Article" WHERE "isNoise"=false GROUP BY 1 ORDER BY 1`
    ),
  ]);
  return {
    categories: [...coverage.entries()]
      .map(([category, from]) => ({ category: categoryLabel(category), collectedFrom: fmtYmd(from) }))
      .sort((a, b) => a.collectedFrom.localeCompare(b.collectedFrom)),
    byYear: yearly.map((r) => ({ year: r.y, count: Number(r.c) })),
    note: '2026.05 이전은 나중에 소급 수집한 백필 구간이라 스파크랩·포트폴리오사만 있고 밀도가 훨씬 낮다. 그 구간과의 증감 비교는 신뢰할 수 없다.',
  };
}

/** 직전 같은 길이 기간. "지난주 대비" 같은 비교에 쓴다. */
export function previousRange(range: { gte: Date; lte: Date }): { gte: Date; lte: Date } {
  const span = range.lte.getTime() - range.gte.getTime();
  return { gte: new Date(range.gte.getTime() - span), lte: new Date(range.gte.getTime()) };
}

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

/**
 * 같은 사안을 여러 매체가 받아쓴 기사를 하나로 접는다.
 *
 * 통신사 기사를 그대로 받는 매체가 많아 "엔씽, 국가기관·대기업·교육까지 전방위 수주"와
 * "엔씽, 국가기관·대기업·교육 현장 잇단 수주…"처럼 제목만 조금 다른 기사가 6~7건씩 쌓인다.
 * 그대로 두면 목록 상위가 같은 기사로 도배되고 회사·매체 집계도 부풀어 보인다.
 *
 * 판정: 구두점·공백을 뗀 제목의 앞 10글자가 같으면 같은 사안으로 본다.
 * 한국어 기사 제목은 앞부분에 "회사명 + 핵심 동사"가 오므로 이 정도면 거의 맞는다.
 */
export function dedupeArticles<T extends { title: string; priorityScore?: number }>(rows: T[]): T[] {
  const seen = new Map<string, T>();
  for (const r of rows) {
    const key = r.title.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 10);
    if (!key) continue;
    const prev = seen.get(key);
    // 같은 사안이면 우선순위가 높은 쪽을 남긴다(먼저 온 순서를 유지).
    if (!prev || (r.priorityScore ?? 0) > (prev.priorityScore ?? 0)) seen.set(key, r);
  }
  // 원래 정렬 순서를 지키기 위해 입력 순서대로 다시 뽑는다.
  const kept = new Set(seen.values());
  return rows.filter((r) => kept.has(r));
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
    } else if (s === 'industry') or.push({ category: 'industry_trend' });
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
  /** 위기·이슈 질문 — 부정 톤/위험 플래그 기사만 본다 */
  onlyNegative?: boolean;
  /** 긍정 톤만 본다 */
  onlyPositive?: boolean;
  /** 지표·추이 질문 — 월별 추이를 같이 뽑는다 */
  withTrend?: boolean;
  /** 키워드·노이즈 질문 — 오탐 많은 키워드를 같이 뽑는다 */
  withNoise?: boolean;
  /** 의도 분석기가 뽑아준 검색어. 없으면 질문에서 규칙 기반으로 뽑는다. */
  terms?: string[];
  limit?: number;
  /**
   * "8월 3일부터 19일까지"처럼 사용자가 명시한 절대 날짜 범위(YYYY-MM-DD).
   * 있으면 period(today/week/month/quarter/all) 대신 이 범위를 그대로 쓴다 — period는
   * 고정된 다섯 구간뿐이라 임의 날짜 범위를 표현할 수 없다(2026-08-19 발견: "8/3부터
   * 19까지 다 뽑아줘"를 못 받아서 quarter/all로 엉뚱하게 넓혀 답했다).
   */
  dateFrom?: string;
  dateTo?: string;
};

function fmtYmd(d: Date) {
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

/** dateFrom/dateTo(YYYY-MM-DD)를 하루 끝까지 포함하는 범위로. 잘못된 날짜면 null. */
function resolveCustomRange(dateFrom?: string, dateTo?: string): { gte: Date; lte: Date } | null {
  if (!dateFrom && !dateTo) return null;
  const gte = dateFrom ? new Date(`${dateFrom}T00:00:00`) : new Date(0);
  const lte = dateTo ? new Date(`${dateTo}T23:59:59.999`) : new Date();
  if (Number.isNaN(+gte) || Number.isNaN(+lte)) return null;
  return { gte, lte };
}

export async function runChatQuery(input: ChatQueryInput): Promise<ChatQueryResult> {
  const limit = Math.min(input.limit ?? 20, 50);
  const customRange = resolveCustomRange(input.dateFrom, input.dateTo);
  const range = customRange ?? resolvePeriod(input.period);
  const terms = input.terms ?? extractTerms(input.question);

  const where: any = { isNoise: false };
  if (range) where.pubDate = { gte: range.gte, lte: range.lte };

  const and: any[] = [];
  const scopeOr = scopeWhere(input.scopes);
  if (scopeOr) and.push({ OR: scopeOr });
  // 검색어가 감시 대상 이름과 정확히 일치하면("온도"·"피치스"처럼 흔한 단어인데 실제로는
  // 회사명) 챗봇이 스파크랩 내부 도구라는 걸 우선한다 — 회사 얘기로 보고 matchedKeyword
  // 정확 매칭만 쓴다. 아울러 현재 투자 상태(portfolioStatus: Live/Exit/Written-off)를
  // 같이 실어서, 폐업(Written-off)한 곳인데 최근 보도가 없는 걸 "오류"가 아니라 "그럴 만한
  // 이유가 있다"고 설명할 수 있게 한다(2026-08-13 실사용 요청).
  let matchedEntities: { name: string; category: string; portfolioStatus: string | null }[] = [];
  if (terms.length) {
    const knownTargets = await prisma.monitoringTarget.findMany({
      where: { OR: [{ primaryKeyword: { in: terms } }, { name: { in: terms } }] },
      select: { primaryKeyword: true, name: true, category: true, portfolioStatus: true },
    });
    matchedEntities = knownTargets.map((t) => ({ name: t.name, category: t.category, portfolioStatus: t.portfolioStatus }));
    const knownNames = new Set<string>();
    for (const t of knownTargets) {
      knownNames.add(t.primaryKeyword.toLowerCase());
      knownNames.add(t.name.toLowerCase());
    }
    const entityTerms = terms.filter((t) => knownNames.has(t.toLowerCase()));
    const freeTerms = terms.filter((t) => !knownNames.has(t.toLowerCase()));

    // 표기 변형까지 펼쳐서 찾는다("투자유치"만 찾으면 "투자 유치" 1,200여 건을 통째로 놓친다).
    // 제목뿐 아니라 수집 때 뽑아둔 한 줄 요약(oneLiner, 90% 채워져 있음)과 등장 회사
    // 목록(relatedCompanies)까지 본다 — 제목에 안 드러난 내용이 여기 담겨 있다.
    const orClauses: any[] = entityTerms.map((t) => ({ matchedKeyword: { contains: t, mode: 'insensitive' } }));
    if (freeTerms.length) {
      const variants = expandTerms(freeTerms);
      orClauses.push(
        ...variants.flatMap((t) => [
          { title: { contains: t, mode: 'insensitive' } },
          { oneLiner: { contains: t, mode: 'insensitive' } },
          { matchedKeyword: { contains: t, mode: 'insensitive' } },
          { relatedCompanies: { contains: t, mode: 'insensitive' } },
        ])
      );
    }
    and.push({ OR: orClauses });
  }
  // 위기·이슈: 부정 톤이거나 위험 플래그가 달린 기사만
  if (input.onlyNegative) {
    and.push({ OR: [{ tone: 'NEGATIVE' }, { riskFlag: { not: null } }] });
  }
  // 긍정 톤만
  if (input.onlyPositive) {
    and.push({ tone: 'POSITIVE' });
  }
  if (and.length) where.AND = and;

  // 집계용으로 넉넉히 가져와 서버에서 세고(매체명 정규화·노이즈 재검사가 필요해서),
  // 화면에는 limit 만큼만 보낸다.
  const prevRange = range ? previousRange(range) : null;
  // 직전 기간 where — 기간 조건만 바꾼 같은 조건
  const prevWhere = prevRange ? { ...where, pubDate: prevRange } : null;

  const [rows, total, prevTotal] = await Promise.all([
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
        // 수집 때 기사별로 뽑아둔 AI 한 줄 요약 — 제목만으로는 안 보이는 내용이 담겨 있어
        // 검색 대상이자 답변 근거로 쓴다.
        oneLiner: true,
        importance: true,
      },
    }),
    prisma.article.count({ where }),
    prevWhere ? prisma.article.count({ where: prevWhere }) : Promise.resolve(null),
  ]);

  // 글로벌 노이즈 필터 (스포츠, 정치, 광고 등)
  let clean = rows.filter((a) => !isBlockedNoise(a));

  // matchedKeyword별 contextWords/excludeWords 필터 적용
  const targets = await prisma.monitoringTarget.findMany({
    where: { OR: [{ primaryKeyword: { in: [...new Set(clean.map((a) => a.matchedKeyword).filter(Boolean))] } }] },
    select: { primaryKeyword: true, contextWords: true, excludeWords: true },
  });
  const settingsMap = new Map<string, { contextWords: string | null; excludeWords: string | null }>();
  for (const t of targets) {
    settingsMap.set(t.primaryKeyword, { contextWords: t.contextWords, excludeWords: t.excludeWords });
  }

  clean = clean.filter((a) => {
    if (!a.matchedKeyword) return true;
    const settings = settingsMap.get(a.matchedKeyword);
    if (!settings) return true;

    const title = a.title?.toLowerCase() ?? '';
    // excludeWords: 제목에 이 단어 중 하나라도 있으면 제외
    if (settings.excludeWords) {
      const excludes = settings.excludeWords.split(',').map((w) => w.trim().toLowerCase()).filter(Boolean);
      if (excludes.some((w) => title.includes(w))) return false;
    }
    // contextWords: 제목에 이 단어 중 하나라도 있어야 통과 (없으면 true = 통과)
    if (settings.contextWords) {
      const contexts = settings.contextWords.split(',').map((w) => w.trim().toLowerCase()).filter(Boolean);
      if (contexts.length > 0 && !contexts.some((w) => title.includes(w))) return false;
    }
    return true;
  });

  // 직전 기간과 비교해도 되는지 — 이번 결과에 10% 이상 기여한 카테고리 중
  // 직전 구간에 데이터가 아예 없던 것(백필 미포함)이 있으면 비교를 막는다.
  let deltaUnavailableReason: string | null = null;
  let deltaCaution: string | null = null;
  if (prevRange && clean.length > 0) {
    const coverage = await getCategoryCoverage();
    // 정기 수집 시작일 = 가장 늦게 커버리지가 생긴 카테고리 기준.
    // 그 이전 구간은 백필로 채운 데이터라 지금보다 성기다(회사·매체 커버리지가 좁다).
    const regularStart = [...coverage.values()].sort((a, b) => +b - +a)[0];
    const share = new Map<string, number>();
    for (const a of clean) share.set(a.category, (share.get(a.category) ?? 0) + 1);
    const uncovered: string[] = [];
    for (const [cat, n] of share) {
      if (n / clean.length < 0.1) continue; // 비중 낮은 카테고리는 무시
      const from = coverage.get(cat);
      if (from && from > prevRange.gte) uncovered.push(`${categoryLabel(cat)}(${fmtYmd(from)}부터 수집)`);
    }
    if (uncovered.length) {
      deltaUnavailableReason = `${uncovered.join(', ')} 기사는 직전 기간(${fmtYmd(prevRange.gte)}~${fmtYmd(prevRange.lte)})에 수집 전이라 증감 비교가 정확하지 않아요`;
    } else if (regularStart && prevRange.gte < regularStart) {
      deltaCaution = `직전 기간은 정기 수집(${fmtYmd(regularStart)}) 이전이라 백필 데이터로만 채워져 있어요. 직전 건수가 실제보다 적게 잡혀 있습니다`;
    }
  }

  // 추이 — "이번 주"·"오늘"처럼 짧은 기간을 고른 질문은 월 단위로 묶으면 점이 1~2개뿐이라
  // 의미가 없다. 이때는 최근 14일을 일 단위로 쪼개고(날짜별 막대), 그 외(월/분기/전체)는
  // 기존처럼 최근 6개월을 월 단위로 묶는다(선그래프) — 화면 쪽에서 trendGranularity로 구분해
  // 그린다(2026-08-12).
  let monthly: { month: string; count: number }[] | null = null;
  let trendGranularity: 'day' | 'month' = 'month';
  if (input.withTrend) {
    const now = new Date();
    if (input.period === 'today' || input.period === 'week') {
      trendGranularity = 'day';
      const buckets: { month: string; gte: Date; lt: Date }[] = [];
      for (let i = 13; i >= 0; i--) {
        const gte = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
        const lt = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i + 1);
        buckets.push({ month: `${String(gte.getMonth() + 1).padStart(2, '0')}-${String(gte.getDate()).padStart(2, '0')}`, gte, lt });
      }
      const counts = await Promise.all(
        buckets.map((b) => prisma.article.count({ where: { ...where, pubDate: { gte: b.gte, lt: b.lt } } }))
      );
      monthly = buckets.map((b, i) => ({ month: b.month, count: counts[i] }));
    } else {
      // 월별로 count를 따로 센다. findMany로 가져와 세면 take 상한에 걸려 숫자가 잘린다.
      const buckets: { month: string; gte: Date; lt: Date }[] = [];
      for (let i = 5; i >= 0; i--) {
        const gte = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const lt = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
        buckets.push({ month: `${gte.getFullYear()}-${String(gte.getMonth() + 1).padStart(2, '0')}`, gte, lt });
      }
      const counts = await Promise.all(
        buckets.map((b) => prisma.article.count({ where: { ...where, pubDate: { gte: b.gte, lt: b.lt } } }))
      );
      monthly = buckets.map((b, i) => ({ month: b.month, count: counts[i] }));
    }
  }

  // 오탐 많은 키워드 — 같은 기간에서 isNoise=true인 기사를 키워드별로 센다.
  let noisyKeywords: NoisyKeyword[] | null = null;
  if (input.withNoise) {
    const noiseWhere: any = { isNoise: true };
    if (range) noiseWhere.pubDate = { gte: range.gte, lte: range.lte };
    const [noiseRows, keptRows] = await Promise.all([
      prisma.article.groupBy({
        by: ['matchedKeyword'],
        where: noiseWhere,
        _count: { _all: true },
        orderBy: { _count: { matchedKeyword: 'desc' } },
        take: 10,
      }),
      prisma.article.groupBy({
        by: ['matchedKeyword'],
        where: { ...(range ? { pubDate: { gte: range.gte, lte: range.lte } } : {}), isNoise: false },
        _count: { _all: true },
      }),
    ]);
    const keptMap = new Map(keptRows.map((r) => [r.matchedKeyword, r._count._all]));

    // 감시대상의 수집 상태를 함께 싣는다.
    // 멈춰 있는(PAUSED) 대상은 설정을 고쳐도 효과가 없는데, 오탐 건수만 보면 제일 심해 보여서
    // 거기부터 손대려다 헛걸음을 한다(캐스팅: 오탐 120건인데 PAUSED라 손댈 수 없음).
    const names = noiseRows.map((r) => r.matchedKeyword);
    const targets = await prisma.monitoringTarget.findMany({
      where: { OR: [{ primaryKeyword: { in: names } }, { name: { in: names } }] },
      select: { name: true, primaryKeyword: true, status: true, contextWords: true, excludeWords: true },
    });
    const statusOf = new Map<string, string>();
    // 현재 설정도 같이 준다 — 이미 들어 있는 단어를 또 제안하지 않도록.
    const settingsOf = new Map<string, { contextWords: string | null; excludeWords: string | null }>();
    for (const t of targets) {
      for (const key of [t.primaryKeyword, t.name]) {
        statusOf.set(key, t.status);
        settingsOf.set(key, { contextWords: t.contextWords, excludeWords: t.excludeWords });
      }
    }

    // 오탐 "예시 제목"을 함께 준다.
    //
    // 건수만 주면 모델이 무엇 때문에 오탐이 나는지 상상해서 엉뚱한 제외어를 제안한다.
    // (실제 사고: 리코의 오탐은 '푸에르토리코'·'하야시다 리코'·야구 기사인데,
    //  모델이 건수만 보고 "음식, 커피, 쿠키, 리테일"을 제외하자고 했다)
    const samplesByKeyword = new Map<string, string[]>();
    await Promise.all(
      names.map(async (kw) => {
        const rows = await prisma.article.findMany({
          where: { ...noiseWhere, matchedKeyword: kw },
          orderBy: { pubDate: 'desc' },
          take: 6,
          select: { title: true },
        });
        samplesByKeyword.set(kw, rows.map((r) => r.title));
      })
    );

    noisyKeywords = noiseRows.map((r) => ({
      name: r.matchedKeyword,
      noise: r._count._all,
      kept: keptMap.get(r.matchedKeyword) ?? 0,
      // 명단에 없는 키워드도 있다(수집 규칙이 바뀌기 전에 쌓인 것).
      status: statusOf.get(r.matchedKeyword) ?? 'UNKNOWN',
      samples: samplesByKeyword.get(r.matchedKeyword) ?? [],
      current: settingsOf.get(r.matchedKeyword) ?? null,
    }));
  }

  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  const cat = new Map<string, number>();
  const src = new Map<string, number>();
  const comp = new Map<string, number>();
  let negativeCount = 0;
  let positiveCount = 0;
  let neutralCount = 0;
  let riskCount = 0;
  for (const a of clean) {
    if (a.riskFlag) riskCount++;
    bump(cat, a.category);
    bump(src, normalizeSource(a.source));
    if (a.matchedKeyword) bump(comp, a.matchedKeyword);
    if (a.tone === 'NEGATIVE') negativeCount++;
    else if (a.tone === 'POSITIVE') positiveCount++;
    else neutralCount++;
  }
  const top = (m: Map<string, number>, n: number) =>
    [...m.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([name, count]) => ({ name, count }));

  // 화면에 뿌릴 목록에서만 중복을 접는다. total은 실제 건수 그대로 둔다
  // (같은 사안이 여러 매체에 실린 것도 보도량이므로 집계에서 빼면 다른 수치와 어긋난다).
  const articles = dedupeArticles(
    clean.slice().sort((a, b) => b.priorityScore - a.priorityScore || +b.pubDate - +a.pubDate)
  )
    .slice(0, limit)
    .map((a) => ({
      id: a.id,
      title: a.title,
      link: a.link,
      source: normalizeSource(a.source),
      pubDate: a.pubDate.toISOString(),
      category: a.category,
      matchedKeyword: a.matchedKeyword,
      // 국내 검색은 항상 회사·감시대상 키워드 매칭이라 'topic'으로 갈 일이 없다(해외
      // 트렌드만 회사 매칭이 없으면 주제 태그로 대체됨).
      tagKind: 'company' as const,
      tone: a.tone,
      riskFlag: a.riskFlag,
      oneLiner: a.oneLiner,
      importance: a.importance,
    }));

  return {
    terms,
    periodLabel: customRange ? `${fmtYmd(customRange.gte)}~${fmtYmd(customRange.lte)}` : PERIOD_LABEL[input.period],
    // 1000건 상한에 걸리지 않았으면 정제 후 개수가 더 정확하다.
    total: rows.length < 1000 ? clean.length : total,
    // 1000건 상한에 걸리면 아래 분류·키워드·매체 집계는 최신 1000건 표본 기준이다.
    sampled: rows.length >= 1000,
    prevTotal,
    deltaUnavailableReason,
    deltaCaution,
    // 증감률은 양쪽 다 '정제 전 raw 건수'로 계산한다 — 이번 기간만 정제하고 비교하면
    // 줄어든 것처럼 왜곡된다. 직전이 0건이면 %가 의미 없어 null.
    deltaPct:
      prevTotal && prevTotal > 0 && !deltaUnavailableReason
        ? Math.round(((total - prevTotal) / prevTotal) * 100)
        : null,
    byCategory: [...cat.entries()].sort((a, b) => b[1] - a[1]).map(([category, count]) => ({ category, count })),
    topSources: top(src, 5),
    topCompanies: top(comp, 5),
    negativeCount,
    positiveCount,
    neutralCount,
    riskCount,
    monthly,
    trendGranularity: input.withTrend ? trendGranularity : undefined,
    noisyKeywords,
    articles,
    matchedEntities: matchedEntities.length ? matchedEntities : undefined,
  };
}
