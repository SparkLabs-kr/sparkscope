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

export type AskResult = { answer: string; grounded: boolean };

const SYSTEM = [
  '너는 스파크랩 미디어 인사이트(SparkScope)의 뉴스 도우미다.',
  '사용자가 지금 읽고 있는 기사 하나에 대해 묻는다. 주어진 근거만으로 답한다.',
  '',
  '규칙:',
  '1. 근거에 없는 사실을 만들지 마라. 숫자·인용·날짜·인물은 특히 그렇다.',
  '2. 답할 수 없을 때는 "왜" 답할 수 없는지를 정확히 말해라. 두 경우는 다르다:',
  '   (a) grounding 이 "headline" 이면 제목과 매체명밖에 없다 →',
  '       "이 항목은 제목만 수집되어 있어 내용을 답할 수 없다"고 말해라.',
  '   (b) 요약은 있는데 질문이 그 범위 밖이면 →',
  '       "수집된 요약에는 그 내용이 없다"고 말해라. 제목만 있다고',
  '       하지 마라 — 사실이 아니고, 읽는 사람이 자료 상태를 오해한다.',
  '   어느 쪽이든 원문 링크를 권하고, 추측해서 채우지 마라.',
  '3. 사과나 변명은 짧게.',
  '4. 답은 3~5문장. 불릿은 쓰지 마라. 사용자가 쓴 언어로 답해라',
  '   (한국어로 물으면 한국어, 영어로 물으면 영어).',
  '5. 기사 밖의 일반 지식은, 그것이 배경 설명으로 분명히 도움이 될 때만',
  '   덧붙이고 "기사에 나온 내용은 아니다"라고 밝혀라.',
  '',
  'JSON 으로만 답한다: {"answer": string, "grounded": boolean}',
  'grounded 는 주어진 근거만으로 답했으면 true, 답할 수 없었으면 false.',
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
    };
  }

  const raw = resp.choices[0]?.message?.content ?? '';
  try {
    const obj = JSON.parse(raw) as { answer?: unknown; grounded?: unknown };
    const answer = typeof obj.answer === 'string' ? obj.answer.trim() : '';
    if (!answer) throw new Error('empty answer');
    return { answer, grounded: obj.grounded === true };
  } catch {
    throw new Error('모델 응답을 해석하지 못했다');
  }
}
