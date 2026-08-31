/**
 * 콘텐츠(기사 제목·AI 생성 문장) 한국어 → 영어 번역.
 *
 * UI 문구는 src/lib/i18n/en.ts 사전이 담당한다. 이 파일은 사전으로 다룰 수 없는
 * DB/AI 텍스트 — 기사 제목, 위기 원인 문장, 경쟁사 트렌드처럼 매번 값이 다른 것 — 만 맡는다.
 *
 * 설계:
 * - 모델은 분류용과 같은 gpt-4o-mini. 제목 한 건이 ~25토큰이라 단가($0.15/$0.60 per Mtok)
 *   기준 전체 백필도 1달러 이하다. 품질이 아쉬우면 여기 모델명만 바꾸면 된다.
 * - 기사 제목은 Article.titleEn에 캐시한다. 같은 기사를 다시 볼 때 재번역하지 않는다.
 * - 화면에 뜨는 것만 번역한다(레이지). 전체 백필은 scripts/backfill-title-en.ts가 따로 한다.
 * - 번역 실패는 조용히 한국어 원문으로 떨어진다 — 화면이 비는 것보다 낫다.
 */
import OpenAI from 'openai';
import { prisma } from '@/lib/prisma';
import { PACKS, needsTranslationAnyLocale } from './locale';

// 지연 생성: 모듈을 import 하는 것만으로 키를 요구하면, 이 모듈이 딸려 들어간 곳
// (클라이언트 번들 등)에서 "Missing credentials"로 화면이 죽는다. 실제로 번역할 때만 만든다.
let _openai: OpenAI | null = null;
function client(): OpenAI {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
  return _openai;
}

const TRANSLATE_MODEL = 'gpt-4o-mini';
const BATCH_SIZE = 20;
/** 배치를 동시에 몇 개까지 던질지 — 순차로 돌리면 화면 하나에 수십 초가 걸린다. */
const CONCURRENCY = 8;
/**
 * 한 번의 페이지 요청에서 즉석 번역할 최대 건수.
 *
 * 대시보드는 탭마다 쓰는 목록을 한꺼번에 불러오기 때문에(경쟁사 기사 3000건 등) 상한이 없으면
 * 첫 조회가 1분 넘게 걸린다. 상한을 넘는 것은 한국어 원문으로 두고, 백필 스크립트와
 * 수집 크론이 뒤에서 채운다 — 화면이 멈추는 것보다 일부가 한국어인 게 낫다.
 */
const MAX_PER_REQUEST = 80;

/**
 * 로케일별 지침은 팩에서 모아 붙인다 — 새 오피스를 추가해도 이 파일은 그대로다.
 * 상수로 한 번만 계산해 두어야 프롬프트 캐시 프리픽스가 매번 같은 문자열이 된다.
 */
const SYSTEM = [
  'You translate East Asian startup/VC news text into natural English for a media-monitoring dashboard.',
  'The input may be in any of the languages described below. Detect it per string and translate either.',
  'Rules:',
  '- Translate the meaning, not word by word. Keep it concise, like an English news headline or analyst note.',
  '- Keep numbers, dates, and units accurate.',
  '- Do not add, omit, or explain anything.',
  '- Return ONLY a JSON array of translated strings, in the same order and with the same length as the input.',
  ...Object.values(PACKS).flatMap(p => [`Language: ${p.locale}`, ...p.translationHints]),
].join('\n');

/**
 * 번역할 것이 있는가 — 등록된 로케일 팩 중 하나라도 자기 문자를 찾으면 대상.
 *
 * 원래 /[가-힣]/ 한글만 봤다. 대만 기사가 들어오면서 중국어 제목이 전부
 * "번역할 것 없음"으로 판정돼 영문 UI에 중국어 원문이 그대로 나갔다
 * (2026-08-31 확인, 대만 120건 전량). 이제 팩이 판정하므로 새 로케일을 등록하면
 * 이 파일은 손대지 않아도 된다.
 */
function needsTranslation(s: string | null | undefined): boolean {
  return needsTranslationAnyLocale(s);
}

/**
 * 문자열 배열을 한 번에 번역한다. 실패하면 입력을 그대로 돌려준다(호출부에서 원문 노출).
 * 반환 배열의 길이·순서는 입력과 항상 같다.
 */
