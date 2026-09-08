/**
 * Hugging Face 모델 한 줄 설명 — "이게 뭐고 왜 쓰이는가".
 *
 * 왜 필요한가: HF 항목은 제목이 모델 id다. "Qwopus3.8-27B-Flash-GGUF"만 보면
 * 무슨 모델인지, 60,343번 다운로드된 이유가 뭔지 알 수 없다. 이름을 읽을 수 있는
 * 사람은 이미 그 모델을 아는 사람뿐이라, 목록으로서 쓸모가 없다.
 *
 * 근거는 모델 카드(README) 앞부분과 태그·다운로드 수다. 카드가 부실하면 태그만으로
 * 쓸 수 있는 만큼만 쓰고, 없는 사실을 지어내지 않는다.
 *
 * 한 번 만들면 SocialSignal.blurb에 남고 다시 만들지 않는다 — 모델 설명은 바뀌지 않으므로
 * 같은 모델에 두 번 과금될 이유가 없다.
 */
import OpenAI from 'openai';
import { prisma } from '@/lib/prisma';

let _openai: OpenAI | null = null;
const client = () => (_openai ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY! }));

const MODEL = 'gpt-4o-mini';
/** 한 번의 크론 회차에서 새로 설명할 최대 개수. 나머지는 다음 회차가 채운다. */
const MAX_NEW = 12;
/** 모델 카드에서 넘길 앞부분 길이 — 뒤쪽은 대개 벤치마크 표라 설명에 도움이 안 된다. */
const CARD_CHARS = 1800;

const SYSTEM = [
  '당신은 AI 모델 카드를 읽고 한국어 한 줄 설명을 쓰는 편집자입니다.',
  '',
  '읽는 사람은 AI 업계 종사자지만 이 모델은 처음 봅니다. 두 가지를 알려주세요:',
  '  (1) 무엇을 하는 모델인가 — 입력과 출력, 크기, 용도',
  '  (2) 왜 쓰이는가 — 무엇이 특별해서 사람들이 받아 가는가',
  '',
  '규칙:',
  '- 한국어 1~2문장, 120자 이내.',
  '- 모델 이름을 그대로 반복하지 마세요. 이미 제목에 있습니다.',
  '- 파라미터 수는 영문 표기를 그대로 두세요(27B, 7B, A4B). 한국어 단위로 바꾸지 마세요 —',
  '  "36B"를 "36억"으로 쓰면 틀립니다(360억이 맞습니다). 이 실수가 실제로 있었습니다.',
  '- 자료에 없는 성능 수치·순위·비교를 지어내지 마세요. 카드가 부실하면',
  '  태그에서 확실한 것만 쓰고 짧게 끝냅니다. 분량을 채우려고 추측하는 것이 가장 나쁩니다.',
  '- 파생 모델(GGUF·양자화·파인튜닝)이면 원본이 무엇이고 무엇을 바꿨는지 밝히세요.',
  '  GGUF는 개인 PC에서 돌리기 위한 형식이고, 양자화는 메모리를 줄이는 대신 정밀도를 낮춥니다.',
  '- 영어 고유명사(Qwen, Llama, vLLM)는 그대로 둡니다.',
  '',
  '출력은 설명 문장 하나뿐입니다. 따옴표나 접두어를 붙이지 마세요.',
].join('\n');

/** 모델 카드 앞부분. 없으면 null — 카드가 없는 리포도 흔하다. */
async function fetchCard(modelId: string): Promise<string | null> {
  try {
    const res = await fetch(`https://huggingface.co/${modelId}/raw/main/README.md`, {
      headers: { 'User-Agent': 'SparkScope/1.0' },
      next: { revalidate: 86400 },
    });
    if (!res.ok) return null;
    const raw = await res.text();
    // 앞머리 YAML(--- ... ---)에는 태그가 들어 있어 유용하므로 지우지 않고 함께 넘긴다.
    return raw.slice(0, CARD_CHARS);
  } catch {
    return null;
  }
}

async function writeBlurb(modelId: string, card: string | null, downloads: number, likes: number): Promise<string | null> {
  const facts = [
    `모델 id: ${modelId}`,
    `다운로드: ${downloads.toLocaleString()} · 좋아요: ${likes.toLocaleString()}`,
    card ? `모델 카드(앞부분):\n${card}` : '모델 카드 없음 — id와 수치만으로 판단하세요.',
  ].join('\n');

  try {
    const res = await client().chat.completions.create({
      model: MODEL,
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: facts }],
      temperature: 0.2,
      max_tokens: 200,
    });
    const text = res.choices[0]?.message?.content?.trim();
    if (!text || text.length <= 5) return null;
    const clean = text.replace(/^["'\s]+|["'\s]+$/g, '');
    // 길이를 넘기면 문장 경계에서 자른다 — 배너 한 줄에 들어가야 한다.
    if (clean.length <= 140) return clean;
    const cut = clean.slice(0, 140);
    const lastStop = cut.lastIndexOf('.');
    return (lastStop > 60 ? cut.slice(0, lastStop + 1) : cut.trimEnd() + '…');
  } catch (e) {
    console.error('[hf-blurb] 생성 실패:', modelId, e);
    return null;
  }
}

/**
 * 설명이 비어 있는 HF 항목을 채운다. 남으면 다음 회차가 이어서 처리한다.
 * 실패해도 조용히 넘긴다 — 설명이 없다고 목록이 안 나가면 안 된다.
 */
export async function fillHfBlurbs(limit = MAX_NEW): Promise<number> {
  const rows = await prisma.socialSignal.findMany({
    where: { source: { in: ['hf', 'hf_new'] }, blurb: null },
    // 최근 것부터 — 화면 위쪽에 뜨는 것이 먼저 설명이 붙어야 체감이 된다.
    orderBy: { lastSeenAt: 'desc' },
    take: limit,
    select: { id: true, externalId: true, points: true, pointsLabel: true },
  });
  if (rows.length === 0) return 0;

  let filled = 0;
  for (const r of rows) {
    const card = await fetchCard(r.externalId);
    const dl = r.pointsLabel === '다운로드' ? r.points : 0;
    const likes = r.pointsLabel === '좋아요' ? r.points : 0;
    const blurb = await writeBlurb(r.externalId, card, dl, likes);
    if (!blurb) continue;
    try {
      await prisma.socialSignal.update({ where: { id: r.id }, data: { blurb } });
      filled++;
    } catch (e) {
      console.error('[hf-blurb] 저장 실패:', r.externalId, e);
    }
  }
  if (filled > 0) console.log(`[hf-blurb] ${filled}/${rows.length}건 설명 생성`);
  return filled;
}
