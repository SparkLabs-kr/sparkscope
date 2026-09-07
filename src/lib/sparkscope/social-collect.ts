/**
 * 소셜 시그널 — Inter 탭 도메인(바이오/AI)별로 커뮤니티에서 가장 화제인 글을 모은다.
 *
 * 소스별 현실 (2026-08-27 실측):
 *  - Hacker News: Algolia API가 무료·무인증이고 points·num_comments를 함께 준다.
 *    → 유일하게 "진짜 인기순" 정렬이 가능한 소스.
 *  - Reddit: JSON API(/hot.json)는 인증 없이 403. RSS(/hot/.rss)만 200이지만
 *    제목·링크뿐이라 점수가 없다 → 최신순으로만 보여준다.
 *    REDDIT_CLIENT_ID/SECRET을 넣으면 OAuth로 승격돼 점수가 붙는다(등록은 무료).
 *  - X: 무료 경로가 없고 API가 유료(Basic $200/월)라 2026-09-04에 제외했다.
 *    토큰을 사면 git 이력의 fetchX를 되살리면 된다.
 *
 * DB에 쌓지 않는다. "지금 뜨는 글" 패널이라 이력이 필요 없고, 스키마 변경 없이
 * 라우트 캐시(revalidate)만으로 충분하다.
 */

export type SocialDomain = 'ai' | 'bio';
export type SocialSourceId = 'hn' | 'reddit';

export interface SocialPost {
  title: string;
  /** 한국어 제목 — KO 화면일 때만 라우트가 채운다. 없으면 원문(title)을 쓴다. */
  titleKo?: string;
  url: string;
  date: string;          // YYYY-MM-DD
  points?: number;       // 없으면 점수 미제공 소스
  comments?: number;
  origin?: string;       // r/biotech 등
}

export interface SocialSource {
  id: SocialSourceId;
  label: string;
  connected: boolean;
  ranked: boolean;       // true면 인기순, false면 최신순
  note: string;          // 화면에 그대로 노출되는 상태 설명
  /** 왜 이 커뮤니티를 골랐는지 — 어떤 사람들이 모이고 무슨 뉴스가 먼저 뜨는지. */
  why: string;
  posts: SocialPost[];
}

/**
 * 매체 선정 이유 — 화면에 그대로 나간다.
 * "왜 하필 여기냐"는 질문에 매번 말로 답하지 않으려고 코드에 적어 둔다.
 */
const WHY: Record<SocialSourceId, string> = {
  hn: '실리콘밸리 엔지니어·창업자가 모이는 곳. 논문·오픈소스·기술 발표가 언론 보도보다 며칠 먼저 올라오고, 댓글에 현업자 검증이 붙는다.',
  reddit: '분야별 종사자 커뮤니티. 업계 내부 분위기(채용·실험 실패·규제 체감)가 기사로 나오기 전에 먼저 드러난다.',
};

const HN_QUERIES: Record<SocialDomain, string[]> = {
  ai: ['AI agent', 'LLM', 'machine learning', 'OpenAI', 'Anthropic', 'GPU inference', 'foundation model'],
  bio: ['biotech', 'CRISPR', 'drug discovery', 'FDA approval', 'clinical trial', 'gene therapy', 'protein folding'],
};

/**
 * 서브레딧 — 2026-09-07에 도메인당 3개 → 7개로 확장.
 *
 * 고를 때 기준: (1) 실무자가 모이는 곳, (2) 뉴스가 실제로 먼저 도는 곳.
 * 밈·잡담 위주(r/singularity의 상당수)는 유지하되 실무 커뮤니티를 더 얹어 희석한다.
 *  - LocalLLaMA: 오픈소스 모델 공개가 사실상 여기서 가장 먼저 돈다(AI 최대 실무 커뮤니티).
 *  - deeplearning: 기술 논의 중심.
 *  - OpenAI·LLMDevs: 제품·API 변경이 공지보다 빨리 공유된다.
 *  - pharma·clinicalresearch: 산업·임상·규제 쪽 종사자.
 *  - bioinformatics·CRISPR: 연구 현장.
 */
const SUBREDDITS: Record<SocialDomain, string[]> = {
  ai: ['MachineLearning', 'LocalLLaMA', 'artificial', 'OpenAI', 'LLMDevs', 'deeplearning', 'singularity'],
  bio: ['biotech', 'labrats', 'bioengineering', 'pharma', 'bioinformatics', 'clinicalresearch', 'CRISPR'],
};

// 주간 공지·채용 스레드는 트렌드가 아니다.
const SKIP = ['self-promotion', "who's hiring", 'monthly', 'weekly', 'simple questions', 'megathread'];
const isChrome = (t: string) => SKIP.some(s => t.toLowerCase().includes(s));

const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);

async function getText(url: string, ua = 'SparkScope/1.0'): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': ua }, next: { revalidate: 1800 } });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.text();
}

