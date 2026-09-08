/**
 * 시그널 한 줄 설명 — "이게 뭐고 왜 볼 만한가".
 *
 * 목록에 제목만 있으면 읽는 사람이 판단할 수 없다. 특히 심한 것이 Hugging Face로,
 * 제목이 모델 id다 — "Qwopus3.8-27B-Flash-GGUF"만 보고 60,343번 받아 간 이유를 알 수
 * 있는 사람은 이미 그 모델을 아는 사람뿐이다. 논문 제목도 마찬가지고, 커뮤니티 글은
 * 제목이 맥락을 전제하고 쓰여 있다.
 *
 * ⚠️ 핵심 원칙: 근거 없이 쓰지 않는다.
 *    제목만 주고 "설명해 봐"라고 하면 모델이 그럴듯한 거짓을 만든다. 그래서 소스마다
 *    실제 근거를 먼저 가져오고(모델 카드·초록·페이지 설명), 근거를 못 구하면
 *    설명을 만들지 않고 비워 둔다. 빈 칸이 틀린 설명보다 낫다.
 *
 * 한 번 만들면 SocialSignal.blurb에 남고 다시 만들지 않는다 — 같은 항목의 설명은
 * 바뀌지 않으므로 두 번 과금될 이유가 없다.
 */
import OpenAI from 'openai';
import { prisma } from '@/lib/prisma';
import { DOMAIN_SOURCES } from './social-collect';

let _openai: OpenAI | null = null;
const client = () => (_openai ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY! }));

const MODEL = 'gpt-4o-mini';
/** 한 번의 크론 회차에서 새로 설명할 최대 개수. 나머지는 다음 회차가 채운다. */
const MAX_NEW = 20;
/** 근거로 넘길 앞부분 길이 — 뒤쪽은 대개 벤치마크 표·참고문헌이라 설명에 도움이 안 된다. */
const CTX_CHARS = 1800;
const UA = 'SparkScope/1.0';

const SYSTEM = [
  '당신은 AI·바이오 소식을 한 줄로 풀어 쓰는 편집자입니다.',
  '',
  '읽는 사람은 그 분야 종사자지만 이 항목은 처음 봅니다. 두 가지를 알려주세요:',
  '  (1) 무엇인가 — 무엇을 하는 것인지',
  '  (2) 왜 볼 만한가 — 무엇이 특별해서 화제인지',
  '',
  '규칙:',
  '- 한국어 1~2문장, 120자 이내.',
  '- 제목을 그대로 반복하지 마세요. 이미 목록에 있습니다.',
  '- 주어진 자료에 없는 성능 수치·순위·비교를 지어내지 마세요.',
  '  자료가 부실하면 확실한 것만 쓰고 짧게 끝냅니다.',
  '  분량을 채우려고 추측을 덧붙이는 것이 가장 나쁜 실패입니다.',
  '- 파라미터 수는 영문 표기를 그대로 두세요(27B, 7B, A4B). 한국어 단위로 바꾸지 마세요 —',
  '  "36B"를 "36억"으로 쓰면 틀립니다(360억이 맞습니다). 이 실수가 실제로 있었습니다.',
  '- AI 모델이 파생본(GGUF·양자화·파인튜닝)이면 원본이 무엇이고 무엇을 바꿨는지 밝히세요.',
  '  GGUF는 개인 PC에서 돌리기 위한 형식이고, 양자화는 메모리를 줄이는 대신 정밀도를 낮춥니다.',
  '- 논문이면 무엇을 밝혀냈는지를 씁니다. 방법론 나열이 아니라 결과가 중심입니다.',
  '- 영어 고유명사(Qwen, CRISPR, vLLM)는 그대로 둡니다.',
  '',
  '출력은 설명 문장뿐입니다. 따옴표나 접두어를 붙이지 마세요.',
].join('\n');

async function getText(url: string, revalidate = 86400): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, next: { revalidate } });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

const strip = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

