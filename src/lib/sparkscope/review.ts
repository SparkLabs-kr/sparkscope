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
const CANDIDATE_WINDOW_DAYS = 4;

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

/** 최근 창의 비노이즈 기사 + 포트폴리오 관련성 가드 적용 후보 로드. */
export async function loadDigestCandidates(): Promise<ReviewArticle[]> {
  const since = new Date();
  since.setDate(since.getDate() - CANDIDATE_WINDOW_DAYS);

  const [rows, targets] = await Promise.all([
    prisma.article.findMany({
      where: { pubDate: { gte: since }, isNoise: false },
      orderBy: [{ priorityScore: 'desc' }, { pubDate: 'desc' }],
      take: 400,
    }),
    prisma.monitoringTarget.findMany({
      where: { category: { in: ['portfolio_company', 'sparklabs_self'] }, status: 'ACTIVE' },
      select: { primaryKeyword: true, name: true, englishName: true },
    }),
  ]);

  // 강한 식별자(회사명·영문명·주키워드)만 — helperKeywords(대표자명 등)는 단독 통과 불가
  const keyMap = new Map<string, string[]>();
  for (const t of targets) {
    const keys = [t.primaryKeyword, t.name, t.englishName]
      .map(k => (k ?? '').trim()).filter(k => k.length >= 2);
    keyMap.set(t.primaryKeyword, Array.from(new Set(keys)));
  }

  return rows
    // 확정 매체 26개만 + 스포츠·게임·연예·광고 강제 제외
    .filter(a => isKnownMedia(a.source))
    .filter(a => !isBlockedNoise({ title: a.title, link: a.link, source: a.source }))
    // 회사/조직명(강한 식별자)이 제목에 등장해야 통과 (포트폴리오+스파크랩)
    .filter(a => {
      if (!NAME_MATCH_CATEGORIES.has(a.category)) return true;
      const keys = keyMap.get(a.matchedKeyword) ?? [a.matchedKeyword];
      return keys.some(k => matchesAsToken(a.title, k));
    })
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
