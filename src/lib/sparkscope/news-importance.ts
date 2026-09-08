/**
 * 기사 중요도 점수 — "이게 업계에 얼마나 큰 일인가".
 *
 * 왜 필요한가: 예전 순위는 ①함께 다룬 매체 수 → ②매체 등급 → ③최신순이었다.
 * 의도는 "여러 매체가 동시에 다뤘다 = 중요하다"였는데, ①이 거의 작동하지 않았다.
 * 실측(2026-09-08): 상위 12건 중 9건이 ①=0이고 12건 전부 tier 1이라, 순위가 사실상
 * "Reuters·FT가 오늘 올린 것 중 최신순"으로 붕괴했다. 그 결과
 *
 *   · GPT-6 Astra 출시(CNBC, tier 2)  → 목록에 없음
 *   · Claude Fable 5.1 공개(뉴스레터들) → 목록에 없음
 *   · "법대가 학생들에게 AI 쓰지 말라고 했다"(FT, tier 1) → 12위로 포함
 *
 * 중요도가 아니라 매체 등급과 발행 시각이 순위를 정하고 있었다.
 *
 * 그래서 제목을 보고 중요도를 1~5로 매기고, 그것을 1순위 정렬 기준으로 쓴다.
 * 후보 전체(100건 이상)를 한 번의 호출로 묶어 처리하고 URL 단위로 캐시하므로
 * 같은 기사에 두 번 과금되지 않는다.
 */
import OpenAI from 'openai';
import { prisma } from '@/lib/prisma';

let _openai: OpenAI | null = null;
const client = () => (_openai ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY! }));

const MODEL = 'gpt-4o-mini';
const KIND = 'news_importance';
/** 한 번의 LLM 호출에 넣을 제목 수. 제목만 보내므로 넉넉히 담을 수 있다. */
const BATCH = 40;
/** 점수를 매길 최대 후보 수. 이보다 많으면 최신순으로 자른다. */
const MAX_CANDIDATES = 160;

export type Importance = 1 | 2 | 3 | 4 | 5;

const SYSTEM = [
  '당신은 AI·바이오 산업을 추적하는 벤처투자사의 리서치 담당입니다.',
  '기사 제목 목록을 보고 각 건이 그 산업에 얼마나 큰 일인지 1~5로 매깁니다.',
  '',
  '기준:',
  '  5 판도를 바꾸는 일. 주요 AI 모델·가중치 공개(GPT·Claude·Gemini·Llama·Qwen 등),',
  '    조 단위 인수합병, 규제 확정, 획기적 임상 결과.',
  '  4 큰 자금 조달(수천억 원 이상), 주요 제품·플랫폼 출시, 대형 소송 제기,',
  '    빅테크의 전략 전환, 주요 인물의 이직·퇴사.',
  '  3 의미 있는 발표. 중견 기업 조달, 파트너십, 신규 데이터센터·설비 투자,',
  '    주목할 연구 결과.',
  '  2 일반 업계 소식. 실적 발표, 지수·주가 동향, 지역 단위 소식.',
  '  1 개별 사안이 아닌 글. 오피니언·칼럼, 사용법·팁, 일반론, 전망·설문,',
  '    "AI가 일자리를 바꾼다" 류의 총평.',
  '    개별 종목 투자 판단 글도 1입니다 — "어느 AI 주식을 사야 하나", "실적 발표 후',
  '    이 종목이 유망하다" 류. 산업에서 일어난 사건이 아니라 투자 조언입니다.',
  '    (실측: Yahoo Finance의 "Snowflake와 C3.ai 중 살 만한 AI 주식은 하나뿐"이',
  '     5점을 받아 GPT-6 출시보다 위에 올라온 일이 있었다.)',
  '',
  '판단할 때:',
  '- 새 모델이나 가중치가 공개된 건은 높게 봅니다. 우리 독자가 가장 먼저 알아야 하는 것입니다.',
  '- 매체 이름으로 판단하지 마세요. 유명 매체의 칼럼보다 작은 매체의 모델 공개 소식이 중요합니다.',
  '- 제목이 모호하면 낮게 줍니다. 확실히 큰 일일 때만 4~5를 줍니다.',
  '- 같은 사안이 여러 건 있으면 각각 같은 점수를 줍니다.',
  '',
  '출력은 JSON 객체 하나입니다: {"scores":[{"i":0,"s":3},{"i":1,"s":5}, ...]}',
  'i는 입력에 준 번호, s는 1~5 정수입니다. 모든 항목에 대해 빠짐없이 답합니다.',
].join('\n');

