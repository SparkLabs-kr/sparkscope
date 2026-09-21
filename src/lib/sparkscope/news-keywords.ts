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
/**
 * 이름으로 쓰면 안 되는 말 — 나라·지역.
 *
 * 프롬프트에서 이미 "나라·도시 이름은 뽑지 않는다"고 막아 두었는데도 새어 나온다.
 * 실측(2026-09-21, 캐시 3,452건): 'China'가 회사 이름 자리에 4건 들어와 있었다.
 * 중국 회사 기사가 많다 보니 모회사(org)를 모를 때 'China'로 채운 것으로 보인다.
 *
 * 나라 이름은 거의 모든 기사에 나와서 "지금 무엇이 화제인가"를 말해 주지 않고,
 * 이름 합치기(foldNameVariants)에서도 'China Mobile'을 'China'로 끌어당기는
 * 엉뚱한 부모가 된다. 그래서 프롬프트에만 맡기지 않고 여기서 한 번 더 막는다.
 *
 * 캐시에 이미 들어간 것도 걸러야 하므로 추출 직후가 아니라 **돌려주기 직전**에 건다.
 * 그래야 지난 캐시를 지우지 않고도 화면에서 사라진다.
 *
 * 나라 이름이 그 자체로 주인공인 기사(예: 중국 정부의 규제)는 이 카드가 다룰 단위가
 * 아니다 — 그건 기사 목록에서 읽는다.
 */
const DROP_NAMES: ReadonlySet<string> = new Set([
  'china', 'korea', 'southkorea', 'northkorea', 'usa', 'us', 'unitedstates', 'america',
  'japan', 'taiwan', 'india', 'europe', 'eu', 'uk', 'unitedkingdom', 'britain',
  'germany', 'france', 'israel', 'canada', 'australia', 'singapore', 'russia',
  '한국', '중국', '미국', '일본', '대만', '유럽', '영국', '독일', '프랑스', '인도',
  '서울', '베이징', '도쿄', '실리콘밸리',
]);

/** 나라·지역 이름을 걸러낸다. 모회사만 나라면 그 이름 자체를 버린다. */
function dropPlaces(map: Map<string, Entity[]>): Map<string, Entity[]> {
  const out = new Map<string, Entity[]>();
  for (const [url, ents] of map) {
    out.set(url, ents.flatMap(e => {
      if (DROP_NAMES.has(keyOf(e.en))) return [];
      // 이름은 멀쩡한데 모회사만 나라인 경우 — 집계가 나라로 묶이지 않게 org만 비운다.
      if (e.org && DROP_NAMES.has(keyOf(e.org))) return [{ ...e, org: undefined, orgKo: undefined }];
      return [e];
    }));
  }
  return out;
}

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
  return dropPlaces(new Map([...cached, ...fresh]));
}

/**
 * ── 바이오 주제어 ──
 *
 * 바이오에서는 회사 이름만으로 기사와 커뮤니티가 이어지지 않는다. 실측으로 확인한
 * 어긋남이다(2026-09-18): 바이오 이름 카드 11개 중 8개가 반응 0건이었고, Bluesky를
 * 붙여 반응 자체를 늘린 뒤에도 카드는 3개 그대로였다. 연구자들이 회사 이름을
 * 쓰지 않기 때문이다 — Eric Topol은 "머크"가 아니라 "암 면역요법"이라고 쓰고,
 * bioRxiv 논문 제목에 제약사 이름이 나오는 일은 거의 없다.
 *
 * 그래서 바이오는 집계 단위를 하나 더 둔다. 회사가 아니라 **약물 계열·치료 방식·
 * 적응증**이다 — GLP-1, CAR-T, 이중항체, ADC, 알츠하이머, 비만. 기사 쪽에서는
 * "노보, 경구 GLP-1 계약", 커뮤니티 쪽에서는 "GLP-1이 심혈관에 주는 이점"으로
 * 나오므로 이 단위에서는 둘이 만난다.
 *
 * 회사 추출(extractEntities)을 대체하지 않고 더한다. 회사 카드도 신호가 붙으면
 * 그대로 남는다. 캐시는 kind를 갈라 두어 AI 쪽 추출과 섞이지 않는다.
 */
const TOPIC_KIND = 'news_topics';