export async function translateBatch(texts: string[]): Promise<string[]> {
  if (texts.length === 0) return [];
  const out = [...texts];

  const starts: number[] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) starts.push(i);

  const runChunk = async (i: number) => {
    const chunk = texts.slice(i, i + BATCH_SIZE);
    try {
      const resp = await client().chat.completions.create({
        model: TRANSLATE_MODEL,
        max_tokens: 2000,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: JSON.stringify(chunk) },
        ],
      });
      const raw = resp.choices[0]?.message?.content ?? '';
      // 모델이 ```json 펜스를 붙이거나 배열 앞뒤에 설명을 덧붙이는 경우가 있다.
      // 첫 '[' 부터 마지막 ']' 까지만 잘라내면 두 경우 모두 걷힌다.
      const start = raw.indexOf('[');
      const end = raw.lastIndexOf(']');
      if (start < 0 || end <= start) throw new Error(`배열을 찾지 못함: ${raw.slice(0, 120)}`);
      // 문자열 안에 실제 줄바꿈·탭이 그대로 들어오면 JSON.parse가 깨진다(기사 제목에 흔하다).
      // 이스케이프된 \n은 백슬래시+n 두 글자라 이 치환에 걸리지 않으므로 안전하다.
      const body = raw
        .slice(start, end + 1)
        .replace(/[\u0000-\u001f]/g, ' ')
        // 모델이 마지막 항목 뒤에 쉼표를 남기는 경우가 있다(["a", "b", ] → JSON 문법 위반).
        .replace(/,\s*]$/, ']');
      const parsed = JSON.parse(body);
      if (Array.isArray(parsed) && parsed.length === chunk.length) {
        parsed.forEach((v, k) => {
          if (typeof v === 'string' && v.trim()) out[i + k] = v.trim();
        });
      } else if (chunk.length > 1) {
        // 응답 개수가 어긋나면 어느 항목이 어긋났는지 알 수 없어 묶음 전체를 버려야 한다.
        // 통째로 포기하지 않고 한 건씩 다시 시도한다(드물게만 일어나므로 비용 영향이 없다).
        console.error(`[translate-content] 길이 불일치(입력 ${chunk.length} / 응답 ${Array.isArray(parsed) ? parsed.length : 'not-array'}) — 한 건씩 재시도`);
        const retried = await Promise.all(chunk.map(one => translateBatch([one]).then(r => r[0])));
        retried.forEach((v, k) => { if (v && v !== chunk[k]) out[i + k] = v; });
      } else {
        console.error('[translate-content] 단건 번역 응답이 배열이 아님 — 원문 유지');
      }
    } catch (e: any) {
      console.error('[translate-content] 번역 실패, 원문 유지:', e?.message ?? e);
    }
  };

  for (let g = 0; g < starts.length; g += CONCURRENCY) {
    await Promise.all(starts.slice(g, g + CONCURRENCY).map(runChunk));
  }
  return out;
}

/** 단건 번역 — 캐시 없이 즉석에서. 짧은 AI 문장 하나를 옮길 때 쓴다. */
export async function translateOne(text: string): Promise<string> {
  if (!needsTranslation(text)) return text;
  return (await translateBatch([text]))[0];
}

type TranslatableArticle = {
  id: string;
  title: string;
  titleEn?: string | null;
  oneLiner?: string | null;
  oneLinerEn?: string | null;
  pitchTopic?: string | null;
  pitchTopicEn?: string | null;
};

/**
 * 화면에 뜰 기사들의 영어 필드를 채운다.
 *
 * 이미 titleEn이 있는 것은 건드리지 않으므로, 같은 기사를 두 번째로 볼 때는 LLM 호출이 없다.
 * 입력 객체를 그 자리에서 채워주고(호출부가 바로 렌더할 수 있게) DB에도 저장한다.
 */
