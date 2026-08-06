/**
 * 다이제스트 검수 콘솔 데이터 레이어.
 * - loadDigestCandidates(): 최근 DB 기사(비노이즈·관련성 가드)를 다이제스트 후보로 로드
 * - buildReviewDigest(): 편집자 오버라이드(TOP3 순서/제외/편집자 한 줄/카테고리 요약)를 반영해 DigestData 생성
 * 재수집 없이 기존 분석 결과를 사용하므로 빠르고, 실제 발송 HTML과 동일하게 렌더된다.
 */
import { prisma } from '@/lib/prisma';
import { buildDigestData } from './digest';
import { matchesAsToken, isBlockedNoise, NAME_MATCH_CATEGORIES } from './relevance';
import { isKnownMedia } from './media';
import type { AnalyzedArticle, Category, Importance, Tone, DigestData } from './types';

const CATEGORY_PRIORITY: Record<string, number> = {
  sparklabs_self: 100,
  portfolio_company: 70,
  competitor: 50,
  industry_trend: 40,
};

// 후보 기사 창(일). 발송 주기(월·수·금)를 고려한 최근 4일.
const CANDIDATE_WINDOW_DAYS = 7; // 첫 발송: 최근 7일(예: 7/1~7/8). 이후 주간 발송 기준.

export interface ReviewArticle extends AnalyzedArticle {
  id: string;
  isScrapped: boolean;
}

export interface ReviewOverrides {
  editorIntro?: string;
  top3Ids?: string[];              // 편집자가 지정한 TOP3 순서 (id)
  excludedIds?: string[];          // 발송에서 제외할 기사 id
  categorySummaries?: DigestData['categorySummaries'];
}

function safeJsonArray(s: string | null): string[] {
  if (!s) return [];
  try { const v = JSON.parse(s); return Array.isArray(v) ? v.map(String) : []; } catch { return []; }
}

type ArticleRow = Awaited<ReturnType<typeof prisma.article.findMany>>[number];

function toReviewArticle(a: ArticleRow): ReviewArticle {
  return {
    id: a.id,
    isScrapped: a.isScrapped,
    title: a.title,
    link: a.link,
    source: a.source,
    pubDate: a.pubDate,
    matchedKeyword: a.matchedKeyword,
    category: a.category as Category,
    basePriority: CATEGORY_PRIORITY[a.category] ?? 50,
    importance: (a.importance ?? 'LOW') as Importance,
    tone: (a.tone ?? 'NEUTRAL') as Tone,
    oneLiner: a.oneLiner ?? a.title,
    ourTake: a.ourTake ?? undefined,
    relatedCompanies: safeJsonArray(a.relatedCompanies),
    pitchScore: a.pitchScore ?? 0,
    pitchTopic: a.pitchTopic ?? undefined,
    riskFlag: a.riskFlag ?? undefined,
    isNoise: a.isNoise,
    noiseReason: a.noiseReason ?? undefined,
    priorityScore: a.priorityScore ?? 0,
  };
}

export interface DigestGuardTarget {
  primaryKeyword: string;
  name?: string | null;
  englishName?: string | null;
  helperKeywords?: string | null;
  contextWords?: string | null;
}

/** 강한 식별자(회사명·영문명·주키워드) + 큐레이션 서비스명(helperKeywords) 맵 구성. */
export function buildDigestKeyMap(targets: DigestGuardTarget[]): Map<string, string[]> {
  const keyMap = new Map<string, string[]>();
  for (const t of targets) {
    const keys = [t.primaryKeyword, t.name, t.englishName, ...(t.helperKeywords ?? '').split(',')]
      .map(k => (k ?? '').trim()).filter(k => k.length >= 2);
    keyMap.set(t.primaryKeyword, Array.from(new Set(keys)));
  }
  return keyMap;
}

/** 문맥어(contextWords) 맵 — "Wave"처럼 흔한 영문명 등이 무관한 기사에 우연히 걸리는 걸
 * 막는 재검증용(2026-08-06, 웨이브코퍼레이션 Miami 기사 사례로 발견). */
export function buildDigestContextMap(targets: DigestGuardTarget[]): Map<string, string[]> {
  const contextMap = new Map<string, string[]>();
  for (const t of targets) {
    const words = (t.contextWords ?? '').split(',').map(w => w.trim()).filter(w => w.length >= 2);
    if (words.length > 0) contextMap.set(t.primaryKeyword, words);
  }
  return contextMap;
}

/**
 * 다이제스트에 실릴 자격이 있는지 재검증하는 가드 — 검수 콘솔(review.ts) 전용이었으나
 * 자동발송 경로(runner.ts)도 동일하게 통과해야 한다. isNoise:false는 수집 당일 AI가 한 번
 * 판단하고 끝이라 노이즈 규칙이 나중에 강화돼도 소급 적용이 안 되므로, 발송 직전에 항상
 * 다시 검사한다(대시보드가 렌더할 때마다 isBlockedNoise를 재검사하는 것과 동일한 원리, 2026-08-06).
 */
