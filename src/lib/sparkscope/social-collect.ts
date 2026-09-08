/**
 * 소셜 시그널 — Inter 탭 도메인(바이오/AI)별로 "지금 이 분야에서 뭐가 뜨나"를 모은다.
 *
 * 소스별 현실 (2026-09-08 전부 curl 실측):
 *  - Hugging Face: 무인증 200. 레이트리밋 5분당 500회로 넉넉하다.
 *    trendingScore 정렬은 실제 대형 공개 모델(Qwen3.8-27B 등)을 정확히 위로 올린다.
 *    ⚠ createdAt 정렬은 단독으로 쓰면 안 된다 — 개인 실험 리포가 거의 전부다(fetchHfNew 참고).
 *  - Hacker News: Algolia API 무료·무인증, points·num_comments를 함께 준다.
 *  - Reddit: JSON API(/top.json)는 무인증 403. RSS(/hot/.rss)만 200인데 점수가 없다
 *    → 최신순으로만 보여준다. REDDIT_CLIENT_ID/SECRET을 넣으면 OAuth로 승격돼
 *    "기간 내 업보트 순"이 된다(등록은 무료).
 *  - Lobsters: /t/ai.json 200, score·comment_count 포함.
 *  - arXiv / bioRxiv / PubMed / ClinicalTrials / openFDA: 전부 무인증 200이지만
 *    인기 지표가 없다 → 최신순 전용. "원본이 언제 나왔나"를 보는 칸이다.
 *  - Bluesky: searchPosts가 403으로 인증 게이팅됐다(2026-09-08). 키워드 검색이 막혀
 *    토픽 수집이 불가능해 넣지 않았다. 계정을 큐레이션해 getAuthorFeed로 긁는 길은 열려 있다.
 *  - X: 무료 경로가 없고 API가 유료(Basic $200/월)라 2026-09-04에 제외했다.
 *
 * 이 모듈은 "외부에서 긁어오는" 일만 한다. 저장·조회는 social-store.ts가, 주기 관리는
 * social-refresh.ts가 맡는다(크론 /api/cron/collect-social). 화면은 DB에서만 읽으므로
 * 외부가 일시적으로 죽어도 칸이 사라지지 않는다.
 */

export type SocialDomain = 'ai' | 'bio';
export type SocialSourceId =
  | 'hf' | 'hf_new' | 'hn' | 'reddit' | 'lobsters' | 'arxiv'
  | 'biorxiv' | 'pubmed' | 'trials';

export interface SocialPost {
  /** 소스가 주는 고유 id — DB 식별키(source, externalId)의 뒷부분.
   *  URL로 잡으면 안 된다: 같은 기사가 HN에 여러 번 올라오면 URL은 같고 id는 다르다. */
  externalId: string;
  title: string;
  /** 한국어 제목 — KO 화면일 때만 라우트가 채운다. 없으면 원문(title)을 쓴다. */
  titleKo?: string;
  url: string;
  date: string;          // YYYY-MM-DD
  points?: number;       // 없으면 점수 미제공 소스
  comments?: number;
  origin?: string;       // r/biotech 등
  /** 만든 곳 — AI 모델은 누가 냈는지가 제목만큼 중요하다(OpenAI, Qwen, Google…). */
  author?: string;
  /** 점수의 단위. 소스마다 다르다(업보트/좋아요/다운로드) — 화면에 그대로 쓴다. */
  pointsLabel?: string;
}

export interface SocialSource {
  id: SocialSourceId;
  label: string;
  connected: boolean;
  ranked: boolean;       // true면 인기순, false면 최신순
  /** 왜 이 매체를 골랐는지 — 어떤 정보에 특화돼 있는지 한 줄. 화면에 그대로 나간다. */
  why: string;
  posts: SocialPost[];
}

/**
 * 매체 특징 한 줄 — 화면에 그대로 나간다.
 * "왜 하필 여기냐"는 질문에 매번 말로 답하지 않으려고 코드에 적어 둔다.
 */
