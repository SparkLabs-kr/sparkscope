/**
 * 지금 업계가 무엇을 말하고 있나 — 여러 매체에 공통으로 등장한 이름을 뽑는다.
 *
 * 왜 필요한가: 지금 순위는 "기사 단위"로 매긴다. 그런데 하나의 큰 사안이 서로 다른
 * 기사 여러 건으로 흩어지면(임상 실패 + 주가 하락 + 인수 후폭풍 + 경쟁사 반응)
 * 사건 병합이 그걸 다 묶어 주지 못하는 한 각각은 평범한 기사로 보인다.
 * 이름 단위로 세면 그 흩어짐이 오히려 증거가 된다 — 노바티스가 여덟 매체에 걸쳐
 * 다섯 건으로 나온다면, 기사 하나하나보다 "노바티스"가 더 정확한 신호다.
 *
 * 세는 단위는 "기사 수"가 아니라 "매체 수"다. 한 매체가 같은 회사를 다섯 번 쓰는 건
 * 그 매체의 편집 성향이지 업계 동향이 아니다. 서로 다른 매체가 동시에 같은 이름을
 * 말할 때만 동향이다 — 1면 합의를 매체 수로 세는 것과 같은 이유다.
 *
 * 이름 뽑기는 LLM으로 한다. 형태소·정규식으로는 안 된다:
 *   · 한국어와 영어가 섞여 있어 "Novartis"와 "노바티스"를 같은 것으로 봐야 한다.
 *   · "GPT-6 아스트라"·"Qwen3.8-Flash-Next"처럼 토큰 경계가 불규칙하다.
 *   · 조사·활용이 붙는다("노바티스가", "노바티스의").
 * URL 단위로 캐시하므로 같은 기사에 두 번 과금되지 않는다.
 */
import OpenAI from 'openai';
import { prisma } from '@/lib/prisma';

let _openai: OpenAI | null = null;
const client = () => (_openai ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY! }));

const MODEL = 'gpt-4o-mini';
const KIND = 'news_entities';
const BATCH = 40;
/** 이름을 뽑을 최대 기사 수. 후보가 이보다 많으면 앞쪽(중요도 순)만 본다. */
const MAX_ARTICLES = 160;

/**
 * 한 기사에서 뽑은 이름. en은 집계 키, ko는 화면 표기다.
 *
 * org는 그 이름을 소유한 회사다. 제품과 회사가 갈라지면 같은 곳의 소식이 카드 둘로
 * 쪼개진다 — "챗GPT 이미지 2.5 공개"와 "오픈AI, 사이버방어 투자"가 별개 이름으로
 * 집계돼 각각 매체 수가 반으로 나뉘었다(2026-09-09). 회사 단위로 보기로 했으므로
 * 집계는 항상 org로 한다.
 */
interface Entity { en: string; ko: string; org?: string; orgKo?: string }

export interface TrendKeyword {
  /** 화면에 보여줄 이름 — 한국어가 있으면 한국어. */
  label: string;
  /** 집계 키(영문 정규명). 같은 대상의 한/영 표기를 하나로 묶는다. */
  key: string;
  /** 이 이름을 다룬 서로 다른 매체 수. 순위의 기준이다. */
  outlets: number;
  /** 기사 수. 같은 매체가 여러 건 쓴 것도 센다 — 참고용이고 순위 기준은 아니다. */
  articles: number;
  /** 이 이름이 나온 기사들의 최고 중요도. */
  topImportance: number;
  /** 대표 기사 URL — 키워드를 눌렀을 때 갈 곳. */
  url: string;
}