/** 링크된 페이지의 메타 설명 — 커뮤니티 글은 본문이 링크 너머에 있다. */
async function pageDescription(url: string): Promise<string | null> {
  // 레딧 자체 글은 본문이 레딧에 있고 og:description이 잘려 나와 쓸모가 적다.
  if (/reddit\.com/.test(url)) return null;
  const html = await getText(url);
  if (!html) return null;
  const m =
    html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']{40,})["']/i) ??
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{40,})["']/i);
  return m ? strip(m[1]).slice(0, CTX_CHARS) : null;
}

/**
 * 소스별로 실제 근거를 가져온다. 못 구하면 null —
 * 그러면 이 항목은 설명을 만들지 않고 넘어간다.
 */
async function fetchContext(source: string, externalId: string, url: string): Promise<string | null> {
  switch (source) {
    case 'hf':
    case 'hf_new': {
      // 모델 카드. 앞머리 YAML에 태그가 들어 있어 유용하므로 지우지 않고 함께 넘긴다.
      const raw = await getText(`https://huggingface.co/${externalId}/raw/main/README.md`);
      return raw ? raw.slice(0, CTX_CHARS) : null;
    }
    case 'arxiv': {
      const xml = await getText(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(externalId)}`);
      const m = xml?.match(/<summary[^>]*>([\s\S]*?)<\/summary>/);
      return m ? strip(m[1]).slice(0, CTX_CHARS) : null;
    }
    case 'biorxiv': {
      // externalId가 DOI다. 서버가 둘(biorxiv·medrxiv)이라 순서대로 시도한다.
      for (const server of ['biorxiv', 'medrxiv']) {
        const j = await getText(`https://api.biorxiv.org/details/${server}/${externalId}`);
        try {
          const abs = JSON.parse(j ?? '{}')?.collection?.[0]?.abstract;
          if (abs) return strip(String(abs)).slice(0, CTX_CHARS);
        } catch { /* 다음 서버로 */ }
      }
      return null;
    }
    case 'pubmed': {
      const txt = await getText(
        'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?' +
        new URLSearchParams({ db: 'pubmed', id: externalId, rettype: 'abstract', retmode: 'text' }));
      return txt && txt.trim().length > 80 ? strip(txt).slice(0, CTX_CHARS) : null;
    }
    case 'trials': {
      // FDA 회수 항목은 NCT 번호가 아니라 회수번호라 조회되지 않는다 — 제목이 이미 설명적이다.
      if (!/^NCT/i.test(externalId)) return null;
      const j = await getText(`https://clinicaltrials.gov/api/v2/studies/${externalId}?fields=BriefSummary`);
      try {
        const sum = JSON.parse(j ?? '{}')?.protocolSection?.descriptionModule?.briefSummary;
        return sum ? strip(String(sum)).slice(0, CTX_CHARS) : null;
      } catch { return null; }
    }
    case 'reddit':
      // 레딧 글은 본문이 레딧 안에 있는데, 개별 글 RSS(/comments/…/.rss)가 429로 막히고
      // JSON API는 무인증 403이다(2026-09-08 실측). 근거를 구할 길이 없다.
      // 대신 레딧 제목은 대체로 그 자체로 문장이라("Novartis Basel layoffs") 설명 없이도 읽힌다.
      // OAuth 승인이 나면 selftext를 근거로 쓸 수 있다.
      return null;
    default:
      // hn · lobsters — 본문이 링크 너머에 있다.
      return pageDescription(url);
  }
}

/** 소스에 따라 무엇을 설명하는 중인지 알려 준다 — 같은 프롬프트라도 결이 달라진다. */
const KIND_HINT: Record<string, string> = {
  hf: 'AI 모델', hf_new: 'AI 모델',
  arxiv: '논문(프리프린트)', biorxiv: '논문(프리프린트)', pubmed: '논문(정식 게재)',
  trials: '임상시험 등록 정보',
  hn: '개발자 커뮤니티에서 화제인 글', lobsters: '개발자 커뮤니티에서 화제인 글',
  reddit: '분야별 커뮤니티에서 화제인 글',
};

