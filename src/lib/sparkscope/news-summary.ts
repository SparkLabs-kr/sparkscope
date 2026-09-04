/**
 * 쉬운 말 요약 — 기사를 "그래서 무슨 얘기인가"로 풀어 준다. 한국어·영어, 짧게·길게.
 *
 * 읽는 사람을 업계 종사자로 가정하지 않는다. 약어(KRAS, ADC, EGFR)나 업계 관용어를
 * 그대로 두면 제목을 다시 읽는 것과 다를 게 없어서, 한 번은 풀어 쓰게 한다.
 *
 * 근거는 제목 + 매체가 피드에 함께 실은 한 줄 설명(blurb)뿐이다. RSS는 본문을 주지 않고,
 * 기사 본문을 긁어와 그대로 싣는 것은 유료 매체(FT·WSJ·STAT+)의 이용약관에 어긋난다.
 * 그래서 "기사 대신 읽는 글"이 아니라 "원문을 열기 전에 맥락을 잡는 글"로 쓴다 —
 * 프롬프트에서 근거에 없는 수치·날짜를 만들지 말라고 막고, 화면은 항상 원문 링크를 같이 준다.
 *
 * 캐시는 DashboardInsight(kind='news_plain') — kind/key/JSON 범용 캐시가 이미 있어서
 * 요약 때문에 테이블이나 컬럼을 새로 만들지 않았다. 같은 기사에 두 번 과금되지 않는다.
 */
import OpenAI from 'openai';
import { prisma } from '@/lib/prisma';
import type { DigestItem } from './news-digest';

let _openai: OpenAI | null = null;
const client = () => (_openai ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY! }));

const MODEL = 'gpt-4o-mini';
const KIND = 'news_plain';
/** 한 번의 조회에서 새로 요약할 최대 건수. 나머지는 다음 조회가 채운다. */
const MAX_NEW = 12;
/** 한 기사당 넘길 원문 발췌 상한. */
const SOURCE_CHARS = 2000;
/**
 * 한 번의 LLM 호출에 넣을 기사 수 = 1.
 *
 * 처음에는 12건을 한 번에 보냈다가 응답이 max_tokens에서 잘려 그 배치가 통째로
 * 요약 0건이 됐다(bio 1일·7일). 4건으로 줄였더니 이번에는 개수가 자꾸 어긋났다 —
 * 4건을 넣었는데 3건, 5건, 8건이 돌아왔다. 기사마다 문단 배열이 중첩돼 있어서
 * 모델이 바깥 배열 길이를 헷갈린다. 어느 항목이 빠졌는지 알 수 없으니 묶음을 버려야 했다.
 *
 * 1건씩 보내면 그 문제가 원천적으로 없다. 호출 수는 늘지만 요약은 기사 URL 단위로
 * 캐시되므로 같은 기사에 다시 들지 않고, 한 번의 요청도 훨씬 작아 잘릴 일이 없다.
 */
const BATCH = 1;
/** 모델이 제목에 실제 줄바꿈을 섞어 보내면 JSON.parse가 깨진다 — 제어문자를 공백으로. */
const CONTROL_CHARS = new RegExp('[' + '\\u0000-\\u001f' + ']', 'g');

/**
 * koLong·enLong은 문단 배열이다.
 * 처음에는 "\n\n로 구분한 문자열"로 받았는데 모델이 세 문단을 한 문단으로 뭉쳐 보냈다.
 * 배열로 만들면 문단 수가 구조로 강제돼서 뭉개지지 않는다.
 */
export type Summary = { titleKo: string; ko: string; en: string; koLong: string[]; enLong: string[] };

const SYSTEM = [
  '당신은 뉴스를 일반 독자에게 풀어 설명하는 에디터입니다.',
  '입력은 기사 제목·매체명과, 있으면 원문 발췌(sourceText)입니다.',
  '',
  '각 기사마다 다섯 가지를 씁니다:',
  '  titleKo 기사 제목의 한국어판. 뉴스 헤드라인처럼 간결하게, 한 줄로.',
  '          회사·제품명은 통용 표기를 그대로 둡니다(Nvidia, Hugging Face, OpenAI…).',
  '          내용을 더하지 말고 제목이 말하는 것만 옮깁니다. 매체명 접미사(- Reuters)는 뺍니다.',
  '  ko    한국어 2문장. 무슨 일인지 + 왜 중요한지.',
  '  en    같은 내용의 영어 2문장. ko의 번역이 아니라 영어로 자연스럽게 쓴 같은 요약.',
  '  koLong 한국어 문단 3개를 담은 배열 ["1문단","2문단","3문단"]. 반드시 3개입니다.',
  '         1문단 — 무슨 일이 있었는가. 누가 무엇을 했고 규모·시점은 어떤지.',
  '         2문단 — 왜 중요한가. 이 분야·시장에 어떤 의미인지.',
  '         3문단 — 배경. 등장하는 회사·기술·질환이 무엇인지, 모르는 사람이 알아야 할 맥락.',
  '         각 문단 2~4문장. ko의 두 문장을 그대로 반복하지 말고 더 자세히 씁니다.',
  '  enLong 같은 구성의 영어 문단 3개 배열.',
  '',
  '규칙:',
  '- 업계 약어와 전문 용어는 반드시 한 번 풀어 씁니다 (KRAS는 암 유발 유전자, EGFR은 상피 성장 인자 수용체,',
  '  ADC는 항체-약물 접합체, IPO는 기업공개, FDA는 미국 식품의약국 등).',
  '- 주어와 목적어를 절대 바꾸지 마세요. "A가 B를 지지한다"를 "B가 A를 지지한다"로 쓰면 사실이 뒤집힙니다.',
  '- 주어진 자료에 없는 사실을 지어내지 마세요. 금액·날짜·수치·인명은 자료에 있는 것만 씁니다.',
  '  3문단의 배경 설명은 널리 알려진 일반 상식까지만 쓰고, 확실하지 않으면 그 문단을 짧게 끝냅니다.',
  '  분량을 채우려고 추측을 덧붙이는 것이 가장 나쁜 실패입니다.',
  '- 원문 문장을 그대로 옮겨 쓰지 마세요. 직접 인용은 하지 않고, 내용을 자기 말로 바꿔 씁니다.',
  '- 추측이면 "~로 보인다"처럼 단정하지 않습니다.',
  '',
  '출력은 JSON 객체 하나입니다. 형식(반드시 지킬 것):',
  '{"summaries": [{"titleKo":"...","ko":"...","en":"...","koLong":["...","...","..."],"enLong":["...","...","..."]}, ...]}',
  'summaries는 입력과 같은 길이·순서입니다.',
].join('\n');