const TOPIC_SYSTEM = [
  '당신은 바이오·제약 산업을 추적하는 벤처투자사의 리서치 담당입니다.',
  '기사·게시글 제목에서 "무엇에 대한 이야기인가"를 나타내는 주제어를 뽑습니다.',
  '',
  '뽑을 것 — 아래 세 가지뿐입니다.',
  '  · 약물 계열·기전: GLP-1, CAR-T, ADC, 이중항체, mRNA, siRNA, CRISPR, 유전자치료,',
  '    세포치료, 항체약물접합체, 마이크로바이옴, 방사성의약품',
  '  · 치료 영역·적응증: 비만, 알츠하이머, 췌장암, 유방암, 자가면역, 심혈관, 희귀질환,',
  '    당뇨, 우울증, 파킨슨, 코로나',
  '  · 산업 사건의 종류가 아니라 대상이 되는 기술: 단백질 구조예측, 신약 AI 설계',
  '',
  '뽑지 않을 것:',
  '  · 회사·기관·인물 이름 (그건 따로 뽑습니다)',
  '  · 너무 넓은 말 — 바이오, 제약, 신약, 임상, 의료, 헬스케어, 治療, 연구, 데이터',
  '    이건 거의 모든 제목에 나와서 "지금 무엇이 화제인가"를 말해 주지 않습니다.',
  '  · 임상 단계·규제 절차 — 1상, 3상, 승인, 허가, FDA, 특허',
  '  · 나라·도시, 숫자·금액',
  '',
  '같은 대상은 표기가 달라도 하나로 통일합니다. en에는 업계에서 쓰는 영문 표기를',
  '(GLP-1, CAR-T, Alzheimer, Obesity), ko에는 한국어 표기를 넣습니다.',
  '"비만치료제"와 "obesity drug"는 둘 다 {"en":"Obesity","ko":"비만"}입니다.',
  '"GLP-1 수용체 작용제"와 "GLP-1"은 둘 다 {"en":"GLP-1","ko":"GLP-1"}입니다 —',
  '수식어를 떼고 핵심어만 남깁니다. 갈라지면 매체 수가 나뉘어 둘 다 밀립니다.',
  '',
  '제목당 최대 2개, 해당 없으면 빈 배열입니다. 억지로 채우지 않습니다.',
  '바이오와 무관한 제목(일반 IT·정치·연예)은 반드시 빈 배열입니다.',
  '출력은 JSON 객체 하나입니다:',
  '{"items":[{"i":0,"e":[{"en":"GLP-1","ko":"GLP-1"}]},{"i":1,"e":[]}]}',
  'i는 입력에 준 번호입니다. 모든 항목에 빠짐없이 답합니다.',
].join('\n');

