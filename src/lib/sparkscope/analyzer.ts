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
import { hasNegativeKeyword, hasCrisisKeyword } from './keywords-data';
import type { RawArticle, AnalyzedArticle, Importance, Tone, Category } from './types';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

const HAIKU_BATCH_SIZE = 10;
const POSITIVE_HINTS = ['투자 유치', '상장', '협업', '계약', '돌파', '선정', '수상', 'MOU', '런칭', '개시', '진출', '기록', '성장', '확대'];

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
      oneLiner: parsed.oneLiner ?? article.title,
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
// 공백 포함 280자 이내로, 문장이 중간에 잘리지 않게 완결된 문장 단위로 마무리하는 하드 가드.
const EDITOR_INTRO_MAX = 280;
export function clampEditorIntro(text: string, max = EDITOR_INTRO_MAX): string {
  const t = (text ?? '').trim();
  if (t.length <= max) return t;
  const head = t.slice(0, max);
  // 마지막 문장 종결부(. ! ? 또는 '다.' 등) 기준으로 자름 — <strong> 태그가 열린 채 끝나지 않게 보정
  const lastEnd = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '),
    head.lastIndexOf('.'), head.lastIndexOf('!'), head.lastIndexOf('?'));
  let out = lastEnd > 40 ? head.slice(0, lastEnd + 1) : head.trim();
  // 닫히지 않은 <strong> 태그가 있으면 닫아줌
  const opens = (out.match(/<strong>/g) || []).length;
  const closes = (out.match(/<\/strong>/g) || []).length;
  if (opens > closes) out += '</strong>';
  return out.trim();
}

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
    return clampEditorIntro(text);
  } catch (e) {
    console.error('[analyzer] editor intro failed:', e);
    const top1 = top3[0];
    const pos = top3.filter(a => a.tone === 'POSITIVE').length;
    const mood = pos >= 2 ? '긍정적 보도가 우세한 흐름입니다' : '주목할 이슈가 이어지는 흐름입니다';
    return clampEditorIntro(`오늘은 <strong>${top1.title}</strong> 보도가 가장 눈에 띕니다. 전반적으로 ${mood}. 관련 포트폴리오사와의 연결 지점을 본부에서 함께 살펴볼 시점입니다.`);
  }
}

// ===== 위기 원인 요약 (대시보드 실시간 위기 감지 카드용) =====
// 포트폴리오사별 부정 기사 제목들을 보고 "원인" 한 줄을 요약. 실패 시 null(호출부 fallback).
const CRISIS_CAUSE_SYSTEM = `당신은 스파크랩 커뮤니케이션 본부의 PR 애널리스트입니다.
특정 포트폴리오사에 대한 부정 논조 기사 제목들을 보고, 지금 무슨 일이 벌어지고 있는지 "원인"을 한 문장으로 요약합니다.
원칙: 두괄식, 사실만(과장·추측 금지), 제목에 없는 내용 지어내지 않기.
응답은 반드시 valid JSON 객체로, 추가 설명 없이.`;

export async function summarizeCrisisCause(company: string, titles: string[]): Promise<string | null> {
  if (titles.length === 0) return null;
  try {
    const resp = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      system: CRISIS_CAUSE_SYSTEM,
      messages: [{
        role: 'user',
        content: `회사: ${company}
부정 기사 제목들:
${titles.map((t, i) => `${i + 1}. ${t}`).join('\n')}

이 기사들의 공통 원인/이슈를 한국어 한 문장(70자 이내)으로 요약해주세요.
"해당 원인은 ○○○, ○○○ 등으로 ~입니다." 형태의 자연스러운 서술을 권장합니다.
출력 스키마: {"cause": "..."}
JSON 객체만 반환:`,
      }],
    });
    const text = resp.content.find(c => c.type === 'text')?.type === 'text'
      ? (resp.content[0] as any).text
      : '';
    const parsed = JSON.parse(extractJson(text));
    const cause = typeof parsed?.cause === 'string' ? parsed.cause.trim() : '';
    return cause.length > 0 ? cause : null;
  } catch (e) {
    console.error('[analyzer] crisis cause summary failed, using fallback:', e);
    return null;
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
  // [5] data 폴더 키워드 규칙 우선
  if (hasNegativeKeyword(title)) return 'NEGATIVE';

  const isPos = POSITIVE_HINTS.some(k => title.includes(k));
  if (isPos) return 'POSITIVE';

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
