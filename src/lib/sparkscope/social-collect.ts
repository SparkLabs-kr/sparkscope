/**
 * 소셜 시그널 — Inter 탭 도메인(바이오/AI)별로 커뮤니티에서 가장 화제인 글을 모은다.
 *
 * 소스별 현실 (2026-08-27 실측):
 *  - Hacker News: Algolia API가 무료·무인증이고 points·num_comments를 함께 준다.
 *    → 유일하게 "진짜 인기순" 정렬이 가능한 소스.
 *  - Reddit: JSON API(/hot.json)는 인증 없이 403. RSS(/hot/.rss)만 200이지만
 *    제목·링크뿐이라 점수가 없다 → 최신순으로만 보여준다.
 *    REDDIT_CLIENT_ID/SECRET을 넣으면 OAuth로 승격돼 점수가 붙는다(등록은 무료).
 *  - X: 공개 스크래핑 경로가 없고 API는 유료(Basic $200/월). X_BEARER_TOKEN이
 *    있을 때만 활성화되고, 없으면 빈 상태로 둔다 — 지어낸 글을 섞지 않는다.
 *
 * DB에 쌓지 않는다. "지금 뜨는 글" 패널이라 이력이 필요 없고, 스키마 변경 없이
 * 라우트 캐시(revalidate)만으로 충분하다.
 */

export type SocialDomain = 'ai' | 'bio';
export type SocialSourceId = 'hn' | 'reddit' | 'x';

export interface SocialPost {
  title: string;
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
  posts: SocialPost[];
}

const HN_QUERIES: Record<SocialDomain, string[]> = {
  ai: ['AI agent', 'LLM', 'machine learning', 'OpenAI', 'Anthropic', 'GPU inference', 'foundation model'],
  bio: ['biotech', 'CRISPR', 'drug discovery', 'FDA approval', 'clinical trial', 'gene therapy', 'protein folding'],
};

const SUBREDDITS: Record<SocialDomain, string[]> = {
  ai: ['MachineLearning', 'artificial', 'singularity'],
  bio: ['biotech', 'labrats', 'bioengineering'],
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

  for (const q of HN_QUERIES[domain]) {
    const url = 'https://hn.algolia.com/api/v1/search?' + new URLSearchParams({
      query: q, tags: 'story',
      numericFilters: `created_at_i>${since},points>20`,
      hitsPerPage: '20',
    });
    try {
      const json = JSON.parse(await getText(url)) as { hits?: any[] };
      for (const h of json.hits ?? []) {
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
    } catch (e) {
      console.error('[social] HN 조회 실패:', q, e);
    }
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
        const out: SocialPost[] = [];
        for (const sub of SUBREDDITS[domain]) {
          const res = await fetch(`https://oauth.reddit.com/r/${sub}/top?t=month&limit=10`, {
            headers: { Authorization: `Bearer ${access_token}`, 'User-Agent': 'SparkScope/1.0' },
            next: { revalidate: 1800 },
          });
          if (!res.ok) continue;
          const j = await res.json() as any;
          for (const c of j?.data?.children ?? []) {
            const d = c.data;
            if (!d?.title || isChrome(d.title)) continue;
            out.push({
              title: d.title, url: `https://www.reddit.com${d.permalink}`,
              date: ymd(d.created_utc * 1000), points: d.ups, comments: d.num_comments,
              origin: `r/${sub}`,
            });
          }
        }
        return {
          posts: out.sort((a, b) => ((b.points ?? 0) + (b.comments ?? 0) * 2) - ((a.points ?? 0) + (a.comments ?? 0) * 2)).slice(0, 10),
          ranked: true,
        };
      }
    } catch (e) {
      console.error('[social] Reddit OAuth 실패 — RSS로 폴백:', e);
    }
  }

  const out: SocialPost[] = [];
  for (const sub of SUBREDDITS[domain]) {
    try {
      const xml = await getText(`https://www.reddit.com/r/${sub}/hot/.rss?limit=12`);
      for (const entry of xml.match(/<entry>[\s\S]*?<\/entry>/g) ?? []) {
        const title = entry.match(/<title>([\s\S]*?)<\/title>/)?.[1];
        const url = entry.match(/<link href="(.*?)"/)?.[1];
        const upd = entry.match(/<updated>(.*?)<\/updated>/)?.[1];
        if (!title || !url || isChrome(title)) continue;
        out.push({ title: decodeXml(title.trim()), url, date: (upd ?? '').slice(0, 10), origin: `r/${sub}` });
      }
    } catch (e) {
      console.error('[social] Reddit RSS 실패:', sub, e);
    }
  }
  return { posts: out.slice(0, 10), ranked: false };
}

function decodeXml(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

/** X — 유료 토큰이 있을 때만. 없으면 빈 상태로 두고 이유를 화면에 남긴다. */
async function fetchX(domain: SocialDomain): Promise<{ posts: SocialPost[]; connected: boolean }> {
  const token = process.env.X_BEARER_TOKEN;
  if (!token) return { posts: [], connected: false };

  const q = domain === 'ai'
    ? '(AI OR LLM OR "machine learning") -is:retweet lang:en'
    : '(biotech OR CRISPR OR "drug discovery") -is:retweet lang:en';
  try {
    const url = 'https://api.x.com/2/tweets/search/recent?' + new URLSearchParams({
      query: q, max_results: '25', 'tweet.fields': 'public_metrics,created_at',
    });
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, next: { revalidate: 1800 } });
    if (!res.ok) throw new Error(`x api ${res.status}`);
    const j = await res.json() as any;
    const posts: SocialPost[] = (j.data ?? []).map((t: any) => ({
      title: t.text,
      url: `https://x.com/i/web/status/${t.id}`,
      date: (t.created_at ?? '').slice(0, 10),
      points: t.public_metrics?.like_count ?? 0,
      comments: t.public_metrics?.reply_count ?? 0,
    }));
    return {
      posts: posts.sort((a, b) => ((b.points ?? 0) + (b.comments ?? 0) * 2) - ((a.points ?? 0) + (a.comments ?? 0) * 2)).slice(0, 10),
      connected: true,
    };
  } catch (e) {
    console.error('[social] X 조회 실패:', e);
    return { posts: [], connected: false };
  }
}

export async function collectSocialSignals(domain: SocialDomain, sinceMs: number): Promise<SocialSource[]> {
  const [hn, reddit, x] = await Promise.all([
    fetchHackerNews(domain, sinceMs).catch(() => [] as SocialPost[]),
    fetchReddit(domain).catch(() => ({ posts: [] as SocialPost[], ranked: false })),
    fetchX(domain).catch(() => ({ posts: [] as SocialPost[], connected: false })),
  ]);

  return [
    {
      id: 'x', label: 'X', connected: x.connected, ranked: x.connected,
      note: x.connected ? '연결됨 · 좋아요+답글 기준' : '연결 필요 — X_BEARER_TOKEN 미설정 (API 유료)',
      posts: x.posts,
    },
    {
      id: 'hn', label: 'Hacker News', connected: hn.length > 0, ranked: true,
      note: '연결됨 · 업보트+댓글×2 기준',
      posts: hn,
    },
    {
      id: 'reddit', label: 'Reddit', connected: reddit.posts.length > 0, ranked: reddit.ranked,
      note: reddit.ranked ? '연결됨 · 업보트+댓글×2 기준' : '연결됨 · 점수 없음(RSS) — 최신순',
      posts: reddit.posts,
    },
  ];
}