const SYSTEM = [
  '당신은 AI·바이오 산업을 추적하는 벤처투자사의 리서치 담당입니다.',
  '기사 제목 목록에서 각 제목의 "주인공"에 해당하는 고유명사를 뽑습니다.',
  '',
  '뽑을 것: 회사·기관 이름(노바티스, OpenAI, KAIST), 제품·모델·약물 이름',
  '  (GPT-6 아스트라, 제미나이 3.8, Imdelltra), 주요 인물 이름.',
  '',
  '뽑지 않을 것:',
  '  · 산업·기술 일반명사 — AI, 인공지능, 바이오, 제약, 임상, 신약, 데이터센터, LLM',
  '  · 규제기관·정부 일반 — FDA, 식약처, 정부, 국회 (그 기관 자체가 주인공인 기사만 예외)',
  '  · 나라·도시 이름, 숫자·금액',
  '이것들은 거의 모든 기사에 나와서 뽑아 봐야 "지금 무엇이 화제인가"를 말해 주지 않습니다.',
  '',
  '같은 대상은 표기가 달라도 하나로 통일합니다. en에는 국제적으로 통용되는 영문 표기를',
  '(Novartis, OpenAI, AstraZeneca), ko에는 한국어 표기를 넣습니다. 한국어 표기가 없으면',
  'ko에도 영문을 그대로 넣습니다. 제목이 한국어여도 en은 반드시 영문이어야 합니다 —',
  '"노바티스"와 "Novartis"가 갈라지면 매체 수를 셀 수 없습니다.',
  '',
  '제품·모델·약물 이름에는 그것을 만든 회사를 org(영문)·orgKo(한국어)에 함께 넣습니다.',
  '  예: {"en":"ChatGPT","ko":"챗GPT","org":"OpenAI","orgKo":"오픈AI"}',
  '  예: {"en":"Claude","ko":"클로드","org":"Anthropic","orgKo":"앤트로픽"}',
  '  예: {"en":"Gemini 3.8 Flash","ko":"제미나이 3.8 플래시","org":"Google","orgKo":"구글"}',
  '  예: {"en":"Imdelltra","ko":"임델트라","org":"Amgen","orgKo":"암젠"}',
  '이름 자체가 회사면 org에 자기 자신을 넣습니다.',
  '  예: {"en":"OpenAI","ko":"오픈AI","org":"OpenAI","orgKo":"오픈AI"}',
  '모회사를 모르면 org를 비웁니다 — 지어내지 않습니다.',
  '',
  '줄임말이 아니라 정식 명칭을 씁니다 — "아스트라"가 아니라 "GPT-6 아스트라",',
  '"Qwen"이 아니라 "Qwen3.8-Flash-Next"입니다. 같은 대상이 줄임말과 정식 명칭으로',
  '갈라지면 매체 수가 반씩 나뉘어 둘 다 순위에서 밀립니다.',
  '',
  '제목당 최대 3개, 없으면 빈 배열입니다. 억지로 채우지 않습니다.',
  '출력은 JSON 객체 하나입니다:',
  '{"items":[{"i":0,"e":[{"en":"Novartis","ko":"노바티스","org":"Novartis","orgKo":"노바티스"}]},{"i":1,"e":[]}]}',
  'i는 입력에 준 번호입니다. 모든 항목에 빠짐없이 답합니다.',
].join('\n');

export interface Keywordable {
  url: string;
  title: string;
  source: string;
  importance?: number | null;
}

async function readCache(urls: string[]): Promise<Map<string, Entity[]>> {
  if (urls.length === 0) return new Map();
  const rows = await prisma.dashboardInsight.findMany({
    where: { kind: KIND, key: { in: urls } },
    select: { key: true, value: true },
  });
  const out = new Map<string, Entity[]>();
  for (const r of rows) {
    try {
      const v = JSON.parse(r.value);
      if (Array.isArray(v)) out.set(r.key, v);
    } catch { /* 깨진 캐시는 다시 만든다 */ }
  }
  return out;
}

async function writeCache(pairs: { url: string; entities: Entity[] }[]): Promise<void> {
  await Promise.all(pairs.map(p =>
    prisma.dashboardInsight.upsert({
      where: { kind_key: { kind: KIND, key: p.url } },
      create: { kind: KIND, key: p.url, value: JSON.stringify(p.entities) },
      update: { value: JSON.stringify(p.entities) },
    }).catch(e => console.error('[news-keywords] 캐시 저장 실패:', p.url, e))));
}

async function extractBatch(batch: Keywordable[]): Promise<Map<string, Entity[]>> {
  const listing = batch.map((b, i) => `${i}. ${b.title}`).join('\n');
  const out = new Map<string, Entity[]>();
  try {
    const res = await client().chat.completions.create({
      model: MODEL,
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: listing }],
      temperature: 0,
      response_format: { type: 'json_object' },
    });
    const parsed = JSON.parse(res.choices[0]?.message?.content ?? '{}') as
      { items?: { i: number; e?: { en?: string; ko?: string; org?: string; orgKo?: string }[] }[] };
    for (const { i, e } of parsed.items ?? []) {
      const item = batch[i];
      if (!item) continue;
      const ents = (e ?? [])
        .filter(x => x?.en && x.en.trim().length > 1)
        .map(x => ({
          en: x.en!.trim(),
          ko: (x.ko || x.en)!.trim(),
          org: x.org?.trim() || undefined,
          orgKo: x.orgKo?.trim() || undefined,
        }))
        .slice(0, 3);
      out.set(item.url, ents);
    }
  } catch (e) {
    console.error('[news-keywords] 추출 실패(무시):', e);
  }
  return out;
}