export interface Scorable { url: string; title: string }

async function readCache(urls: string[]): Promise<Map<string, Importance>> {
  if (urls.length === 0) return new Map();
  const rows = await prisma.dashboardInsight.findMany({
    where: { kind: KIND, key: { in: urls } },
    select: { key: true, value: true },
  });
  const out = new Map<string, Importance>();
  for (const r of rows) {
    const n = Number(r.value);
    if (n >= 1 && n <= 5) out.set(r.key, n as Importance);
  }
  return out;
}

async function writeCache(pairs: { url: string; score: Importance }[]): Promise<void> {
  // 건수가 많아 순차로 돌리면 왕복이 길어진다 — 동시에 던진다.
  await Promise.all(pairs.map(p =>
    prisma.dashboardInsight.upsert({
      where: { kind_key: { kind: KIND, key: p.url } },
      create: { kind: KIND, key: p.url, value: String(p.score) },
      update: { value: String(p.score) },
    }).catch(e => console.error('[news-importance] 캐시 저장 실패:', p.url, e))));
}

async function scoreBatch(batch: Scorable[]): Promise<Map<string, Importance>> {
  const listing = batch.map((b, i) => `${i}. ${b.title}`).join('\n');
  const out = new Map<string, Importance>();
  try {
    const res = await client().chat.completions.create({
      model: MODEL,
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: listing }],
      temperature: 0,
      response_format: { type: 'json_object' },
    });
    const raw = res.choices[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(raw) as { scores?: { i: number; s: number }[] };
    for (const { i, s } of parsed.scores ?? []) {
      const item = batch[i];
      if (item && s >= 1 && s <= 5) out.set(item.url, Math.round(s) as Importance);
    }
  } catch (e) {
    console.error('[news-importance] 점수 산정 실패(해당 묶음 건너뜀):', e);
  }
  return out;
}

/**
 * 후보 전체에 중요도를 매긴다. 캐시에 있는 것은 건너뛴다.
 * 실패하거나 빠진 항목은 Map에 없고, 호출부가 기본값으로 처리한다.
 */
export async function scoreImportance(items: Scorable[]): Promise<Map<string, Importance>> {
  const uniq = new Map<string, Scorable>();
  for (const it of items) if (it.url && it.title) uniq.set(it.url, it);
  const all = [...uniq.values()].slice(0, MAX_CANDIDATES);

  const cached = await readCache(all.map(a => a.url)).catch(() => new Map<string, Importance>());
  const todo = all.filter(a => !cached.has(a.url));
  if (todo.length === 0) return cached;

  const batches: Scorable[][] = [];
  for (let i = 0; i < todo.length; i += BATCH) batches.push(todo.slice(i, i + BATCH));
  // 묶음끼리 독립이라 한꺼번에 던진다. 한 묶음이 실패해도 나머지는 살아남는다.
  const results = await Promise.all(batches.map(scoreBatch));

  const fresh: { url: string; score: Importance }[] = [];
  for (const m of results) for (const [url, score] of m) { cached.set(url, score); fresh.push({ url, score }); }
  if (fresh.length > 0) await writeCache(fresh);

  console.log(`[news-importance] ${fresh.length}건 새로 산정 (캐시 ${all.length - todo.length}건)`);
  return cached;
}
