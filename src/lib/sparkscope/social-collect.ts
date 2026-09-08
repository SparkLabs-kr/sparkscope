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
 * 아직 DB에 쌓지 않는다 — 라우트 캐시(revalidate)로만 버틴다. 소스마다 갱신 속도가
 * 달라서 캐시 시간도 소스별로 다르게 준다(REVALIDATE).
 */

export type SocialDomain = 'ai' | 'bio';
export type SocialSourceId =
  | 'hf' | 'hf_new' | 'hn' | 'reddit' | 'lobsters' | 'arxiv'
  | 'biorxiv' | 'pubmed' | 'trials';

export interface SocialPost {
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
  note: string;          // 화면에 그대로 노출되는 상태 설명
  /** 왜 이 매체를 골랐는지 — 어떤 정보에 특화돼 있는지 한 줄. 화면에 그대로 나간다. */
  why: string;
  posts: SocialPost[];
}

/**
 * 매체 특징 한 줄 — 화면에 그대로 나간다.
 * "왜 하필 여기냐"는 질문에 매번 말로 답하지 않으려고 코드에 적어 둔다.
 */
const WHY: Record<SocialSourceId, string> = {
  hf: 'AI 모델이 공개되는 바로 그 자리. 논문·기사보다 가중치가 먼저 올라와서, 새 모델은 여기서 가장 빨리 확인된다.',
  hf_new: '실제로 쓰이기 시작한 모델만 골라 공개일 순으로. 이번 주에 어떤 모델이 새로 나왔는지 한 번에 확인한다.',
  hn: '실리콘밸리 엔지니어·창업자가 모이는 곳. 기술 발표와 오픈소스가 언론 보도보다 며칠 먼저 올라오고, 댓글에 현업자 검증이 붙는다.',
  reddit: '분야별 종사자 커뮤니티. 채용·실험 실패·규제 체감 같은 업계 내부 분위기가 기사로 나오기 전에 먼저 드러난다.',
  lobsters: 'HN보다 조용하지만 인프라·개발도구 쪽이 강하다. 사람이 적어 홍보성 글이 거의 없고 기술 논의 밀도가 높다.',
  arxiv: '논문 원본이 심사 전에 공개되는 곳. 기사로 옮겨지기 며칠~몇 주 전의 원 자료를 그대로 본다.',
  biorxiv: '바이오 프리프린트 원본. 학술지 심사를 기다리지 않고 올라와서, 연구 결과를 가장 이른 시점에 확인할 수 있다.',
  pubmed: '정식 게재된 논문 색인. 프리프린트와 달리 심사를 통과한 것만 들어와, 근거의 무게가 다르다.',
  trials: '임상시험 단계 변경과 FDA 리콜·회수. 회사가 발표하기 전에 등록 정보가 먼저 바뀌는 경우가 많아 기사보다 앞선다.',
};

/** 소스별 캐시(초) — 원본이 갱신되는 속도에 맞춘다. 조사 결과(2026-09-08) 기준. */
const REVALIDATE = {
  fast: 2 * 3600,    // Reddit · HN — 반응이 시간 단위로 바뀐다
  medium: 6 * 3600,  // HF trending · Lobsters — 완만하게 변한다
  daily: 24 * 3600,  // arXiv · bioRxiv · PubMed · 임상 — 원본이 하루 1회 배치
} as const;

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

  // RSS 폴백. 429가 잦은 경로라 실패는 그 서브레딧만 버린다.
  const perSub = await Promise.all(SUBREDDITS[domain].map(async sub => {
    const acc: SocialPost[] = [];
    try {
      const xml = await getText(`https://www.reddit.com/r/${sub}/hot/.rss?limit=12`, REVALIDATE.fast);
      for (const entry of xml.match(/<entry>[\s\S]*?<\/entry>/g) ?? []) {
        const title = entry.match(/<title>([\s\S]*?)<\/title>/)?.[1];
        const url = entry.match(/<link href="(.*?)"/)?.[1];
        const upd = entry.match(/<updated>(.*?)<\/updated>/)?.[1];
        if (!title || !url || isChrome(title)) continue;
        acc.push({ title: decodeXml(title.trim()), url, date: (upd ?? '').slice(0, 10), origin: `r/${sub}` });
      }
    } catch (e) {
      console.error('[social] Reddit RSS 실패:', sub, e);
    }
    return acc;
  }));
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
    return {
      title: tag(item, 'title'),
      url: tag(item, 'link'),
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

  const src = (
    id: SocialSourceId, label: string, posts: SocialPost[], ranked: boolean, note: string,
  ): SocialSource => ({ id, label, connected: posts.length > 0, ranked, note, why: WHY[id], posts });

  const list: SocialSource[] = isAi
    ? [
        src('hf', 'Hugging Face · 인기 모델', hfTrend, true, '6시간마다 갱신 · HF 트렌딩 점수 순'),
        src('hf_new', 'Hugging Face · 새 모델', hfNew, false, '6시간마다 갱신 · 이번 주 주목받은 모델 중 공개순'),
        src('hn', 'Hacker News', hn, true, '2시간마다 갱신 · 업보트+댓글×2 기준'),
        src('reddit', 'Reddit', reddit.posts, reddit.ranked,
          reddit.ranked ? '2시간마다 갱신 · 주간 업보트 순' : '2시간마다 갱신 · 점수 없음(RSS) — 최신순'),
        src('lobsters', 'Lobsters', lobsters, true, '6시간마다 갱신 · 업보트+댓글×2 기준'),
        src('arxiv', 'arXiv (cs.AI)', arxiv, false, '하루 1회 갱신 · 등록순'),
      ]
    : [
        src('hn', 'Hacker News', hn, true, '2시간마다 갱신 · 업보트+댓글×2 기준'),
        src('reddit', 'Reddit', reddit.posts, reddit.ranked,
          reddit.ranked ? '2시간마다 갱신 · 주간 업보트 순' : '2시간마다 갱신 · 점수 없음(RSS) — 최신순'),
        src('biorxiv', 'bioRxiv · medRxiv', biorxiv, false, '하루 1회 갱신 · 공개순'),
        src('trials', 'ClinicalTrials · FDA', trials, false, '하루 1회 갱신 · 갱신순'),
        src('pubmed', 'PubMed', pubmed, false, '하루 1회 갱신 · 게재순'),
      ];

  // 응답이 아예 없는 소스는 자리만 차지하므로 빼되, 전부 실패했으면 그대로 둬서
  // "왜 비었는지"(연결 필요/응답 없음)를 화면이 말할 수 있게 한다.
  const alive = list.filter(s => s.posts.length > 0);
  return alive.length > 0 ? alive : list;
}
