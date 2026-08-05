/**
 * 대시보드 AI 요약 사전계산 — 위기 원인 / 경쟁사 트렌드.
 *
 * 배경: 예전엔 대시보드 렌더링(force-dynamic) 시점에 매번 LLM을 호출해서, 탭을 클릭할 때마다
 * 최대 20번 가까이 AI 호출이 다시 일어나 느렸다. 이제 daily-collect 크론 끝에서 하루 1회
 * 미리 계산해 DashboardInsight 테이블에 저장하고, 대시보드는 읽기만 한다
 * (다이제스트 메일이 이미 쓰는 "미리 계산 → 읽기만" 패턴과 동일 — CLAUDE.md 크론 원칙 참고).
 *
 * 신선도 원칙 (합의된 설계):
 * - 위기 급증 여부·건수·기사 목록은 이 파일과 무관하게 대시보드가 항상 실시간으로 조회한다.
 * - "왜 터졌는지" 원인 한 줄 / 경쟁사 트렌드 3줄만 이 사전계산 테이블을 거친다(최대 24시간 지연).
 *
 * 3가지 결정사항(2026-07-29 논의, 확정):
 * 1. 신규 키워드/신규 위기 백필 시점 → 다음 정기 크론까지 대기(휴리스틱 폴백으로 임시 커버)
 * 2. 폴백(휴리스틱) 결과는 화면에 명시적으로 표시 (AI 분석인지 기본 문구인지 구분)
 * 3. 크론이 통째로 실패한 날은 그 자리에서 실시간 AI 호출로 자동 폴백 (화면은 평소와 동일하게
 *    정상 작동, 장애는 RunLog에만 기록 — 사용자에게는 티 내지 않음)
 */
import { prisma } from '@/lib/prisma';
import { normalizeSource } from './media';
import { isBlockedNoise } from './relevance';
import { NEGATIVE_KEYWORDS, INDUSTRY_TREND_KEYWORDS, PINNED_COMPETITORS, detectCrises, type ArticleLite } from './insights';
import { summarizeCrisisCause } from './analyzer';
import { summarizeCompetitorTrend, summarizeOverallTrend } from './competitor-insights';

export type InsightSource = 'ai' | 'fallback';

// KST(UTC+9, DST 없음) 계산 — 실행 환경의 시스템 시간대(TZ)와 무관하게 항상 같은 결과를 내야 한다.
// 기존엔 toLocaleString으로 KST 문자열을 만든 뒤 다시 Date로 파싱했는데, 이 재파싱이 시스템 TZ를
// 타서 로컬(KST로 설정된 PC)에서 서버(UTC)와 다른 값이 나왔다(2026-08-05, 로컬 대시보드 기사 수가
// 프로덕션과 안 맞던 원인). 시스템 TZ와 무관하도록, 항상 실제 epoch에 9시간을 더한 뒤 UTC getter로만
// 읽는 방식으로 통일한다.
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function getKstNow() {
  return new Date(Date.now() + KST_OFFSET_MS);
}
// d는 실제(genuine) 타임스탬프여야 한다 — getKstNow()의 반환값을 다시 넣으면 9시간이 중복 적용된다.
function kstDateKey(d: Date) {
  const k = new Date(d.getTime() + KST_OFFSET_MS);
  return `${k.getUTCFullYear()}-${String(k.getUTCMonth() + 1).padStart(2, '0')}-${String(k.getUTCDate()).padStart(2, '0')}`;
}

// ===== 읽기: 대시보드 렌더링에서 사용 =====

/** 오늘(KST) 사전계산 배치가 성공적으로 끝났는지 — false면 크론 실패로 보고 실시간 호출로 폴백. */
export async function wasInsightsBatchFreshToday(): Promise<boolean> {
  const last = await prisma.runLog.findFirst({
    where: { runType: 'dashboard-insights', status: 'SUCCESS' },
    orderBy: { finishedAt: 'desc' },
    select: { finishedAt: true },
  });
  if (!last?.finishedAt) return false;
  // kstDateKey는 실제 타임스탬프를 받아야 한다 — getKstNow()를 넣으면 9시간이 중복 적용된다.
  return kstDateKey(last.finishedAt) === kstDateKey(new Date());
}