export function passesDigestGuard(
  a: { title: string; link?: string | null; source?: string | null; category: string; matchedKeyword: string },
  keyMap: Map<string, string[]>,
  contextMap?: Map<string, string[]>,
): boolean {
  // 포폴·자사·경쟁사는 매체 무관(collector.ts와 동일 기준), 업계동향만 확정 매체 26개 + 스포츠·광고 제외
  if (!(NAME_MATCH_CATEGORIES.has(a.category) || isKnownMedia(a.source ?? ''))) return false;
  if (isBlockedNoise({ title: a.title, link: a.link, source: a.source })) return false;
  // 회사/조직명(강한 식별자)이 제목에 등장해야 통과 (포트폴리오+스파크랩 한정).
  // competitor는 제외 — Article엔 본문이 없어 제목만으로 재검증하면, 수집 시점엔 본문 직접언급으로
  // 통과했던(제목엔 투자사명이 없는) 정상 기사까지 여기서 다시 걸러지는 문제가 생긴다.
  if (NAME_MATCH_CATEGORIES.has(a.category) && a.category !== 'competitor') {
    const keys = keyMap.get(a.matchedKeyword) ?? [a.matchedKeyword];
    if (!keys.some(k => matchesAsToken(a.title, k))) return false;
    // 문맥어 재검사 — 회사명(특히 영문명)이 흔한 단어라 이름만으로는 무관한 기사에도 걸릴 수
    // 있는데, 지금까지는 이 재검사가 여기 없어서 놓쳤다. 문맥어가 등록된 대상만 검사(없으면
    // 스킵 — 수집 시점 필터와 동일 원칙).
    const contextWords = contextMap?.get(a.matchedKeyword);
    if (contextWords && contextWords.length > 0 && !contextWords.some(w => matchesAsToken(a.title, w))) {
      return false;
    }
  }
  return true;
}

/** 최근 창의 비노이즈 기사 + 포트폴리오 관련성 가드 적용 후보 로드. */
export async function loadDigestCandidates(): Promise<ReviewArticle[]> {
  const since = new Date();
  since.setDate(since.getDate() - CANDIDATE_WINDOW_DAYS);
  since.setHours(0, 0, 0, 0); // 구간 시작일 00:00부터 포함 (7/1 전체 포함)

  const [rows, targets] = await Promise.all([
    prisma.article.findMany({
      where: { pubDate: { gte: since }, isNoise: false },
      orderBy: [{ priorityScore: 'desc' }, { pubDate: 'desc' }],
      take: 400,
    }),
    prisma.monitoringTarget.findMany({
      where: { category: { in: ['portfolio_company', 'sparklabs_self'] }, status: 'ACTIVE' },
      select: { primaryKeyword: true, name: true, englishName: true, helperKeywords: true, contextWords: true },
    }),
  ]);

  const keyMap = buildDigestKeyMap(targets);
  const contextMap = buildDigestContextMap(targets);

  return rows
    .filter(a => passesDigestGuard(a, keyMap, contextMap))
    .map(toReviewArticle);
}

/** 후보 + 오버라이드 → DigestData (실제 발송 HTML과 동일 구조). */
export function buildReviewDigest(candidates: ReviewArticle[], overrides: ReviewOverrides = {}): DigestData {
  const excluded = new Set(overrides.excludedIds ?? []);
  const included = candidates.filter(a => !excluded.has(a.id));
  const scrappedLinks = new Set(included.filter(a => a.isScrapped).map(a => a.link));

  const editorIntro = (overrides.editorIntro ?? '').trim()
    || '오늘의 미디어 다이제스트를 검수 중입니다. 편집자 한 줄을 입력해 주세요.';

  const data = buildDigestData(included, editorIntro, undefined, scrappedLinks);

  // TOP3 편집자 지정 순서 반영 (지정된 것 먼저, 그다음 자동 선정으로 3개 채움)
  if (overrides.top3Ids && overrides.top3Ids.length > 0) {
    const byId = new Map(included.map(a => [a.id, a]));
    const picked: ReviewArticle[] = [];
    for (const id of overrides.top3Ids) {
      const a = byId.get(id);
      if (a && !excluded.has(id)) picked.push(a);
    }
    // data.top3는 런타임상 ReviewArticle(원본 included에서 온 객체)
    for (const a of data.top3 as ReviewArticle[]) {
      if (picked.length >= 3) break;
      if (!picked.includes(a)) picked.push(a);
    }
    data.top3 = picked.slice(0, 3);
  }

  data.categorySummaries = overrides.categorySummaries;
  return data;
}