/**
 * 항목별로 이름을 뽑아 URL → 이름 목록으로 돌려준다.
 *
 * 기사에도 커뮤니티 글에도 같은 함수를 쓴다 — 그래야 양쪽에서 나온 이름이 같은 키로
 * 묶여서 "이 회사에 대한 기사와 반응"을 한 카드에 모을 수 있다(entity-cards.ts).
 * URL 단위 캐시라 같은 항목에 두 번 과금되지 않는다.
 */
export async function extractEntities(items: Keywordable[]): Promise<Map<string, Entity[]>> {
  const pool = items.slice(0, MAX_ARTICLES);
  if (pool.length === 0) return new Map();

  const cached = await readCache(pool.map(i => i.url)).catch(() => new Map<string, Entity[]>());
  const missing = pool.filter(i => !cached.has(i.url));

  const fresh = new Map<string, Entity[]>();
  for (let i = 0; i < missing.length; i += BATCH) {
    const got = await extractBatch(missing.slice(i, i + BATCH));
    for (const [url, ents] of got) fresh.set(url, ents);
  }
  if (fresh.size > 0) {
    console.log(`[news-keywords] ${fresh.size}건 새로 추출 (캐시 ${cached.size}건)`);
    await writeCache([...fresh.entries()].map(([url, entities]) => ({ url, entities })));
  }
  return new Map([...cached, ...fresh]);
}

/** 집계 키 — 대소문자·공백 차이로 갈라지지 않게 정규화한다. */
export const keyOf = (en: string) => en.toLowerCase().replace(/[\s.,'’-]+/g, '');
export type { Entity };

/**
 * 후보 기사들에서 "여러 매체가 함께 말한 이름"을 뽑는다.
 * 실패하면 빈 배열을 준다 — 키워드 줄이 비어도 목록은 나가야 한다.
 */
export async function extractTrendKeywords(items: Keywordable[], limit = 8): Promise<TrendKeyword[]> {
  if (items.length === 0) return [];
  const pool = items.slice(0, MAX_ARTICLES);
  const byUrl = await extractEntities(pool);

  // 매체 수로 센다 — 한 매체가 같은 이름을 여러 번 쓰는 건 편집 성향이지 동향이 아니다.
  type Agg = { label: string; outlets: Set<string>; articles: number; top: number; url: string; rank: number };
  const agg = new Map<string, Agg>();
  pool.forEach((it, idx) => {
    for (const ent of byUrl.get(it.url) ?? []) {
      // 집계는 모회사로 한다 — 제품과 회사가 갈라지면 매체 수가 반으로 나뉜다.
      const k = keyOf(ent.org || ent.en);
      if (!k) continue;
      const cur = agg.get(k);
      if (cur) {
        cur.outlets.add(it.source);
        cur.articles++;
        cur.top = Math.max(cur.top, it.importance ?? 0);
        // 대표는 더 앞선(= 더 중요한) 기사로 둔다. pool은 이미 순위대로 들어온다.
        if (idx < cur.rank) { cur.rank = idx; cur.url = it.url; }
      } else {
        agg.set(k, {
          label: ent.orgKo || ent.org || ent.ko || ent.en,
          outlets: new Set([it.source]),
          articles: 1,
          top: it.importance ?? 0,
          url: it.url,
          rank: idx,
        });
      }
    }
  });

  return [...agg.entries()]
    .map(([key, a]) => ({
      key,
      label: a.label,
      outlets: a.outlets.size,
      articles: a.articles,
      topImportance: a.top,
      url: a.url,
    }))
    // 한 매체에서만 나온 이름은 뺀다 — "여러 매체가 함께"가 이 기능의 전제다.
    .filter(k => k.outlets >= 2)
    .sort((a, b) =>
      b.outlets - a.outlets ||
      b.topImportance - a.topImportance ||
      b.articles - a.articles)
    .slice(0, limit);
}