export async function ensureArticleEn<T extends TranslatableArticle>(
  articles: T[],
  opts: { max?: number } = {},
): Promise<T[]> {
  const max = opts.max ?? MAX_PER_REQUEST;
  // 이미 영어인 제목(한국어 글자가 없는 것 — 해외 매체 인용 등)은 번역할 것이 없다.
  // 그래도 titleEn을 원문으로 복사해 "처리 완료"로 남긴다. 그러지 않으면 titleEn=null 조건으로
  // 도는 백필이 매 묶음마다 같은 행을 다시 집어와 진도가 안 나간다.
  const copyPatch = new Map<string, Record<string, string>>();
  const markCopy = (id: string, field: string, value: string) => {
    if (!copyPatch.has(id)) copyPatch.set(id, {});
    copyPatch.get(id)![field] = value;
  };
  for (const a of articles) {
    if (a.title && !needsTranslation(a.title) && !a.titleEn) markCopy(a.id, 'titleEn', a.title);
    if (a.oneLiner && !needsTranslation(a.oneLiner) && !a.oneLinerEn) markCopy(a.id, 'oneLinerEn', a.oneLiner);
    if (a.pitchTopic && !needsTranslation(a.pitchTopic) && !a.pitchTopicEn) markCopy(a.id, 'pitchTopicEn', a.pitchTopic);
  }

  const pending = articles.filter(
    a => (needsTranslation(a.title) && !a.titleEn)
      || (needsTranslation(a.oneLiner) && !a.oneLinerEn)
      || (needsTranslation(a.pitchTopic) && !a.pitchTopicEn),
  );
  if (pending.length === 0 && copyPatch.size === 0) return articles;

  // 같은 기사가 여러 목록에 중복으로 들어오므로 id로 한 번만 번역한다.
  const uniq = new Map<string, T>();
  for (const a of pending) if (!uniq.has(a.id)) uniq.set(a.id, a);
  // 상한을 넘으면 앞쪽(화면 위에 먼저 보이는 것)부터 처리한다.
  const rows = [...uniq.values()].slice(0, max);
  if (uniq.size > rows.length) {
    console.log(`[translate-content] 미번역 ${uniq.size - rows.length}건은 이번 요청에서 건너뜀(상한 ${max}) — 백필/크론이 채운다`);
  }

  // 세 필드를 한 배열에 이어붙여 한 번에 보낸다(호출 수를 줄인다).
  const jobs: { id: string; field: 'titleEn' | 'oneLinerEn' | 'pitchTopicEn'; text: string }[] = [];
  for (const a of rows) {
    if (needsTranslation(a.title) && !a.titleEn) jobs.push({ id: a.id, field: 'titleEn', text: a.title });
    if (needsTranslation(a.oneLiner) && !a.oneLinerEn) jobs.push({ id: a.id, field: 'oneLinerEn', text: a.oneLiner! });
    if (needsTranslation(a.pitchTopic) && !a.pitchTopicEn) jobs.push({ id: a.id, field: 'pitchTopicEn', text: a.pitchTopic! });
  }

  const translated = await translateBatch(jobs.map(j => j.text));

  // 번역 결과와 "이미 영어라 복사만 하는" 것을 같은 patch에 합쳐 한 번에 저장한다.
  const patch = new Map<string, Record<string, string>>(
    [...copyPatch.entries()].map(([id, v]) => [id, { ...v }]),
  );
  jobs.forEach((j, i) => {
    const v = translated[i];
    if (!v || v === j.text) return; // 번역 실패분은 저장하지 않는다 — 다음에 다시 시도한다.
    if (!patch.has(j.id)) patch.set(j.id, {});
    patch.get(j.id)![j.field] = v;
  });

  // 화면용 객체를 먼저 채운다(DB 쓰기가 실패해도 이번 화면은 영어로 보인다).
  for (const a of articles) {
    const p = patch.get(a.id);
    if (p) Object.assign(a, p);
  }

  await Promise.all(
    [...patch.entries()].map(([id, data]) =>
      prisma.article.update({ where: { id }, data }).catch((e: any) => {
        console.error(`[translate-content] titleEn 저장 실패 (${id}):`, e?.message ?? e);
      }),
    ),
  );

  return articles;
}

/**
 * 대시보드가 그릴 기사 묶음을 한 번에 번역한다.
 *
 * 화면 하나에 목록이 열 개 가까이 있고 같은 기사가 여러 목록에 겹쳐 들어오므로,
 * 목록별로 부르지 않고 전부 모아 한 번에 넘긴다(ensureArticleEn이 id로 중복을 걷어낸다).
 * 어느 목록이 비어 있어도 안전하다.
 */
export async function ensureArticleEnDeep(groups: (unknown[] | undefined | null)[]): Promise<void> {
  const flat: TranslatableArticle[] = [];
  for (const g of groups) {
    if (!Array.isArray(g)) continue;
    for (const item of g) {
      if (item && typeof item === 'object' && 'title' in item && 'id' in item) {
        flat.push(item as TranslatableArticle);
      }
    }
  }
  if (flat.length > 0) await ensureArticleEn(flat);
}