// 매체 특징 한 줄 — 카드에 그대로 나간다.
// 짧게 유지한다. 카드가 3열로 깔리는데 설명이 세 줄씩 차지하면 정작 글 제목이 안 읽힌다
// (2026-09-08 사용자 피드백: "가독성이 떨어진다, 쓸데없는 텍스트를 지워라").
const WHY: Record<SocialSourceId, string> = {
  hf: '새 AI 모델이 논문·기사보다 먼저 올라오는 곳',
  hf_new: '새 AI 모델이 논문·기사보다 먼저 올라오는 곳',
  hn: '엔지니어·창업자 커뮤니티. 기술 발표가 언론보다 며칠 빠르다',
  reddit: '분야별 종사자 커뮤니티. 업계 내부 분위기가 먼저 드러난다',
  lobsters: '인프라·개발도구 논의가 밀도 높게 오가는 곳',
  arxiv: '심사 전 논문 원본',
  biorxiv: '바이오 프리프린트 원본',
  pubmed: '심사를 통과해 정식 게재된 논문',
  trials: '임상 단계 변경과 FDA 리콜 — 회사 발표보다 앞선다',
};

/** 소스별 캐시(초) — 원본이 갱신되는 속도에 맞춘다. 조사 결과(2026-09-08) 기준. */
export const REVALIDATE = {
  fast: 2 * 3600,    // Reddit · HN — 반응이 시간 단위로 바뀐다
  medium: 6 * 3600,  // HF trending · Lobsters — 완만하게 변한다
  daily: 24 * 3600,  // arXiv · bioRxiv · PubMed · 임상 — 원본이 하루 1회 배치
} as const;

/**
 * 소스별 수집 주기(초). 크론이 이 값으로 "지금 돌 차례인가"를 판단한다.
 * 캐시 시간(REVALIDATE)과 같은 근거에서 나온 값이라 같은 상수를 쓴다 —
 * 원본이 하루 1회 갱신되는 곳을 2시간마다 긁는 것은 남의 서버만 축내는 일이다.
 */
export const COLLECT_INTERVAL_SEC: Record<SocialSourceId, number> = {
  hn: REVALIDATE.fast,
  reddit: REVALIDATE.fast,
  hf: REVALIDATE.medium,
  hf_new: REVALIDATE.medium,
  lobsters: REVALIDATE.medium,
  arxiv: REVALIDATE.daily,
  biorxiv: REVALIDATE.daily,
  pubmed: REVALIDATE.daily,
  trials: REVALIDATE.daily,
};

/** 도메인별로 화면에 세울 소스 순서. 배열 순서가 곧 화면 순서다. */
// Reddit은 맨 끝이다(2026-09-08). 인증 없이 받으면 점수를 못 받아 최신순으로만 뜨는데,
// 최신순 목록은 "지금 뭐가 뜨나"에 답하지 못해 위에 둘 값이 없다.
// REDDIT_CLIENT_ID/SECRET을 넣어 주간 업보트 순으로 정렬되면 위로 올린다.
export const DOMAIN_SOURCES: Record<SocialDomain, SocialSourceId[]> = {
  ai: ['hf', 'hf_new', 'hn', 'lobsters', 'arxiv', 'reddit'],
  bio: ['hn', 'biorxiv', 'trials', 'pubmed', 'reddit'],
};

/** 소스 표시 이름·정렬 방식 — DB에서 읽어 화면 모양으로 되살릴 때 쓴다. */
export const SOURCE_META: Record<SocialSourceId, { label: string; ranked: boolean }> = {
  hf:       { label: 'Hugging Face', ranked: true },
  hf_new:   { label: 'Hugging Face', ranked: false },
  hn:       { label: 'Hacker News',              ranked: true },
  reddit:   { label: 'Reddit',                   ranked: false },
  lobsters: { label: 'Lobsters',                 ranked: true },
  arxiv:    { label: 'arXiv (cs.AI)',            ranked: false },
  biorxiv:  { label: 'bioRxiv · medRxiv',        ranked: false },
  pubmed:   { label: 'PubMed',                   ranked: false },
  trials:   { label: 'ClinicalTrials · FDA',     ranked: false },
};