export async function getPrecomputedCrisisCauses(companies: string[]): Promise<Map<string, { cause: string; computedAt: Date }>> {
  const result = new Map<string, { cause: string; computedAt: Date }>();
  if (companies.length === 0) return result;
  const rows = await prisma.dashboardInsight.findMany({
    where: { kind: 'crisis_cause', key: { in: companies } },
  });
  for (const r of rows) {
    try {
      const parsed = JSON.parse(r.value);
      if (typeof parsed?.cause === 'string' && parsed.cause.trim()) {
        result.set(r.key, { cause: parsed.cause, computedAt: r.computedAt });
      }
    } catch {
      // 저장된 값이 깨져 있으면 그냥 건너뛴다 — 호출부가 폴백(케이스 A)으로 처리
    }
  }
  return result;
}

export async function getPrecomputedCompetitorInsights(): Promise<{
  overall: { lines: string[]; computedAt: Date } | null;
  byCompany: Map<string, { points: string[]; computedAt: Date }>;
}> {
  const rows = await prisma.dashboardInsight.findMany({
    where: { kind: { in: ['competitor_overall', 'competitor_trend'] } },
  });
  let overall: { lines: string[]; computedAt: Date } | null = null;
  const byCompany = new Map<string, { points: string[]; computedAt: Date }>();
  for (const r of rows) {
    try {
      const parsed = JSON.parse(r.value);
      if (r.kind === 'competitor_overall' && Array.isArray(parsed?.lines)) {
        overall = { lines: parsed.lines, computedAt: r.computedAt };
      } else if (r.kind === 'competitor_trend' && Array.isArray(parsed?.points)) {
        byCompany.set(r.key, { points: parsed.points, computedAt: r.computedAt });
      }
    } catch {
      // 무시 — 호출부는 그 회사만 null(요약 준비 중)로 처리
    }
  }
  return { overall, byCompany };
}

// ===== 쓰기: daily-collect 크론 끝에서 호출 =====

/**
 * 위기 원인 + 경쟁사 트렌드(기본 기간=최근 3개월)를 계산해 DashboardInsight에 저장.
 * 실패해도 절대 throw하지 않는다 — 이 단계가 실패해도 그날 수집·분석·발송에는 영향이
 * 없어야 하고(장애는 RunLog에만 기록), 대시보드는 실시간 호출로 자동 폴백한다(결정 3).
 */
export async function computeAndStoreDashboardInsights(): Promise<void> {
  const log = await prisma.runLog.create({ data: { runType: 'dashboard-insights', status: 'RUNNING' } });
  try {
    await computeCrisisCauses();
    await computeCompetitorTrends();
    await prisma.runLog.update({ where: { id: log.id }, data: { finishedAt: new Date(), status: 'SUCCESS' } });
  } catch (e: any) {
    console.error('[dashboard-insights] 사전계산 실패 — 대시보드는 실시간 호출로 자동 폴백됩니다:', e);
    await prisma.runLog.update({
      where: { id: log.id },
      data: { finishedAt: new Date(), status: 'FAILED', errors: String(e?.message ?? e) },
    });
  }
}

async function computeCrisisCauses() {
  const now = getKstNow();
  const rc = new Date(now); rc.setUTCDate(rc.getUTCDate() - 3); rc.setUTCHours(0, 0, 0, 0);

  const negOr = [{ tone: 'NEGATIVE' as string | null }, ...NEGATIVE_KEYWORDS.map(k => ({ title: { contains: k } }))];
  const crisisNeg = await prisma.article.findMany({
    where: { pubDate: { gte: rc, lte: now }, isNoise: false, category: 'portfolio_company', OR: negOr },
    select: { id: true, title: true, link: true, source: true, pubDate: true, matchedKeyword: true, category: true, tone: true },
    take: 800,
  });
  const notNoise = (a: { title: string; link: string; source: string }) =>
    !isBlockedNoise({ title: a.title, link: a.link, source: a.source });

  const crises = detectCrises(crisisNeg.filter(notNoise) as ArticleLite[]);
  for (const c of crises) {
    const cause = await summarizeCrisisCause(c.company, c.titles);
    if (!cause) continue; // 실패 시 다음 크론에 재시도 — 그 사이엔 호출부가 폴백(케이스 A) 처리
    await prisma.dashboardInsight.upsert({
      where: { kind_key: { kind: 'crisis_cause', key: c.company } },
      create: { kind: 'crisis_cause', key: c.company, value: JSON.stringify({ cause }) },
      update: { value: JSON.stringify({ cause }), computedAt: new Date() },
    });
  }
}

