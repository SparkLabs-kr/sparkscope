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

/** 답의 출처. 화면이 "어디서 온 답인지"를 밝히는 데 쓴다. */
export type AskSource = 'article' | 'background' | 'mixed';
export type AskResult = { answer: string; source: AskSource; headlineOnly: boolean };

const SYSTEM = [
  '너는 스파크랩 미디어 인사이트(SparkScope)의 뉴스 도우미다.',
  '사용자가 기사를 읽다가 묻는다. 도움이 되게 답하는 것이 우선이다 —',
  '질문이 기사 밖의 것이어도(일반 지식, 배경 설명, 용어 풀이) 답해라.',
  '',
  '단 하나 지킬 것: 이 기사에 대한 사실을 지어내지 마라.',
  '  기사에 없는 수치·인용·날짜·인물·금액을 "기사에 따르면"처럼 말하면 안 된다.',
  '  그 기사에만 있는 구체적 사실을 모르면 모른다고 하고, 원문을 권해라.',
  '  일반 지식으로 배경을 설명하는 것은 얼마든지 좋다 — 다만 그것이 기사에서',
  '  온 것이 아니라는 점이 분명해야 한다.',
  '',
  '답은 3~6문장. 불릿은 쓰지 마라. 사용자가 쓴 언어로 답해라',
  '(한국어로 물으면 한국어, 영어로 물으면 영어).',
  '',
  '최신 사건은 네 학습 시점 이후일 수 있다. 확실하지 않으면 그렇다고 밝혀라.',
  '',
  '특정 종목을 사라/팔라는 개인 투자 조언은 하지 마라. 대신 무엇을 고려할지',
  '설명하고 판단은 사용자 몫이라고 밝혀라.',
  '',
  'JSON 으로만 답한다:',
  '{"answer": string, "source": "article"|"background"|"mixed"}',
  '',
  'source 는 답의 근거가 어디서 왔는지다:',
  '  article    : 주어진 기사 근거만으로 답했다.',
  '  background : 기사 밖 일반 지식으로 답했다.',
  '  mixed      : 둘을 섞었다.',
  '근거가 어떤 상태인지(제목만 있는지 등)는 쓰지 마라 — 앱이 붙인다.',
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
      source: 'background',
      headlineOnly: ctx.grounding === 'headline',
    };
  }

  const raw = resp.choices[0]?.message?.content ?? '';
  let answer = '';
  let source: AskSource = 'mixed';
  try {
    const obj = JSON.parse(raw) as { answer?: unknown; source?: unknown };
    answer = typeof obj.answer === 'string' ? obj.answer.trim() : '';
    if (!answer) throw new Error('empty answer');
    if (obj.source === 'article' || obj.source === 'background' || obj.source === 'mixed') {
      source = obj.source;
    }
  } catch {
    throw new Error('모델 응답을 해석하지 못했다');
  }

  /**
   * 자료 상태는 앱이 안다. 모델에게 서술하게 두면 근거가 충분한 기사에도
   * "제목만 수집되어 있다"고 말한 적이 있다. grounding 은 우리가 가진 값이다.
   */
  return { answer, source, headlineOnly: ctx.grounding === 'headline' };
}