/**
 * DashboardInsight(위기 원인·경쟁사 트렌드·Inter 요약)의 영어판을 보장한다.
 *
 * 이 값들은 전부 value 컬럼의 JSON 안에 들어 있어서, 영어판도 같은 JSON에 `<필드>En` 키로
 * 넣는다 — 컬럼이나 유니크 제약을 건드리지 않아도 되고, 한국어판과 항상 같이 움직인다.
 *
 * 없으면 한 번 번역해서 그 자리에서 JSON에 합쳐 저장하므로, 다음 조회부터는 LLM 호출이 없다.
 * (하루 1회 도는 사전계산 배치가 값을 새로 쓰면 En 키가 사라지고, 다음 EN 조회 때 다시 채워진다.)
 *
 * @param texts 번역할 한국어 문장들
 * @returns 같은 순서의 영어 문장들. 번역이 실패하면 한국어 원문이 그대로 들어온다.
 */
export async function ensureInsightEn(
  kind: string,
  key: string,
  parsed: Record<string, unknown>,
  field: string,
  texts: string[],
): Promise<string[]> {
  const enField = `${field}En`;
  const cached = parsed[enField];
  // 캐시가 원문과 같은 개수로 들어 있을 때만 신뢰한다(원문이 바뀌었으면 다시 번역).
  if (Array.isArray(cached) && cached.length === texts.length && cached.every(v => typeof v === 'string')) {
    return cached as string[];
  }
  if (typeof cached === 'string' && texts.length === 1) return [cached];

  const translated = await translateBatch(texts);
  const merged = { ...parsed, [enField]: texts.length === 1 ? translated[0] : translated };
  await prisma.dashboardInsight
    .update({ where: { kind_key: { kind, key } }, data: { value: JSON.stringify(merged) } })
    .catch((e: any) => console.error(`[translate-content] insight 영어판 저장 실패 (${kind}/${key}):`, e?.message ?? e));
  return translated;
}

/**
 * Inter 탭의 판정 사유(InterNewsVerdict.reason)와 매칭 사유(InterPortfolioMatch.reason)를
 * 영어로 채운다. 각 테이블의 reasonEn에 캐시하므로 같은 기사를 다시 볼 때는 호출이 없다.
 *
 * 해외 기사 "제목"은 번역하지 않는다 — 원문(news.title)이 이미 영어다.
 */
export async function ensureInterReasonEn(
  verdicts: { id: string; reason: string; reasonEn?: string | null }[],
  matches: { id: string; reason: string; reasonEn?: string | null }[],
): Promise<void> {
  const jobs: { table: 'verdict' | 'match'; id: string; text: string; row: { reasonEn?: string | null } }[] = [];
  for (const v of verdicts) {
    if (needsTranslation(v.reason) && !v.reasonEn) jobs.push({ table: 'verdict', id: v.id, text: v.reason, row: v });
  }
  for (const m of matches) {
    if (needsTranslation(m.reason) && !m.reasonEn) jobs.push({ table: 'match', id: m.id, text: m.reason, row: m });
  }
  if (jobs.length === 0) return;

  // 같은 문구가 아주 흔하다("AI 인프라 트렌드" 등) — 중복은 한 번만 번역한다.
  const uniqueTexts = [...new Set(jobs.slice(0, MAX_PER_REQUEST * 2).map(j => j.text))];
  const translated = await translateBatch(uniqueTexts);
  const byText = new Map(uniqueTexts.map((t, i) => [t, translated[i]]));

  const writes: Promise<unknown>[] = [];
  for (const j of jobs) {
    const v = byText.get(j.text);
    if (!v || v === j.text) continue;
    j.row.reasonEn = v; // 이번 화면에서 바로 쓰이도록 먼저 채운다
    const data = { reasonEn: v };
    writes.push(
      (j.table === 'verdict'
        ? prisma.interNewsVerdict.update({ where: { id: j.id }, data })
        : prisma.interPortfolioMatch.update({ where: { id: j.id }, data })
      ).catch((e: any) => console.error(`[translate-content] reasonEn 저장 실패 (${j.table}/${j.id}):`, e?.message ?? e)),
    );
  }
  await Promise.all(writes);
}