/** Hacker News — 무료·무인증, 점수 있음. 정렬: 업보트 + 댓글×2. */
async function fetchHackerNews(domain: SocialDomain, sinceMs: number): Promise<SocialPost[]> {
  const since = Math.floor(sinceMs / 1000);
  const seen = new Map<string, SocialPost>();

  // 검색어 7개를 순차로 돌면 왕복이 7번이다 — 서로 독립이라 한꺼번에 던진다.
  // 중복 제거는 아래에서 objectID로 하므로 순서에 의존하지 않는다.
  const pages = await Promise.all(HN_QUERIES[domain].map(async q => {
    const url = 'https://hn.algolia.com/api/v1/search?' + new URLSearchParams({
      query: q, tags: 'story',
      numericFilters: `created_at_i>${since},points>20`,
      hitsPerPage: '20',
    });
    try {
      return (JSON.parse(await getText(url)) as { hits?: any[] }).hits ?? [];
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
      comments: h.num_comments ?? 0,
    });
  }
  return [...seen.values()]
    .sort((a, b) => ((b.points ?? 0) + (b.comments ?? 0) * 2) - ((a.points ?? 0) + (a.comments ?? 0) * 2))
    .slice(0, 10);
}

/**
 * Reddit — 자격증명이 있으면 OAuth(점수 있음), 없으면 RSS(최신순).
 * RSS는 rate limit이 빡빡해 429가 흔하다 — 실패한 서브레딧은 조용히 건너뛴다.
 */
async function fetchReddit(domain: SocialDomain): Promise<{ posts: SocialPost[]; ranked: boolean }> {
  const id = process.env.REDDIT_CLIENT_ID;
  const secret = process.env.REDDIT_CLIENT_SECRET;

  if (id && secret) {
    try {
      const auth = Buffer.from(`${id}:${secret}`).toString('base64');
      const tokenRes = await fetch('https://www.reddit.com/api/v1/access_token', {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'SparkScope/1.0' },
        body: 'grant_type=client_credentials',
      });
      const { access_token } = await tokenRes.json() as { access_token?: string };
      if (access_token) {
        // 서브레딧을 순차로 돌면 개수에 비례해 느려진다(7개 = 왕복 7번).
        // 서로 독립이라 한꺼번에 던진다 — 실패한 것만 조용히 빠진다.
        const perSub = await Promise.all(SUBREDDITS[domain].map(async sub => {
          try {
            const res = await fetch(`https://oauth.reddit.com/r/${sub}/top?t=month&limit=10`, {
              headers: { Authorization: `Bearer ${access_token}`, 'User-Agent': 'SparkScope/1.0' },
              next: { revalidate: 1800 },
            });
            if (!res.ok) return [];
            const j = await res.json() as any;
            return (j?.data?.children ?? []).flatMap((c: any) => {
              const d = c.data;
              if (!d?.title || isChrome(d.title)) return [];
              return [{
                title: d.title, url: `https://www.reddit.com${d.permalink}`,
                date: ymd(d.created_utc * 1000), points: d.ups, comments: d.num_comments,
                origin: `r/${sub}`,
              } as SocialPost];
            });
          } catch { return []; }
        }));
        const out: SocialPost[] = perSub.flat();
        return {
          posts: out.sort((a, b) => ((b.points ?? 0) + (b.comments ?? 0) * 2) - ((a.points ?? 0) + (a.comments ?? 0) * 2)).slice(0, 10),
          ranked: true,
        };
      }
    } catch (e) {
      console.error('[social] Reddit OAuth 실패 — RSS로 폴백:', e);
    }
  }

  // RSS도 마찬가지로 병렬. 429가 잦은 경로라 실패는 그 서브레딧만 버린다.
  const perSub = await Promise.all(SUBREDDITS[domain].map(async sub => {
    const acc: SocialPost[] = [];
    try {
      const xml = await getText(`https://www.reddit.com/r/${sub}/hot/.rss?limit=12`);
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

function decodeXml(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

// X는 2026-09-04에 뺐다. 무료 경로가 없어 토큰 없이는 항상 빈 칸이었고, 대시보드에
// "연결 필요"만 띄우는 칸은 자리만 차지했다. 토큰을 사면 fetchX를 되살리면 된다
// (git 이력에 남아 있다).

export async function collectSocialSignals(domain: SocialDomain, sinceMs: number): Promise<SocialSource[]> {
  const [hn, reddit] = await Promise.all([
    fetchHackerNews(domain, sinceMs).catch(() => [] as SocialPost[]),
    fetchReddit(domain).catch(() => ({ posts: [] as SocialPost[], ranked: false })),
  ]);

  return [
    {
      id: 'hn', label: 'Hacker News', connected: hn.length > 0, ranked: true,
      note: '연결됨 · 업보트+댓글×2 기준',
      why: WHY.hn,
      posts: hn,
    },
    {
      id: 'reddit', label: 'Reddit', connected: reddit.posts.length > 0, ranked: reddit.ranked,
      note: reddit.ranked ? '연결됨 · 업보트+댓글×2 기준' : '연결됨 · 점수 없음(RSS) — 최신순',
      why: WHY.reddit,
      posts: reddit.posts,
    },
  ];
}