async function readTopicCache(urls: string[]): Promise<Map<string, Entity[]>> {
  if (urls.length === 0) return new Map();
  const rows = await prisma.dashboardInsight.findMany({
    where: { kind: TOPIC_KIND, key: { in: urls } },
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

async function extractTopicBatch(batch: Keywordable[]): Promise<Map<string, Entity[]>> {
  const listing = batch.map((b, i) => `${i}. ${b.title}`).join('\n');
  const out = new Map<string, Entity[]>();
  try {
    const res = await client().chat.completions.create({
      model: MODEL,
      messages: [{ role: 'system', content: TOPIC_SYSTEM }, { role: 'user', content: listing }],
      temperature: 0,
      response_format: { type: 'json_object' },
    });
    const parsed = JSON.parse(res.choices[0]?.message?.content ?? '{}') as
      { items?: { i: number; e?: { en?: string; ko?: string }[] }[] };
    for (const { i, e } of parsed.items ?? []) {
      const item = batch[i];
      if (!item) continue;
      out.set(item.url, (e ?? [])
        .filter(x => x?.en && x.en.trim().length > 1)
        .map(x => ({ en: x.en!.trim(), ko: (x.ko || x.en)!.trim() }))
        .slice(0, 2));
    }
  } catch (e) {
    console.error('[news-keywords] 주제어 추출 실패(무시):', e);
  }
  return out;
}

/** 바이오 주제어를 URL → 목록으로 돌려준다. 캐시·배치는 회사 추출과 같은 방식이다. */
export async function extractTopics(items: Keywordable[]): Promise<Map<string, Entity[]>> {
  const pool = items.slice(0, MAX_ARTICLES);
  if (pool.length === 0) return new Map();

  const cached = await readTopicCache(pool.map(i => i.url)).catch(() => new Map<string, Entity[]>());
  const missing = pool.filter(i => !cached.has(i.url));

  const fresh = new Map<string, Entity[]>();
  for (let i = 0; i < missing.length; i += BATCH) {
    for (const [url, ents] of await extractTopicBatch(missing.slice(i, i + BATCH))) fresh.set(url, ents);
  }
  if (fresh.size > 0) {
    console.log(`[news-keywords] 주제어 ${fresh.size}건 새로 추출 (캐시 ${cached.size}건)`);
    await Promise.all([...fresh.entries()].map(([url, entities]) =>
      prisma.dashboardInsight.upsert({
        where: { kind_key: { kind: TOPIC_KIND, key: url } },
        create: { kind: TOPIC_KIND, key: url, value: JSON.stringify(entities) },
        update: { value: JSON.stringify(entities) },
      }).catch(e => console.error('[news-keywords] 주제어 캐시 저장 실패:', url, e))));
  }
  return new Map([...cached, ...fresh]);
}

/**
 * 같은 회사가 긴 이름과 짧은 이름으로 갈라진 것을 하나로 합친다.
 *
 * 실제로 갈라졌다: '브리스톨 마이어스'(5건)와 '브리스톨 마이어스 스퀴브'(4건)가
 * 30일 카드에 나란히 떴다. 기사 집합이 겹치지 않아 foldSubEntities(기사 포함관계로
 * 접는 쪽)로는 잡히지 않는다.
 *
 * 그런데 "앞부분이 같으면 합친다"를 그냥 걸면 안 된다. 캐시 3,452건의 회사명 826개를
 * 훑어보니 그렇게 하면 안 되는 쌍이 더 많았다:
 *   Samsung ⊂ Samsung Electronics · Samsung Biologics · Samsung Life · Samsung SDS …
 *   SK      ⊂ SK Hynix · SK Biopharm · SK Square …
 *   LG      ⊂ LG CNS · LG AI Research · LG Uplus
 *   Universal ⊂ Universal Music · Universal Robots
 * 삼성바이오로직스와 삼성전자는 다른 회사다. 합치면 "삼성"이라는 쓸모없는 카드가 된다.
 *
 * 가르는 기준은 **긴 이름이 몇 개인가**다. 짧은 이름 뒤에 붙는 변형이 하나뿐이면
 * 표기 차이로 보고 합치고(Bristol Myers / Novo / Ionis / Vertex / Mistral),
 * 둘 이상이면 그룹사 이름으로 보고 손대지 않는다(Samsung / SK / LG / Universal).
 * 짧은 쪽이 3자 이하면(SK, LG) 애초에 제외한다 — 약어는 변형이 하나여도 위험하다.
 *
 * 남길 표기는 길이가 아니라 **언급이 많은 쪽**이다. 'Novo'(10건)와
 * 'Novo Nordisk'(16건)에서는 정식 명칭이, 'Bristol Myers'(5건)와
 * 'Bristol Myers Squibb'(4건)에서는 짧은 쪽이 남는다 — 사람들이 실제로 더 많이
 * 쓰는 표기가 화면에 나오는 편이 낫다.
 */
export function foldNameVariants(
  entries: { key: string; en: string; mentions: number }[],
): Map<string, string> {
  const remap = new Map<string, string>();
  if (entries.length < 2) return remap;

  // 구분자를 공백 하나로 맞춘 뒤에 비교한다. 같은 회사가 하이픈과 공백 양쪽으로
  // 오기 때문이다 — 실제 캐시에 'Bristol Myers Squibb'와 'Bristol-Myers Squibb'가
  // 함께 있었고, 원문 그대로 비교하면 'Bristol Myers'가 후자의 앞부분과 안 맞는다.
  const norm = (s: string) => s.trim().toLowerCase().replace(/[\s.,'’·-]+/g, ' ');
  // 짧은 이름 → 그것으로 시작하는 긴 이름들
  const variants = new Map<string, typeof entries>();
  for (const a of entries) {
    if (a.en.trim().length <= 3) continue;
    const pa = norm(a.en);
    const longer = entries.filter(b => {
      if (b.key === a.key) return false;
      const pb = norm(b.en);
      // 단어 경계에서 갈려야 한다 — 'Bio'와 'Biogen'은 같은 이름이 아니다.
      return pb.length > pa.length && pb.startsWith(pa) && /[\s&]/.test(pb[pa.length] ?? '');
    });
    if (longer.length === 1) variants.set(a.key, longer);
  }

  for (const [shortKey, [long]] of variants) {
    const short = entries.find(e => e.key === shortKey)!;
    // 이미 다른 이름으로 접힌 쪽은 건드리지 않는다 — 사슬로 엮이면 엉뚱한 곳에 붙는다.
    if (remap.has(shortKey) || remap.has(long!.key)) continue;
    const winner = long!.mentions > short.mentions ? long! : short;
    const loser = winner.key === shortKey ? long! : short;
    remap.set(loser.key, winner.key);
  }
  return remap;
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
  type Agg = { label: string; en: string; outlets: Set<string>; articles: number; top: number; url: string; rank: number };
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
          en: ent.org || ent.en,
          outlets: new Set([it.source]),
          articles: 1,
          top: it.importance ?? 0,
          url: it.url,
          rank: idx,
        });
      }
    }
  });

  // 긴 이름·짧은 이름으로 갈라진 같은 회사를 합친다(foldNameVariants 주석 참고).
  for (const [from, to] of foldNameVariants(
    [...agg].map(([key, a]) => ({ key, en: a.en, mentions: a.articles })),
  )) {
    const src = agg.get(from);
    const dst = agg.get(to);
    if (!src || !dst) continue;
    for (const o of src.outlets) dst.outlets.add(o);
    dst.articles += src.articles;
    dst.top = Math.max(dst.top, src.top);
    if (src.rank < dst.rank) { dst.rank = src.rank; dst.url = src.url; }
    agg.delete(from);
  }

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