function valid(v: unknown): v is Summary {
  const o = v as Summary;
  if (!o) return false;
  const str = (x: unknown) => typeof x === 'string' && x.trim().length > 0;
  const paras = (x: unknown) => Array.isArray(x) && x.length > 0 && x.every(str);
  return str(o.titleKo) && str(o.ko) && str(o.en) && paras(o.koLong) && paras(o.enLong);
}

async function readCache(urls: string[]): Promise<Map<string, Summary>> {
  const rows = await prisma.dashboardInsight.findMany({
    where: { kind: KIND, key: { in: urls } },
    select: { key: true, value: true },
  });
  const out = new Map<string, Summary>();
  for (const r of rows) {
    try {
      const v = JSON.parse(r.value);
      // 옛 캐시는 {ko:"..."} 한 가지뿐이라 형식이 다르다 — 무시하고 새로 만든다.
      if (valid(v)) out.set(r.key, v);
    } catch { /* 깨진 캐시는 무시 */ }
  }
  return out;
}

export async function ensureSummaries(items: DigestItem[]): Promise<DigestItem[]> {
  if (items.length === 0) return items;

  const cached = await readCache(items.map(i => i.url)).catch(() => new Map<string, Summary>());
  for (const it of items) it.summary = cached.get(it.url) ?? null;

  const todo = items.filter(i => !i.summary).slice(0, MAX_NEW);
  if (todo.length === 0) return items;

  // 배치별로 독립 처리 — 하나가 실패해도 나머지 요약은 남는다.
  const batches: DigestItem[][] = [];
  for (let i = 0; i < todo.length; i += BATCH) batches.push(todo.slice(i, i + BATCH));

  /** 한 묶음을 요약해 저장한다. 실패하면 throw — 호출부가 한 건씩 재시도한다. */
  const runBatch = async (batch: DigestItem[]): Promise<void> => {
    {
      const payload = batch.map(i => ({
        title: i.title,
        source: i.source,
        ...(i.sourceText ? { sourceText: i.sourceText.slice(0, SOURCE_CHARS) } : i.blurb ? { blurb: i.blurb } : {}),
        ...(i.alsoIn.length ? { alsoCoveredBy: i.alsoIn.map(a => a.source) } : {}),
      }));
      const resp = await client().chat.completions.create({
        model: MODEL,
        max_tokens: 6000,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: JSON.stringify(payload) },
        ],
      });
      // 잘린 응답을 조용히 넘기지 않는다 — 어느 배치가 왜 비었는지 로그로 남아야 한다.
      if (resp.choices[0]?.finish_reason === 'length') {
        throw new Error('응답이 max_tokens에서 잘렸다 — BATCH를 줄여야 한다');
      }
      const raw = resp.choices[0]?.message?.content ?? '';
      let obj: { summaries?: unknown };
      try {
        obj = JSON.parse(raw);
      } catch {
        obj = JSON.parse(raw.replace(CONTROL_CHARS, ' '));
      }
      const parsed = obj?.summaries;
      if (!Array.isArray(parsed) || parsed.length !== batch.length) {
        throw new Error(`summaries 길이 불일치 (입력 ${batch.length} / 응답 ${Array.isArray(parsed) ? parsed.length : typeof parsed})`);
      }

      await Promise.all(batch.map(async (it, i) => {
        const v = parsed[i];
        if (!valid(v)) return;
        it.summary = v;
        await prisma.dashboardInsight.upsert({
          where: { kind_key: { kind: KIND, key: it.url } },
          create: { kind: KIND, key: it.url, value: JSON.stringify(v) },
          update: { value: JSON.stringify(v) },
        }).catch(e => console.error('[news-summary] 캐시 저장 실패:', it.url, e));
      }));
    }
  };

  await Promise.all(batches.map(async batch => {
    try {
      await runBatch(batch);
    } catch (e) {
      // 묶음이 실패하면 통째로 버리지 않고 한 건씩 다시 시도한다.
      // 길이 불일치(모델이 4건 중 3건만 돌려줌)는 어느 항목이 빠졌는지 알 수 없어
      // 묶음 전체를 버려야 하는데, 한 건씩이면 그 문제 자체가 없다.
      console.error(`[news-summary] 배치 ${batch.length}건 실패 — 한 건씩 재시도:`, e instanceof Error ? e.message : e);
      for (const one of batch) {
        try {
          await runBatch([one]);
        } catch (e2) {
          console.error('[news-summary] 단건도 실패 — 제목만 보여준다:', one.url, e2 instanceof Error ? e2.message : e2);
        }
      }
    }
  }));

  return items;
}