/** 제목이 고유명사라 번역하면 안 되는 소스 — HF 모델 id는 이름 그 자체다. */
export const NO_TRANSLATE: ReadonlySet<string> = new Set(['hf', 'hf_new']);

/** 매체 특징 한 줄 — 화면에 그대로 나간다. */
export function whyOf(id: SocialSourceId): string {
  return WHY[id];
}

const HN_QUERIES: Record<SocialDomain, string[]> = {
  ai: ['AI agent', 'LLM', 'machine learning', 'OpenAI', 'Anthropic', 'GPU inference', 'foundation model'],
  bio: ['biotech', 'CRISPR', 'drug discovery', 'FDA approval', 'clinical trial', 'gene therapy', 'protein folding'],
};

/**
 * 서브레딧 — 2026-09-07에 도메인당 3개 → 7개로 확장.
 *
 * 고를 때 기준: (1) 실무자가 모이는 곳, (2) 뉴스가 실제로 먼저 도는 곳.
 *  - LocalLLaMA: 오픈소스 모델 공개가 사실상 여기서 가장 먼저 돈다(AI 최대 실무 커뮤니티).
 *  - OpenAI·LLMDevs: 제품·API 변경이 공지보다 빨리 공유된다.
 *  - pharma·clinicalresearch: 산업·임상·규제 쪽 종사자.
 */
const SUBREDDITS: Record<SocialDomain, string[]> = {
  ai: ['MachineLearning', 'LocalLLaMA', 'artificial', 'OpenAI', 'LLMDevs', 'deeplearning', 'singularity'],
  bio: ['biotech', 'labrats', 'bioengineering', 'pharma', 'bioinformatics', 'clinicalresearch', 'CRISPR'],
};

// 주간 공지·채용 스레드는 트렌드가 아니다.
const SKIP = ['self-promotion', "who's hiring", 'monthly', 'weekly', 'simple questions', 'megathread'];
const isChrome = (t: string) => SKIP.some(s => t.toLowerCase().includes(s));

const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const UA = 'SparkScope/1.0';
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

async function getText(url: string, revalidate: number = REVALIDATE.fast): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, next: { revalidate } });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.text();
}

async function getJson<T>(url: string, revalidate: number): Promise<T> {
  return JSON.parse(await getText(url, revalidate)) as T;
}

