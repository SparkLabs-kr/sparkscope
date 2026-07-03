/**
 * Claude 기반 기사 분석기
 * 1단계: Haiku로 1차 분류 (배치 10건씩)
 * 2단계: Sonnet으로 심층 분석 (needsDeepAnalysis=true인 것만)
 * 3단계: Sonnet으로 편집자 한 줄 인사 생성
 *
 * Claude API 호출 실패 시 휴리스틱 fallback으로 결과 보장.
 */
import Anthropic from '@anthropic-ai/sdk';
import {
  HAIKU_CLASSIFIER_SYSTEM,
  buildHaikuClassifierUserMessage,
  SONNET_DEEP_SYSTEM,
  buildSonnetDeepUserMessage,
  EDITOR_INTRO_SYSTEM,
  buildEditorIntroUserMessage,
} from './prompts';
import type { RawArticle, AnalyzedArticle, Importance, Tone, Category } from './types';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

const HAIKU_BATCH_SIZE = 10;
const POSITIVE_HINTS = ['투자 유치', '상장', '협업', '계약', '돌파', '선정', '수상', 'MOU', '런칭', '개시', '진출'];
const NEGATIVE_HINTS = ['논란', '소송', '하락', '폐업', '철수', '리콜', '비판', '의혹'];

export async function analyzeArticles(raw: RawArticle[], portfolioUniverse: string[], trendingTopics: string[]): Promise<AnalyzedArticle[]> {
  // 1단계: Haiku 1차 분류 (배치)
  const withId = raw.map((a, i) => ({ ...a, _id: `${i}` }));
  const classifications = await classifyBatch(withId);

  const analyzed: AnalyzedArticle[] = [];

  for (const article of withId) {
    const cls = classifications.get(article._id) ?? heuristicClassify(article);
    if (cls.isNoise || cls.category === 'unrelated') continue;

    let oneLiner: string;
    let ourTake: string | undefined;
    let tone: Tone;
    let relatedCompanies: string[];
    let pitchScore: number;
    let pitchTopic: string | undefined;
    let riskFlag: string | undefined;

    if (cls.needsDeepAnalysis) {
      // 2단계: Sonnet 심층 분석
      const deep = await analyzeDeep(article, portfolioUniverse, trendingTopics);
      oneLiner = deep.oneLiner;
      ourTake = deep.ourTake;
      tone = deep.tone;
      relatedCompanies = deep.relatedCompanies;
      pitchScore = deep.pitchScore;
      pitchTopic = deep.pitchTopic;
      riskFlag = deep.riskFlag;
    } else {
      // 휴리스틱
      oneLiner = `${article.matchedKeyword} 관련 — ${article.source}`;
      tone = heuristicTone(article.title);
      relatedCompanies = [article.matchedKeyword];
      pitchScore = 0;
    }

    analyzed.push({
      ...article,
      importance: cls.importance,
      tone,
      oneLiner,
      ourTake,
      relatedCompanies,
      pitchScore,
      pitchTopic,
      riskFlag,
      isNoise: false,
      noiseReason: undefined,
      priorityScore: computePriorityScore(article, cls.importance, tone),
    });
  }

  return analyzed;
}

// ===== Haiku 1차 분류 =====
async function classifyBatch(articles: Array<RawArticle & { _id: string }>): Promise<Map<string, ClassificationResult>> {
  const results = new Map<string, ClassificationResult>();
  const batches = chunk(articles, HAIKU_BATCH_SIZE);

  for (const batch of batches) {
    const input = batch.map(a => ({
      id: a._id,
      title: a.title,
      source: a.source,
      matchedKeyword: a.matchedKeyword,
      matchedKeywordKind: a.category,
    }));

    try {
      const resp = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        system: HAIKU_CLASSIFIER_SYSTEM,
        messages: [{ role: 'user', content: buildHaikuClassifierUserMessage(input) }],
      });
      const text = resp.content.find(c => c.type === 'text')?.type === 'text'
        ? (resp.content[0] as any).text
        : '';
      const parsed = JSON.parse(extractJson(text));
      for (const item of parsed) {
        results.set(item.id, {
          category: item.category,
          importance: item.importance,
          isNoise: item.isNoise,
          noiseReason: item.noiseReason,
          needsDeepAnalysis: item.needsDeepAnalysis,
        });
      }
    } catch (e) {
      console.error('[analyzer] Haiku batch failed, falling back to heuristic:', e);
      for (const a of batch) results.set(a._id, heuristicClassify(a));
    }
  }
  return results;
}

