/**
 * 뉴스 다이제스트 항목에 대한 질문 답변.
 *
 * 읽던 요약 옆에서 바로 물어볼 수 있게 하되, 근거 밖으로 나가지 않는다.
 *
 * 왜 근거를 엄격히 다루는가:
 *   항목마다 grounding 이 붙어 있다 — full(원문 발췌 있음) / partial /
 *   headline(제목과 매체명뿐). headline 짜리에 대해 그럴듯하게 답하면 그건
 *   뉴스에 대해 지어내는 것이고, 읽는 사람은 그게 지어낸 것인지 알 수 없다.
 *   그래서 모델에게 "모르면 모른다고 하고 링크를 권하라"를 강제한다.
 *
 * 원문(sourceText)은 브라우저로 내려보내지 않는다 — 다이제스트 응답이 이미
 * 2MB 캐시 한계에 닿아 있다(news-digest.ts 주석). 그래서 질문은 서버에서
 * 화면이 이미 가진 요약·메타데이터를 받아 답한다.
 */
import OpenAI from 'openai';

let _openai: OpenAI | null = null;
const client = () => (_openai ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY! }));

const MODEL = 'gpt-4o-mini';

export type AskContext = {
  title: string;
  source: string;
  publishedAt: string;
  url: string;
  /** 화면에 떠 있는 요약(긴 형태). 없으면 빈 배열. */
  summary: string[];
  /** 같은 사건을 다룬 다른 매체 */
  alsoIn: string[];
  /** 'full' | 'partial' | 'headline' */
  grounding: string;
  /** 이 기사와 엮인 포트폴리오사(있으면) */
  portfolio?: { company: string; reason: string }[];
};

export type AskReason = 'answered' | 'outside_summary' | 'off_topic' | 'headline_only';
export type AskResult = { answer: string; grounded: boolean; reason: AskReason };

const SYSTEM = [
  '너는 스파크랩 미디어 인사이트(SparkScope)의 뉴스 도우미다.',
  '사용자가 지금 읽고 있는 기사 하나에 대해 묻는다. 주어진 근거만으로 답한다.',
  '',
  '규칙:',
  '1. 근거에 없는 사실을 만들지 마라. 숫자·인용·날짜·인물은 특히 그렇다.',
  '2. 답은 3~5문장. 불릿은 쓰지 마라. 사용자가 쓴 언어로 답해라',
  '   (한국어로 물으면 한국어, 영어로 물으면 영어).',
  '3. 투자 권유(사야 하나/팔아야 하나)에는 판단을 내리지 말고, 기사에 있는',
  '   사실만 전하고 판단은 사용자 몫이라고 밝혀라.',
  '',
  'JSON 으로만 답한다:',
  '{"answer": string, "reason": "answered"|"outside_summary"|"off_topic"}',
  '',
  'reason 을 고르는 법 — 자료 상태를 네가 서술하지 마라. 판단만 해라:',
  '  answered        : 주어진 근거만으로 답했다.',
  '  outside_summary : 이 기사에 대한 질문이지만 근거에 그 내용이 없다.',
  '  off_topic       : 이 기사와 무관한 질문이다(일반 상식, 다른 기사, 잡담).',
  'answered 가 아니면 answer 에는 무엇을 못 하는지만 짧게 적고, 없는 사실을',
  '지어내지 마라. 근거가 어떤 상태인지(제목만 있는지 등)는 쓰지 마라 —',
  '그 문장은 앱이 붙인다.',
].join('\n');

export async function askAboutItem(
  ctx: AskContext,
  question: string,
): Promise<AskResult> {
  const payload = {
    question,
    article: {
      title: ctx.title,
      source: ctx.source,
      publishedAt: ctx.publishedAt,
      grounding: ctx.grounding,
      ...(ctx.summary.length ? { summary: ctx.summary } : {}),
      ...(ctx.alsoIn.length ? { alsoCoveredBy: ctx.alsoIn } : {}),
      ...(ctx.portfolio?.length ? { relatedPortfolio: ctx.portfolio } : {}),
    },
  };

  const resp = await client().chat.completions.create({
    model: MODEL,
    max_tokens: 700,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: JSON.stringify(payload) },
    ],
  });

  if (resp.choices[0]?.finish_reason === 'length') {
    // 잘린 답을 그대로 내보내면 문장이 끊긴 채 나간다.
    return {
      answer: '답이 길어져 끊겼습니다. 질문을 좀 더 좁혀서 다시 물어봐 주세요.',
      grounded: false,
      reason: 'outside_summary',
    };
  }

  const raw = resp.choices[0]?.message?.content ?? '';
  let answer = '';
  let reason: AskReason = 'outside_summary';
  try {
    const obj = JSON.parse(raw) as { answer?: unknown; reason?: unknown };
    answer = typeof obj.answer === 'string' ? obj.answer.trim() : '';
    if (!answer) throw new Error('empty answer');
    if (obj.reason === 'answered' || obj.reason === 'off_topic') reason = obj.reason;
  } catch {
    throw new Error('모델 응답을 해석하지 못했다');
  }

  /**
   * 자료 상태는 앱이 판단한다. 모델에게 맡겼더니 grounding 이 full 인 기사에도
   * "제목만 수집되어 있다"고 답했다 — 사실이 아닌데 읽는 사람은 자료가 부실한
   * 줄로 오해한다. grounding 은 우리가 아는 값이므로 여기서 덮어쓴다.
   */
  if (reason !== 'answered' && ctx.grounding === 'headline') {
    reason = 'headline_only';
  }

  return { answer, grounded: reason === 'answered', reason };
}
