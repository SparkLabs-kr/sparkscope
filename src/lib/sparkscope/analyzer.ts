/**
 * OpenAI 기반 기사 분석기
 * 1단계: gpt-4o-mini로 1차 분류 (배치 10건씩)
 * 2단계: gpt-4o로 심층 분석 (needsDeepAnalysis=true인 것만)
 * 3단계: gpt-4o로 편집자 한 줄 인사 생성
 *
 * OpenAI API 호출 실패 시 휴리스틱 fallback으로 결과 보장.
 */
import OpenAI from 'openai';
import {
  HAIKU_CLASSIFIER_SYSTEM,
  buildHaikuClassifierUserMessage,
  SONNET_DEEP_SYSTEM,
  buildSonnetDeepUserMessage,
  EDITOR_INTRO_SYSTEM,
  buildEditorIntroUserMessage,
} from './prompts';
import { hasNegativeKeyword, hasCrisisKeyword, countNegativeSignals } from './keywords-data';
import { scrapeArticleBody } from './scraper';
import { resolveGoogleNewsUrl } from './google-news-resolver';
import type { RawArticle, AnalyzedArticle, Importance, Tone, Category } from './types';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

// 저비용 분류용 / 품질이 중요한 생성용 — 필요에 따라 모델명만 바꾸면 됨.
const CLASSIFIER_MODEL = 'gpt-4o-mini';
const DEEP_MODEL = 'gpt-4o';

async function chatComplete(model: string, system: string, userContent: string, maxTokens: number): Promise<string> {
  const resp = await openai.chat.completions.create({
    model,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: userContent },
    ],
  });
  return resp.choices[0]?.message?.content ?? '';
}