async function computeCompetitorTrends() {
  const now = getKstNow();
  const since = new Date(now); since.setUTCMonth(since.getUTCMonth() - 3); // 대시보드 기본 기간(최근 3개월)과 동일

  // ⚠️ 아래 집계 로직은 src/app/dashboard/page.tsx의 competitorAggs 구성과 반드시 같은 결과를
  // 내야 한다(카운트 산정 방식이 어긋나면 화면 숫자와 사전계산 트렌드 문구가 서로 안 맞아 보인다).
  // page.tsx 쪽 로직을 바꾸면 이 함수도 같이 확인할 것.
  const competitorArticles = await prisma.article.findMany({
    where: { pubDate: { gte: since, lte: now }, isNoise: false, category: 'competitor' },
    orderBy: { pubDate: 'desc' },
    select: { title: true, source: true, pubDate: true, link: true, tone: true, matchedKeyword: true },
    take: 3000,
  });
  const sparklabsMentions = await prisma.article.count({
    where: { pubDate: { gte: since, lte: now }, isNoise: false, OR: [{ category: 'sparklabs_self' }, { title: { contains: '스파크랩' } }] },
  });

  type Agg = { count: number; negCount: number; titles: string[] };
  const statMap = new Map<string, Agg>();
  for (const a of competitorArticles) {
    if (isBlockedNoise({ title: a.title, link: a.link, source: a.source })) continue;
    const name = a.matchedKeyword;
    if (!name || INDUSTRY_TREND_KEYWORDS.includes(name)) continue;
    let s = statMap.get(name);
    if (!s) { s = { count: 0, negCount: 0, titles: [] }; statMap.set(name, s); }
    s.count++;
    if (a.tone === 'NEGATIVE' || NEGATIVE_KEYWORDS.some(k => a.title.includes(k))) s.negCount++;
    if (s.titles.length < 40) s.titles.push(a.title);
  }
  const top10 = Array.from(statMap.entries()).sort((a, b) => b[1].count - a[1].count).slice(0, 10);
  if (top10.length === 0) return;

  // 고정 12개 카드(page.tsx의 PINNED_COMPETITORS)도 top10과 함께 사전계산 대상에 포함 —
  // 안 그러면 카드 12개가 대시보드 로드마다 실시간 LLM 호출로 남아 느려진다.
  const pinnedNames = PINNED_COMPETITORS.map(p => p.displayName ?? p.keyword).filter(name => statMap.has(name));
  const trendTargets = new Map(top10);
  for (const name of pinnedNames) {
    if (!trendTargets.has(name)) trendTargets.set(name, statMap.get(name)!);
  }

  const periodPhrase = '3개월간';
  const cacheKey = `precompute_${kstDateKey(new Date())}`;

  const overall = await summarizeOverallTrend(
    top10.map(([name, s]) => ({ name, count: s.count, negCount: s.negCount })),
    top10.flatMap(([, s]) => s.titles.slice(0, 6)),
    sparklabsMentions,
    cacheKey,
    periodPhrase,
  );
  if (overall) {
    await prisma.dashboardInsight.upsert({
      where: { kind_key: { kind: 'competitor_overall', key: 'overall' } },
      create: { kind: 'competitor_overall', key: 'overall', value: JSON.stringify({ lines: overall }) },
      update: { value: JSON.stringify({ lines: overall }), computedAt: new Date() },
    });
  }

  for (const [name, s] of trendTargets) {
    const points = await summarizeCompetitorTrend(name, s.titles, sparklabsMentions, s.count, cacheKey, periodPhrase);
    if (!points) continue;
    await prisma.dashboardInsight.upsert({
      where: { kind_key: { kind: 'competitor_trend', key: name } },
      create: { kind: 'competitor_trend', key: name, value: JSON.stringify({ points }) },
      update: { value: JSON.stringify({ points }), computedAt: new Date() },
    });
  }
}