function decodeXml(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

const tag = (xml: string, name: string) =>
  decodeXml((xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`)) ?? [])[1]?.trim() ?? '');

// ──────────────────────────────────────────────────────────────
// Hugging Face
// ──────────────────────────────────────────────────────────────

/**
 * 모델 id는 "소유자/모델명" 꼴이다(openai/gpt-oss-20b). 앞부분이 만든 곳이라
 * 그대로 쓰되, 널리 쓰는 표기가 있으면 그걸로 바꾼다 — 화면에서 "누가 냈나"가
 * 제목만큼 중요한데 `deepseek-ai`처럼 기계적인 계정명은 잘 안 읽힌다.
 */
const HF_ORG_LABEL: Record<string, string> = {
  'openai': 'OpenAI', 'meta-llama': 'Meta', 'google': 'Google', 'deepseek-ai': 'DeepSeek',
  'Qwen': 'Qwen (Alibaba)', 'mistralai': 'Mistral AI', 'microsoft': 'Microsoft',
  'nvidia': 'NVIDIA', 'anthropic': 'Anthropic', 'stabilityai': 'Stability AI',
  'allenai': 'Allen AI', 'HuggingFaceTB': 'Hugging Face', 'ibm-granite': 'IBM',
  'moonshotai': 'Moonshot AI', 'tencent': 'Tencent', 'baidu': 'Baidu', 'apple': 'Apple',
};

interface HfModel {
  id: string; likes?: number; downloads?: number; createdAt?: string; pipeline_tag?: string;
}

function toHfPost(m: HfModel, metric: 'likes' | 'downloads'): SocialPost {
  const [owner, ...rest] = m.id.split('/');
  const name = rest.join('/') || m.id;
  return {
    externalId: m.id,
    title: name,
    url: `https://huggingface.co/${m.id}`,
    date: (m.createdAt ?? '').slice(0, 10),
    // 좋아요/다운로드는 성격이 달라서 무엇을 세는지 라벨로 밝힌다.
    points: metric === 'likes' ? (m.likes ?? 0) : (m.downloads ?? 0),
    pointsLabel: metric === 'likes' ? '좋아요' : '다운로드',
    author: rest.length ? (HF_ORG_LABEL[owner] ?? owner) : '개인',
    origin: m.pipeline_tag ?? undefined,
  };
}

/** 지금 가장 화제인 모델 — HF가 직접 계산한 trendingScore 순. */
async function fetchHfTrending(): Promise<SocialPost[]> {
  const url = 'https://huggingface.co/api/models?' + new URLSearchParams({
    sort: 'trendingScore', direction: '-1', limit: '10',
  });
  const models = await getJson<HfModel[]>(url, REVALIDATE.medium);
  return models.filter(m => m?.id).map(m => toHfPost(m, 'likes'));
}

/**
 * 최근 공개된 모델 — 새로 나온 순.
 *
 * ⚠ sort=createdAt을 그대로 쓰면 안 된다. 방금 올라온 리포는 다운로드·좋아요가
 * 정의상 전부 0이라, 최신 100개가 개인 실험 리포로만 채워진다(2026-09-08 실측:
 * 최신 100개의 최대 다운로드 0, 최대 좋아요 1). 사용량 하한을 걸어도 항상 빈다.
 *
 * 그래서 반대로 간다 — 최근 일주일 사이 실제로 주목받은 모델(likes7d)을 넉넉히 받아
 * 공개일 역순으로 다시 세운다. "쓸모 있는 모델 중 가장 새로운 것"이 되고,
 * 실측하면 MiniCPM5-2B·Qwopus3.8-27B 같은 실제 릴리즈가 올라온다.
 */
async function fetchHfNew(): Promise<SocialPost[]> {
  const url = 'https://huggingface.co/api/models?' + new URLSearchParams({
    sort: 'likes7d', direction: '-1', limit: '60',
  });
  const models = await getJson<HfModel[]>(url, REVALIDATE.medium);
  return models
    .filter(m => m?.id && m.createdAt)
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
    .slice(0, 10)
    .map(m => toHfPost(m, 'downloads'));
}

// ──────────────────────────────────────────────────────────────
// 커뮤니티
// ──────────────────────────────────────────────────────────────

/** Hacker News — 무료·무인증, 점수 있음. 정렬: 업보트 + 댓글×2. */
async function fetchHackerNews(domain: SocialDomain, sinceMs: number): Promise<SocialPost[]> {
  const since = Math.floor(sinceMs / 1000);
  const seen = new Map<string, SocialPost>();

  // 검색어 7개를 순차로 돌면 왕복이 7번이다 — 서로 독립이라 한꺼번에 던진다.
  const pages = await Promise.all(HN_QUERIES[domain].map(async q => {
    const url = 'https://hn.algolia.com/api/v1/search?' + new URLSearchParams({
      query: q, tags: 'story',
      numericFilters: `created_at_i>${since},points>20`,
      hitsPerPage: '20',
    });
    try {
      return (await getJson<{ hits?: any[] }>(url, REVALIDATE.fast)).hits ?? [];
    } catch (e) {
      console.error('[social] HN 조회 실패:', q, e);
      return [];
    }
  }));
  for (const h of pages.flat()) {
    if (!h?.title || seen.has(h.objectID)) continue;
    if (isChrome(h.title)) continue;
    seen.set(h.objectID, {
      externalId: String(h.objectID),
      title: h.title,
      url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
      date: ymd(h.created_at_i * 1000),
      points: h.points ?? 0,
      pointsLabel: '업보트',
      comments: h.num_comments ?? 0,
    });
  }
  return [...seen.values()].sort(byHeat).slice(0, 10);
}

const byHeat = (a: SocialPost, b: SocialPost) =>
  ((b.points ?? 0) + (b.comments ?? 0) * 2) - ((a.points ?? 0) + (a.comments ?? 0) * 2);

/**
 * Reddit — 자격증명이 있으면 OAuth(점수 있음), 없으면 RSS(최신순).
 * 무인증 JSON API는 403이라 폴백이 RSS뿐이고, RSS에는 점수가 없다(2026-09-08 재확인).
 */
async function fetchReddit(domain: SocialDomain): Promise<{ posts: SocialPost[]; ranked: boolean }> {
  const id = process.env.REDDIT_CLIENT_ID;
  const secret = process.env.REDDIT_CLIENT_SECRET;

  if (id && secret) {
    try {
      const auth = Buffer.from(`${id}:${secret}`).toString('base64');
      const tokenRes = await fetch('https://www.reddit.com/api/v1/access_token', {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
        body: 'grant_type=client_credentials',
      });
      const { access_token } = await tokenRes.json() as { access_token?: string };
      if (access_token) {
        const perSub = await Promise.all(SUBREDDITS[domain].map(async sub => {
          try {
            const res = await fetch(`https://oauth.reddit.com/r/${sub}/top?t=week&limit=10`, {
              headers: { Authorization: `Bearer ${access_token}`, 'User-Agent': UA },
              next: { revalidate: REVALIDATE.fast },
            });
            if (!res.ok) return [];
            const j = await res.json() as any;
            return (j?.data?.children ?? []).flatMap((c: any) => {
              const d = c.data;
              if (!d?.title || isChrome(d.title)) return [];
              return [{
                externalId: String(d.id),
                title: d.title, url: `https://www.reddit.com${d.permalink}`,
                date: ymd(d.created_utc * 1000), points: d.ups, pointsLabel: '업보트',
                comments: d.num_comments, origin: `r/${sub}`,
              } as SocialPost];
            });
          } catch { return []; }
        }));
        return { posts: perSub.flat().sort(byHeat).slice(0, 10), ranked: true };
      }
    } catch (e) {
      console.error('[social] Reddit OAuth 실패 — RSS로 폴백:', e);
    }
  }

  // RSS 폴백.
  //
  // 순차로 받는다 — 서브레딧 7곳을 Promise.all로 동시에 치면 Reddit이 첫 요청만 통과시키고
  // 나머지를 전부 429로 막는다(2026-09-08 실측: 병렬 7개 중 1개만 200). 인증 없는 Reddit은
  // 초당 1요청도 버거워서, 간격을 두고 필요한 만큼만 받고 끝낸다.
  // 근본 해결은 REDDIT_CLIENT_ID/SECRET을 넣어 위 OAuth 경로를 타는 것이다.
  const perSub: SocialPost[][] = [];
  for (const sub of SUBREDDITS[domain]) {
    // 이미 충분히 모았으면 더 요청하지 않는다 — 요청 수 자체가 429의 원인이다.
    if (perSub.reduce((n, a) => n + a.length, 0) >= 12) break;
    if (perSub.length > 0) await sleep(1200);
    const acc: SocialPost[] = [];
    try {
      const xml = await getText(`https://www.reddit.com/r/${sub}/hot/.rss?limit=12`, REVALIDATE.fast);
      for (const entry of xml.match(/<entry>[\s\S]*?<\/entry>/g) ?? []) {
        const title = entry.match(/<title>([\s\S]*?)<\/title>/)?.[1];
        const url = entry.match(/<link href="(.*?)"/)?.[1];
        const upd = entry.match(/<updated>(.*?)<\/updated>/)?.[1];
        if (!title || !url || isChrome(title)) continue;
        // Atom의 <id>는 t3_xxx 꼴이라 OAuth 경로의 d.id와 같은 값이 된다 —
        // 나중에 자격증명이 붙어도 같은 글이 두 행으로 갈리지 않는다.
        const rawId = entry.match(/<id>(?:t3_)?(.*?)<\/id>/)?.[1];
        acc.push({
          externalId: (rawId ?? url).replace(/^t3_/, ''),
          title: decodeXml(title.trim()), url, date: (upd ?? '').slice(0, 10), origin: `r/${sub}`,
        });
      }
    } catch (e) {
      console.error('[social] Reddit RSS 실패:', sub, e);
    }
    perSub.push(acc);
  }
  // 서브레딧별로 고르게 섞는다 — 그냥 이어붙이면 앞 서브레딧이 10칸을 다 먹는다.
  const out: SocialPost[] = [];
  for (let i = 0; out.length < 10 && i < 12; i++) {
    for (const acc of perSub) {
      if (acc[i]) out.push(acc[i]);
      if (out.length >= 10) break;
    }
  }
  return { posts: out, ranked: false };
}

/** Lobsters — /t/<tag>.json 이 score·comment_count를 함께 준다. */
async function fetchLobsters(): Promise<SocialPost[]> {
  const rows = await getJson<any[]>('https://lobste.rs/t/ai.json', REVALIDATE.medium);
  return rows
    .filter(r => r?.title && !isChrome(r.title))
    .map(r => ({
      externalId: String(r.short_id ?? r.comments_url),
      title: r.title,
      url: r.url || r.comments_url,
      date: (r.created_at ?? '').slice(0, 10),
      points: r.score ?? 0,
      pointsLabel: '업보트',
      comments: r.comment_count ?? 0,
    }))
    .sort(byHeat)
    .slice(0, 8);
}

// ──────────────────────────────────────────────────────────────
// 원본(논문·임상) — 인기 지표가 없어 전부 최신순
// ──────────────────────────────────────────────────────────────

/**
 * arXiv — cs.AI 신규 등록. RSS가 하루 1회 배치로 갱신된다.
 * pubDate가 RFC822("Mon, 07 Sep 2026 00:00:00 -0400")라 앞 10자를 자르면
 * "Mon, 07 Se"가 나온다 — Date로 파싱해서 YYYY-MM-DD로 바꾼다.
 */
async function fetchArxiv(): Promise<SocialPost[]> {
  const xml = await getText('https://rss.arxiv.org/rss/cs.AI', REVALIDATE.daily);
  return (xml.match(/<item>[\s\S]*?<\/item>/g) ?? []).slice(0, 8).map(item => {
    const raw = tag(item, 'dc:date') || tag(item, 'pubDate');
    const ms = Date.parse(raw);
    const link = tag(item, 'link');
    return {
      externalId: link.split('/abs/')[1] ?? link,
      title: tag(item, 'title'),
      url: link,
      date: Number.isNaN(ms) ? raw.slice(0, 10) : ymd(ms),
      author: tag(item, 'dc:creator').split(',')[0]?.trim() || undefined,
    };
  }).filter(p => p.title && p.url);
}

/** bioRxiv + medRxiv — 날짜 구간 API. 최근 3일치를 받아 최신순으로 자른다. */
async function fetchBiorxiv(): Promise<SocialPost[]> {
  const to = ymd(Date.now());
  const from = ymd(Date.now() - 3 * 86400_000);
  const servers = ['biorxiv', 'medrxiv'];
  const perServer = await Promise.all(servers.map(async server => {
    try {
      const j = await getJson<{ collection?: any[] }>(
        `https://api.biorxiv.org/details/${server}/${from}/${to}`, REVALIDATE.daily);
      return (j.collection ?? []).map(r => ({
        externalId: String(r.doi),
        title: r.title,
        url: `https://www.${server}.org/content/${r.doi}`,
        date: r.date,
        author: (r.authors ?? '').split(';')[0]?.trim() || undefined,
        origin: r.category || server,
      } as SocialPost));
    } catch (e) {
      console.error('[social] bioRxiv 조회 실패:', server, e);
      return [] as SocialPost[];
    }
  }));
  return perServer.flat()
    .filter(p => p.title)
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
    .slice(0, 8);
}

/** PubMed — esearch로 최근 id를 얻고 esummary로 제목을 받는다(왕복 2번). */
async function fetchPubmed(): Promise<SocialPost[]> {
  const search = await getJson<{ esearchresult?: { idlist?: string[] } }>(
    'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?' + new URLSearchParams({
      db: 'pubmed', retmode: 'json', retmax: '8', sort: 'date',
      term: '(CRISPR[tiab] OR "gene therapy"[tiab] OR "drug discovery"[tiab] OR immunotherapy[tiab]) AND ("last 7 days"[dp])',
    }), REVALIDATE.daily);
  const ids = search.esearchresult?.idlist ?? [];
  if (ids.length === 0) return [];

  const sum = await getJson<{ result?: Record<string, any> }>(
    'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?' + new URLSearchParams({
      db: 'pubmed', retmode: 'json', id: ids.join(','),
    }), REVALIDATE.daily);

  return ids.flatMap(id => {
    const r = sum.result?.[id];
    if (!r?.title) return [];
    return [{
      externalId: String(id),
      title: decodeXml(String(r.title).replace(/<[^>]+>/g, '')),
      url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
      date: (r.sortpubdate ?? r.pubdate ?? '').slice(0, 10).replace(/\//g, '-'),
      author: r.authors?.[0]?.name,
      origin: r.source,
    } as SocialPost];
  });
}

/**
 * ClinicalTrials.gov + openFDA — 임상 단계 변경과 리콜.
 * 회사가 발표하기 전에 등록 정보가 먼저 바뀌는 경우가 많아 기사보다 앞선다.
 */
async function fetchTrials(): Promise<SocialPost[]> {
  const [trials, recalls] = await Promise.all([
    (async () => {
      const j = await getJson<{ studies?: any[] }>(
        'https://clinicaltrials.gov/api/v2/studies?' + new URLSearchParams({
          'sort': 'LastUpdatePostDate:desc', 'pageSize': '6',
          'filter.overallStatus': 'RECRUITING',
          'query.intr': 'drug',
        }), REVALIDATE.daily);
      return (j.studies ?? []).flatMap(s => {
        const p = s?.protocolSection;
        const title = p?.identificationModule?.briefTitle;
        const nct = p?.identificationModule?.nctId;
        if (!title || !nct) return [];
        return [{
          externalId: String(nct),
          title,
          url: `https://clinicaltrials.gov/study/${nct}`,
          date: (p?.statusModule?.lastUpdatePostDateStruct?.date ?? '').slice(0, 10),
          author: p?.sponsorCollaboratorsModule?.leadSponsor?.name,
          origin: p?.designModule?.phases?.join('/') || '임상',
        } as SocialPost];
      });
    })().catch(e => { console.error('[social] ClinicalTrials 실패:', e); return [] as SocialPost[]; }),
    (async () => {
      const j = await getJson<{ results?: any[] }>(
        'https://api.fda.gov/drug/enforcement.json?limit=4&sort=report_date:desc', REVALIDATE.daily);
      return (j.results ?? []).flatMap(r => {
        if (!r?.product_description) return [];
        const d = String(r.report_date ?? '');
        return [{
          externalId: String(r.recall_number ?? `${r.recalling_firm}:${r.report_date}`),
          title: `[회수] ${String(r.product_description).slice(0, 120)}`,
          url: 'https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts',
          date: d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : '',
          author: r.recalling_firm,
          origin: r.classification,
        } as SocialPost];
      });
    })().catch(e => { console.error('[social] openFDA 실패:', e); return [] as SocialPost[]; }),
  ]);
  return [...trials, ...recalls]
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
    .slice(0, 8);
}

// ──────────────────────────────────────────────────────────────

const empty = <T,>(v: T) => () => v;

/**
 * 도메인별 소스 목록 — 배열 순서가 곧 화면 순서다.
 * "지금 뭐가 뜨나"에 바로 답하는 것(점수가 있는 곳)을 위에 두고,
 * 원본 자료(논문·임상)는 그다음에 둔다.
 *
 * Reddit은 맨 끝이다(2026-09-08). 인증 없이 받으면 점수를 못 받아 최신순으로만 뜨는데,
 * 최신순 목록은 "지금 뭐가 뜨나"에 답하지 못해 위에 둘 값이 없다. Reddit OAuth
 * (REDDIT_CLIENT_ID/SECRET)를 넣어 주간 업보트 순으로 정렬되면 위로 올린다.
 */
export async function collectSocialSignals(domain: SocialDomain, sinceMs: number): Promise<SocialSource[]> {
  const isAi = domain === 'ai';

  const [hfTrend, hfNew, hn, reddit, lobsters, arxiv, biorxiv, pubmed, trials] = await Promise.all([
    isAi ? fetchHfTrending().catch(empty([] as SocialPost[])) : [],
    isAi ? fetchHfNew().catch(empty([] as SocialPost[])) : [],
    fetchHackerNews(domain, sinceMs).catch(empty([] as SocialPost[])),
    fetchReddit(domain).catch(empty({ posts: [] as SocialPost[], ranked: false })),
    isAi ? fetchLobsters().catch(empty([] as SocialPost[])) : [],
    isAi ? fetchArxiv().catch(empty([] as SocialPost[])) : [],
    isAi ? [] : fetchBiorxiv().catch(empty([] as SocialPost[])),
    isAi ? [] : fetchPubmed().catch(empty([] as SocialPost[])),
    isAi ? [] : fetchTrials().catch(empty([] as SocialPost[])),
  ]);

  // 화면에 쓰는 label·ranked는 SOURCE_META가 단일 소스다(라우트가 DB에서 되살릴 때도 그걸 쓴다).
  // 여기서는 수집 결과를 담기만 한다.
  const src = (id: SocialSourceId, posts: SocialPost[]): SocialSource => ({
    id, label: SOURCE_META[id].label, connected: posts.length > 0,
    ranked: SOURCE_META[id].ranked, why: WHY[id], posts,
  });

  const list: SocialSource[] = isAi
    ? [
        src('hf', hfTrend),
        src('hf_new', hfNew),
        src('hn', hn),
        src('lobsters', lobsters),
        src('arxiv', arxiv),
        src('reddit', reddit.posts),
      ]
    : [
        src('hn', hn),
        src('biorxiv', biorxiv),
        src('trials', trials),
        src('pubmed', pubmed),
        src('reddit', reddit.posts),
      ];

  // 응답이 아예 없는 소스는 빼지 않고 그대로 돌려준다 — 저장·조회는 social-store.ts가
  // 담당하고(크론이 채운다), 화면은 DB에서 읽으므로 이번 조회가 0건이어도 칸이 사라지지 않는다.
  // 예전에 여기서 0건 소스를 걸러냈더니 Reddit이 429를 맞은 날 AI 탭에서 칸이 통째로
  // 사라졌다(2026-09-08 사용자 신고).
  return list;
}