const HAIKU_BATCH_SIZE = 10;
const POSITIVE_HINTS = ['투자 유치', '상장', '협업', '계약', '돌파', '선정', '수상', 'MOU', '런칭', '개시', '진출', '기록', '성장', '확대'];
// 제목이 중립이어도 본문에 부정/위기 키워드가 이 개수 이상 겹치면 "압도적으로 부정적"으로 보고 NEGATIVE로 override.
const HOLISTIC_NEGATIVE_THRESHOLD = 3;
const VALID_TONES: Tone[] = ['POSITIVE', 'NEUTRAL', 'NEGATIVE', 'MIXED'];
const VALID_IMPORTANCE: Importance[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

// LLM이 소문자("negative")나 공백 섞인 값을 줘도 정규화해서 인식. 매치 안 되면 undefined(호출부에서 기본값 처리).
function normalizeTone(raw: unknown): Tone | undefined {
  if (typeof raw !== 'string') return undefined;
  const upper = raw.trim().toUpperCase();
  return (VALID_TONES as string[]).includes(upper) ? (upper as Tone) : undefined;
}

// tone과 동일한 이유로 검증 필요: importance가 스키마 밖 값(오타·소문자·누락)이면
// computePriorityScore의 { CRITICAL, HIGH, MEDIUM, LOW } 조회가 undefined를 반환해
// priorityScore가 NaN이 되고, DB 저장(Int 컬럼) 시 전체 배치가 죽는 사고로 이어짐(2026-07-10 실제 발생).
function normalizeImportance(raw: unknown): Importance | undefined {
  if (typeof raw !== 'string') return undefined;
  const upper = raw.trim().toUpperCase();
  return (VALID_IMPORTANCE as string[]).includes(upper) ? (upper as Importance) : undefined;
}

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
    // 심층분석 대상인데 본문을 못 구해서(스크래핑 실패) title만으로 판단된 경우 — 조용히 넘기지 않고 명시적으로 플래그.
    let titleOnlyFallback = false;

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
      titleOnlyFallback = !deep.bodyUsed;
    } else {
      // 휴리스틱 (애초에 심층분석 대상이 아님 — 본문 시도 자체를 안 하므로 "실패"가 아니라 정상 동작)
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
      titleOnlyFallback,
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
      ...(a.companyDesc ? { companyDesc: a.companyDesc } : {}),
    }));

    try {
      const text = await chatComplete(CLASSIFIER_MODEL, HAIKU_CLASSIFIER_SYSTEM, buildHaikuClassifierUserMessage(input), 2000);
      const parsed = JSON.parse(extractJson(text));
      for (const item of parsed) {
        const importance = normalizeImportance(item.importance);
        if (item.importance !== undefined && importance === undefined) {
          console.error('[analyzer] LLM returned unrecognized importance value:', item.importance);
        }
        results.set(item.id, {
          category: item.category,
          importance: importance ?? 'MEDIUM',
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

// collector가 이미 스크래핑했으면 재사용, 없으면 심층분석 대상(needsDeepAnalysis=true, 소수)에 한해
// 여기서 직접 시도. 네이버 재검색 폴백은 안 함(collector 전용 인프라) — 실패하면 title-only로 진행.
async function ensureBody(article: RawArticle): Promise<string | undefined> {
  if (article.body) return article.body;
  try {
    let link = article.link;
    if (link.includes('news.google.com')) {
      const resolved = await resolveGoogleNewsUrl(link);
      if (!resolved) return undefined;
      link = resolved;
    }
    const scraped = await scrapeArticleBody(link);
    return scraped?.text;
  } catch {
    return undefined;
  }
}

// ===== Sonnet 심층 분석 =====
async function analyzeDeep(article: RawArticle & { _id: string }, portfolioUniverse: string[], trendingTopics: string[]): Promise<DeepResult> {
  // catch 블록에서도 본문 기반 휴리스틱을 쓸 수 있게 try 밖에서 선언.
  let body: string | undefined;
  try {
    body = await ensureBody(article);
    const userContent = buildSonnetDeepUserMessage(
      { id: article._id, title: article.title, source: article.source, matchedKeyword: article.matchedKeyword, category: article.category, body },
      portfolioUniverse,
      trendingTopics,
    );
    const text = await chatComplete(DEEP_MODEL, SONNET_DEEP_SYSTEM, userContent, 800);
    const parsed = JSON.parse(extractJson(text));

    const normalized = normalizeTone(parsed.tone);
    if (parsed.tone !== undefined && normalized === undefined) {
      console.error('[analyzer] LLM returned unrecognized tone value:', parsed.tone);
    }
    let tone: Tone = normalized ?? 'NEUTRAL';
    // 제목만 보면 중립이어도 본문에 부정/위기 신호가 압도적으로 많으면 강제로 NEGATIVE.
    // LLM이 본문을 보고도 놓치는 경우에 대한 안전망.
    if (tone === 'NEUTRAL' && body && countNegativeSignals(body) >= HOLISTIC_NEGATIVE_THRESHOLD) {
      tone = 'NEGATIVE';
    }

    return {
      oneLiner: parsed.oneLiner ?? article.title,
      ourTake: parsed.ourTake,
      tone,
      relatedCompanies: parsed.relatedCompanies ?? [article.matchedKeyword],
      pitchScore: parsed.pitchScore ?? 0,
      pitchTopic: parsed.pitchTopic,
      riskFlag: parsed.riskFlag,
      bodyUsed: !!body,
    };
  } catch (e) {
    console.error('[analyzer] Sonnet deep failed, falling back:', e);
    return {
      oneLiner: `${article.matchedKeyword} — ${article.title.slice(0, 25)}`,
      tone: heuristicTone(article.title, body),
      relatedCompanies: [article.matchedKeyword],
      pitchScore: 0,
      bodyUsed: false,
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
    const userContent = buildEditorIntroUserMessage(top3.map(a => ({
      title: a.title,
      category: a.category,
      source: a.source,
      ourTake: a.ourTake,
    })));
    const text = await chatComplete(DEEP_MODEL, EDITOR_INTRO_SYSTEM, userContent, 300);
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
    const userContent = `회사: ${company}
부정 기사 제목들:
${titles.map((t, i) => `${i + 1}. ${t}`).join('\n')}

이 기사들의 공통 원인/이슈를 한국어 한 문장(70자 이내)으로 요약해주세요.
"해당 원인은 ○○○, ○○○ 등으로 ~입니다." 형태의 자연스러운 서술을 권장합니다.
출력 스키마: {"cause": "..."}
JSON 객체만 반환:`;
    const text = await chatComplete(CLASSIFIER_MODEL, CRISIS_CAUSE_SYSTEM, userContent, 200);
    const parsed = JSON.parse(extractJson(text));
    const cause = typeof parsed?.cause === 'string' ? parsed.cause.trim() : '';
    return cause.length > 0 ? cause : null;
  } catch (e) {
    console.error('[analyzer] crisis cause summary failed, using fallback:', e);
    return null;
  }
}

// 위기 카드가 여러 건일 때 대시보드 상단에 붙이는 전체 요약 (개별 카드 원인들을 한 번 더 종합).
const CRISIS_OVERVIEW_SYSTEM = `당신은 스파크랩 커뮤니케이션 본부의 PR 애널리스트입니다.
여러 포트폴리오사에서 동시에 감지된 부정 이슈 목록을 보고, 지금 상황을 한눈에 파악할 수 있도록 2~3문장(총 120자 이내)으로 종합 요약합니다.
원칙: 두괄식, 사실만(과장·추측 금지), 입력에 없는 내용 지어내지 않기.
응답은 반드시 valid JSON 객체로, 추가 설명 없이.`;

export async function summarizeCrisisOverview(
  crises: { company: string; negCount: number; cause: string }[],
): Promise<string | null> {
  if (crises.length === 0) return null;
  try {
    const userContent = `위기 감지된 포트폴리오사 목록:
${crises.map((c, i) => `${i + 1}. ${c.company} (부정 기사 ${c.negCount}건) — ${c.cause}`).join('\n')}

출력 스키마: {"overview": "..."}
JSON 객체만 반환:`;
    const text = await chatComplete(CLASSIFIER_MODEL, CRISIS_OVERVIEW_SYSTEM, userContent, 200);
    const parsed = JSON.parse(extractJson(text));
    const overview = typeof parsed?.overview === 'string' ? parsed.overview.trim() : '';
    return overview.length > 0 ? overview : null;
  } catch (e) {
    console.error('[analyzer] crisis overview summary failed, using fallback:', e);
    return null;
  }
}

// ===== 휴리스틱 fallback =====
function heuristicClassify(article: RawArticle): ClassificationResult {
  return {
    category: article.category,
    importance: article.basePriority >= 90 ? 'HIGH' : article.basePriority >= 60 ? 'MEDIUM' : 'LOW',
    isNoise: false,
    needsDeepAnalysis: article.category === 'sparklabs_self' || article.category === 'portfolio_company',
  };
}

export function heuristicTone(title: string, body?: string): Tone {
  // [5] data 폴더 키워드 규칙 우선 — 부정 키워드 리스트 + 위기 키워드 리스트 모두 신호로 사용.
  if (hasNegativeKeyword(title) || hasCrisisKeyword(title)) return 'NEGATIVE';

  const isPos = POSITIVE_HINTS.some(k => title.includes(k));

  // 제목은 중립·긍정 힌트가 없어도, 본문에 부정/위기 신호가 압도적으로 많으면 NEGATIVE로 override.
  if (!isPos && body && countNegativeSignals(body) >= HOLISTIC_NEGATIVE_THRESHOLD) {
    return 'NEGATIVE';
  }

  if (isPos) return 'POSITIVE';

  return 'NEUTRAL';
}

function computePriorityScore(article: RawArticle, importance: Importance, tone: Tone): number {
  // ?? 0 안전망: importance가 검증을 뚫고 스키마 밖 값으로 들어와도 NaN 대신 0점 처리.
  // (NaN이 DB Int 컬럼에 들어가면 upsert가 예외를 던져 그 회차 저장이 전부 실패했던 사고가 있었음)
  let score = article.basePriority || 0;
  const impBonus = { CRITICAL: 30, HIGH: 20, MEDIUM: 10, LOW: 0 }[importance] ?? 0;
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
  bodyUsed: boolean;
}