async function writeBlurb(row: {
  source: string; title: string; externalId: string; points: number; pointsLabel: string | null;
}, context: string): Promise<string | null> {
  const facts = [
    `종류: ${KIND_HINT[row.source] ?? '소식'}`,
    `제목: ${row.title}`,
    row.source.startsWith('hf') ? `모델 id: ${row.externalId}` : '',
    row.points > 0 ? `반응: ${row.points.toLocaleString()} ${row.pointsLabel ?? ''}` : '',
    `근거 자료:\n${context}`,
  ].filter(Boolean).join('\n');

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
    return lastStop > 60 ? cut.slice(0, lastStop + 1) : cut.trimEnd() + '…';
  } catch (e) {
    console.error('[signal-blurb] 생성 실패:', row.source, row.externalId, e);
    return null;
  }
}

/**
 * 설명이 비어 있는 항목을 채운다. 남으면 다음 회차가 이어서 처리한다.
 * 실패해도 조용히 넘긴다 — 설명이 없다고 목록이 안 나가면 안 된다.
 */
export async function fillSignalBlurbs(limit = MAX_NEW): Promise<number> {
  // 화면에 실제로 쓰는 소스만. 테이블에는 예전 실험으로 쌓인 소스(github·blog·hf_papers,
  // 2026-09-02 maxnambranch 테스트분 157건)가 남아 있는데, 그건 지금 어디에도 안 나가므로
  // 설명을 만들면 돈만 쓴다.
  const displayed = [...new Set([...DOMAIN_SOURCES.ai, ...DOMAIN_SOURCES.bio])];
  // 최근에 본 것만. 목록에 뜰 일이 없는 오래된 행까지 설명하면 비용만 늘어난다.
  const seenSince = new Date(Date.now() - 21 * 86400_000);

  // 근거를 못 구해 실패한 항목을 매 회차 다시 시도하면 큐가 막힌다 — 실측으로
  // Reddit 128건이 앞자리를 계속 차지해 arXiv·Lobsters 차례가 오지 않았다.
  // 한 번 시도한 것은 일주일 쉬었다가 다시 본다(그 사이 링크가 살아날 수도 있다).
  const retryAfter = new Date(Date.now() - 7 * 86400_000);

  const rows = await prisma.socialSignal.findMany({
    where: {
      blurb: null,
      source: { in: displayed },
      lastSeenAt: { gte: seenSince },
      OR: [{ blurbTriedAt: null }, { blurbTriedAt: { lt: retryAfter } }],
    },
    // 최근 것부터 — 화면 위쪽에 뜨는 것이 먼저 설명이 붙어야 체감이 된다.
    orderBy: { lastSeenAt: 'desc' },
    take: limit,
    select: { id: true, source: true, externalId: true, title: true, url: true, points: true, pointsLabel: true },
  });
  if (rows.length === 0) return 0;

  let filled = 0;
  let noContext = 0;
  const now = new Date();
  for (const r of rows) {
    const context = await fetchContext(r.source, r.externalId, r.url);
    // 근거가 없으면 설명을 만들지 않는다 — 빈 칸이 틀린 설명보다 낫다.
    // 다만 시도했다는 사실은 남겨서 다음 회차가 같은 행에 다시 매달리지 않게 한다.
    const blurb = context ? await writeBlurb(r, context) : null;
    if (!context) noContext++;
    try {
      await prisma.socialSignal.update({
        where: { id: r.id },
        data: { blurbTriedAt: now, ...(blurb ? { blurb } : {}) },
      });
      if (blurb) filled++;
    } catch (e) {
      console.error('[signal-blurb] 저장 실패:', r.externalId, e);
    }
  }
  if (filled > 0 || noContext > 0) {
    console.log(`[signal-blurb] ${filled}/${rows.length}건 생성 (근거 없어 건너뜀 ${noContext}건)`);
  }
  return filled;
}
