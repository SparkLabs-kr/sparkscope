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

/** 채점 결과 — 중요도와 "국내 업계 소식인가". */
export interface Verdict {
  score: Importance;
  /** 국내(한국) 업계·정책 소식인가. 해외 소식을 한국 매체가 보도한 것은 false다. */
  domestic: boolean;
}

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
  '    제목에 종목 티커가 괄호로 붙어 있으면((NVDA), (MSFT), (GPRO)) 거의 항상 이 부류입니다.',
  '    "살 만한가", "목표주가", "지금 사도 되나", "실적 발표 후" 같은 표현도 같습니다.',
  '    (실측: "Snowflake와 C3.ai 중 살 만한 AI 주식은 하나뿐"이 5점을 받아 GPT-6 출시보다',
  '     위에 올라온 일이 있었다.)',
  '',
  '판단할 때:',
  '- 새 모델이나 가중치가 공개된 건은 높게 봅니다. 우리 독자가 가장 먼저 알아야 하는 것입니다.',
  '- 매체 이름으로 판단하지 마세요. 유명 매체의 칼럼보다 작은 매체의 모델 공개 소식이 중요합니다.',
  '- 제목이 모호하면 낮게 줍니다. 확실히 큰 일일 때만 4~5를 줍니다.',
  '- 같은 사안이 여러 건 있으면 각각 같은 점수를 줍니다.',
  '',
  '각 항목에 국내 여부(kr)도 표시합니다:',
  '  kr=true  한국 국내의 업계·정책·기관 소식. 한국 기업·정부·대학이 주인공인 건.',
  '           예: "R&D 예산 39조", "KAIST가 개발", "연구재단 통합", "국내 제약사 수출"',
  '  kr=false 해외에서 일어난 일. 한국 매체가 보도했어도 주인공이 해외면 false입니다.',
  '           예: "오픈AI가 GPT-6 공개", "구글 제미나이 3.8", "미스트랄 조달"',
  '           (한국 기업이 해외 건에 참여한 정도라면 false입니다 — 예: "삼성이 미스트랄에 투자")',
  '',
  '출력은 JSON 객체 하나입니다: {"scores":[{"i":0,"s":3,"kr":false},{"i":1,"s":5,"kr":true}, ...]}',
  'i는 입력에 준 번호, s는 1~5 정수, kr은 true/false입니다. 모든 항목에 빠짐없이 답합니다.',
].join('\n');

export interface Scorable { url: string; title: string }

async function readCache(urls: string[]): Promise<Map<string, Verdict>> {
  if (urls.length === 0) return new Map();
  // 기간이 긴 탭은 후보가 1,000건을 넘는다 — IN 목록을 나눠 던진다.
  const CHUNK = 500;
  const rows: { key: string; value: string }[] = [];
  for (let i = 0; i < urls.length; i += CHUNK) {
    rows.push(...await prisma.dashboardInsight.findMany({
      where: { kind: KIND, key: { in: urls.slice(i, i + CHUNK) } },
      select: { key: true, value: true },
    }));
  }
  const out = new Map<string, Verdict>();
  for (const r of rows) {
    try {
      // 옛 캐시는 점수 하나만 담긴 문자열("4")이다 — 국내 여부를 모르니 무시하고 다시 만든다.
      const v = JSON.parse(r.value);
      if (v && v.score >= 1 && v.score <= 5) out.set(r.key, { score: v.score, domestic: !!v.domestic });
    } catch { /* 옛 형식·깨진 캐시는 버린다 */ }
  }
  return out;
}

async function writeCache(pairs: { url: string; verdict: Verdict }[]): Promise<void> {
  // 건수가 많아 순차로 돌리면 왕복이 길어진다 — 동시에 던진다.
  await Promise.all(pairs.map(p =>
    prisma.dashboardInsight.upsert({
      where: { kind_key: { kind: KIND, key: p.url } },
      create: { kind: KIND, key: p.url, value: JSON.stringify(p.verdict) },
      update: { value: JSON.stringify(p.verdict) },
    }).catch(e => console.error('[news-importance] 캐시 저장 실패:', p.url, e))));
}

async function scoreBatch(batch: Scorable[]): Promise<Map<string, Verdict>> {
  const listing = batch.map((b, i) => `${i}. ${b.title}`).join('\n');
  const out = new Map<string, Verdict>();
  try {
    const res = await client().chat.completions.create({
      model: MODEL,
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: listing }],
      temperature: 0,
      response_format: { type: 'json_object' },
    });
    const raw = res.choices[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(raw) as { scores?: { i: number; s: number; kr?: boolean }[] };
    for (const { i, s, kr } of parsed.scores ?? []) {
      const item = batch[i];
      if (item && s >= 1 && s <= 5) {
        out.set(item.url, { score: Math.round(s) as Importance, domestic: !!kr });
      }
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
export async function scoreImportance(items: Scorable[]): Promise<Map<string, Verdict>> {
  const uniq = new Map<string, Scorable>();
  for (const it of items) if (it.url && it.title) uniq.set(it.url, it);
  const every = [...uniq.values()];

  // 캐시는 후보 전체에서 읽고, LLM에는 상한만큼만 보낸다.
  //
  // 예전에는 상한(MAX_CANDIDATES)으로 먼저 자르고 그 안에서만 캐시를 봤다. 그러면
  // 이미 점수가 있는 기사도 상한 밖이면 점수를 못 받아 기본값 3점으로 가라앉는다.
  // 2026-09-11 실측: 같은 사건이 '오늘' 탭에서는 CNBC판(5점) 대표로 2위였는데
  // '이번주' 탭에서는 CNBC판이 상한 밖이라 3점으로 밀리고 TechCrunch판(4점)만
  // 남아 10위에 떴다 — 탭에 따라 같은 사건의 등급이 달라졌다.
  //
  // 캐시 조회는 DB 한 번이고 LLM 비용이 없다. 기간이 길수록(7일·30일) 후보 대부분이
  // 이미 채점돼 있으므로, 전체를 읽는 편이 정확하고 값도 같다.
  const cached = await readCache(every.map(a => a.url)).catch(() => new Map<string, Verdict>());
  const todo = every.filter(a => !cached.has(a.url)).slice(0, MAX_CANDIDATES);
  if (todo.length === 0) return cached;

  const batches: Scorable[][] = [];
  for (let i = 0; i < todo.length; i += BATCH) batches.push(todo.slice(i, i + BATCH));
  // 묶음끼리 독립이라 한꺼번에 던진다. 한 묶음이 실패해도 나머지는 살아남는다.
  const results = await Promise.all(batches.map(scoreBatch));

  const fresh: { url: string; verdict: Verdict }[] = [];
  for (const m of results) for (const [url, verdict] of m) { cached.set(url, verdict); fresh.push({ url, verdict }); }
  if (fresh.length > 0) await writeCache(fresh);

  console.log(`[news-importance] ${fresh.length}건 새로 산정 (캐시 ${cached.size - fresh.length}건 / 후보 ${every.length}건)`);
  return cached;
}