// ===== Sonnet 심층 분석 =====
async function analyzeDeep(article: RawArticle & { _id: string }, portfolioUniverse: string[], trendingTopics: string[]): Promise<DeepResult> {
  try {
    const resp = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 800,
      system: SONNET_DEEP_SYSTEM,
      messages: [{
        role: 'user',
        content: buildSonnetDeepUserMessage(
          { id: article._id, title: article.title, source: article.source, matchedKeyword: article.matchedKeyword, category: article.category },
          portfolioUniverse,
          trendingTopics,
        ),
      }],
    });
    const text = resp.content.find(c => c.type === 'text')?.type === 'text'
      ? (resp.content[0] as any).text
      : '';
    const parsed = JSON.parse(extractJson(text));
    return {
      oneLiner: parsed.oneLiner ?? `${article.matchedKeyword} 관련`,
      ourTake: parsed.ourTake,
      tone: parsed.tone ?? 'NEUTRAL',
      relatedCompanies: parsed.relatedCompanies ?? [article.matchedKeyword],
      pitchScore: parsed.pitchScore ?? 0,
      pitchTopic: parsed.pitchTopic,
      riskFlag: parsed.riskFlag,
    };
  } catch (e) {
    console.error('[analyzer] Sonnet deep failed, falling back:', e);
    return {
      oneLiner: `${article.matchedKeyword} — ${article.title.slice(0, 25)}`,
      tone: heuristicTone(article.title),
      relatedCompanies: [article.matchedKeyword],
      pitchScore: 0,
    };
  }
}

// ===== 편집자 한 줄 인사 =====
export async function generateEditorIntro(top3: AnalyzedArticle[]): Promise<string> {
  if (top3.length === 0) return '오늘은 주목할 만한 보도가 적은 날입니다. 업계 동향만 가볍게 확인해보세요.';
  try {
    const resp = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 300,
      system: EDITOR_INTRO_SYSTEM,
      messages: [{
        role: 'user',
        content: buildEditorIntroUserMessage(top3.map(a => ({
          title: a.title,
          category: a.category,
          source: a.source,
          ourTake: a.ourTake,
        }))),
      }],
    });
    const text = resp.content.find(c => c.type === 'text')?.type === 'text'
      ? (resp.content[0] as any).text
      : '';
    return text.trim();
  } catch (e) {
    console.error('[analyzer] editor intro failed:', e);
    const top1 = top3[0];
    return `오늘은 ${top1.matchedKeyword} 관련 보도가 가장 주목할 만합니다 (${top1.source}).`;
  }
}

// ===== 휴리스틱 fallback =====
function heuristicClassify(article: RawArticle): ClassificationResult {
  return {
    category: article.category,
    importance: article.basePriority >= 90 ? 'HIGH' : article.basePriority >= 60 ? 'MEDIUM' : 'LOW',
    isNoise: false,
    needsDeepAnalysis: false,
  };
}

function heuristicTone(title: string): Tone {
  const isPos = POSITIVE_HINTS.some(k => title.includes(k));
  const isNeg = NEGATIVE_HINTS.some(k => title.includes(k));
  if (isPos && !isNeg) return 'POSITIVE';
  if (isNeg) return 'NEGATIVE';
  return 'NEUTRAL';
}

function computePriorityScore(article: RawArticle, importance: Importance, tone: Tone): number {
  let score = article.basePriority;
  const impBonus = { CRITICAL: 30, HIGH: 20, MEDIUM: 10, LOW: 0 }[importance];
  score += impBonus;
  // 메이저 매체 가중치
  const major = ['동아일보', '조선비즈', 'Chosunbiz', '매일경제', '한국경제', '전자신문', '디지털데일리', '디지털타임스', '아시아투데이'];
  if (major.includes(article.source)) score += 15;
  // 신선도
  const ageHrs = (Date.now() - article.pubDate.getTime()) / (1000 * 60 * 60);
  if (ageHrs < 24) score += 15;
  else if (ageHrs < 48) score += 8;
  // 부정 톤 가중치 (위기 감지)
  if (tone === 'NEGATIVE') score += 20;
  return score;
}

// ===== 유틸 =====
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function extractJson(text: string): string {
  // ```json ... ``` 블록 또는 평문 JSON 모두 대응
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fence) return fence[1];
  // 첫 [ 또는 { 부터 끝까지
  const first = Math.min(
    text.indexOf('[') === -1 ? Infinity : text.indexOf('['),
    text.indexOf('{') === -1 ? Infinity : text.indexOf('{'),
  );
  return text.slice(first === Infinity ? 0 : first);
}

interface ClassificationResult {
  category: Category | 'unrelated';
  importance: Importance;
  isNoise: boolean;
  noiseReason?: string;
  needsDeepAnalysis: boolean;
}

interface DeepResult {
  oneLiner: string;
  ourTake?: string;
  tone: Tone;
  relatedCompanies: string[];
  pitchScore: number;
  pitchTopic?: string;
  riskFlag?: string;
}
