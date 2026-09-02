/**
 * AI 시그널 수집 (2.2) — 커뮤니티·개발자 채널에서 지금 화제인 것들.
 *
 * 기존 social-collect.ts 와의 차이:
 *   · social-collect.ts 는 "지금 뜨는 글" 패널용이라 조회만 하고 버린다.
 *   · 여기서 모은 것은 DB에 쌓인다(SocialSignal + SocialSignalSample). 열기 점수의 핵심이
 *     "얼마나 빨리 오르고 있는가"인데, 그건 한 번의 조회로는 알 수 없기 때문이다.
 *
 * 소스는 문자열 id로만 구분하고, 수집 함수는 전부 같은 RawSignal을 돌려준다.
 * 나중에 X를 붙일 때 이 파일에 함수 하나만 추가하면 되도록 — 저장·점수·화면은 손대지 않는다.
 *
 * 2026-09-02 실측 기준
 *   · Hacker News (Algolia)  — 무인증, points·num_comments 제공          ✅
 *   · GitHub search          — 무인증 시간당 60회, GITHUB_TOKEN 있으면 5000회 ✅
 *   · Hugging Face Papers    — 무인증, upvotes·numComments 제공           ✅
 *   · AI 블로그 RSS          — 점수 없음(발행 자체가 신호)                 ✅
 *   · Reddit                 — 점수를 받으려면 REDDIT_CLIENT_ID/SECRET 필요(무료 등록)
 *   · X                      — 공개 스크래핑 경로 없음(x.com은 JS 셸, syndication은 429,
 *                              nitter는 서비스 종료). X_BEARER_TOKEN이 있을 때만 붙인다.
 */
import { prisma } from '@/lib/prisma';

export type SignalDomain = 'ai' | 'bio';

/** 소스가 무엇이든 이 모양으로 맞춰서 돌려준다. */
export interface RawSignal {
  source: string;
  externalId: string;
  domain: SignalDomain;
  title: string;
  url: string;
  origin?: string;
  author?: string;
  publishedAt?: Date;
  /** 업보트 · 스타 · 좋아요. 점수 개념이 없는 소스(블로그)는 0. */
  points: number;
  comments: number;
}

const UA = 'SparkScope/1.0 (+https://sparkscope.sparklabs.co.kr)';

async function getJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, cache: 'no-store' });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json() as Promise<T>;
}

async function getText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, cache: 'no-store', redirect: 'follow' });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.text();
}

function decodeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'").replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .trim();
}

/** 주간 공지·채용 스레드 등은 트렌드가 아니다. social-collect.ts와 같은 기준. */
const SKIP = ['self-promotion', "who's hiring", 'monthly', 'weekly', 'simple questions', 'megathread'];
const isChrome = (t: string) => SKIP.some(s => t.toLowerCase().includes(s));

// ────────────────────────────────────────────────────────────────
// Hacker News — 무인증, 점수 있음
// ────────────────────────────────────────────────────────────────
const HN_QUERIES: Record<SignalDomain, string[]> = {
  ai: ['AI agent', 'LLM', 'machine learning', 'OpenAI', 'Anthropic', 'GPU inference', 'foundation model'],
  bio: ['biotech', 'CRISPR', 'drug discovery', 'FDA approval', 'clinical trial', 'gene therapy'],
};

async function fromHackerNews(domain: SignalDomain, sinceMs: number): Promise<RawSignal[]> {
  const since = Math.floor(sinceMs / 1000);
  const seen = new Map<string, RawSignal>();

  for (const q of HN_QUERIES[domain]) {
    const url = 'https://hn.algolia.com/api/v1/search?' + new URLSearchParams({
      query: q, tags: 'story',
      // points>5 — 열기 점수는 상승 속도를 보므로, 아직 낮지만 오르는 중인 글도 담아둔다.
      numericFilters: `created_at_i>${since},points>5`,
      hitsPerPage: '30',
    });
    try {
      const json = await getJson<{ hits?: any[] }>(url);
      for (const h of json.hits ?? []) {
        if (!h?.title || !h.objectID || seen.has(h.objectID) || isChrome(h.title)) continue;
        seen.set(h.objectID, {
          source: 'hn',
          externalId: String(h.objectID),
          domain,
          title: h.title,
          url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
          origin: 'Hacker News',
          author: h.author ?? undefined,
          publishedAt: h.created_at_i ? new Date(h.created_at_i * 1000) : undefined,
          points: h.points ?? 0,
          comments: h.num_comments ?? 0,
        });
      }
    } catch (e) {
      console.error('[ai-signal] HN 실패:', q, e);
    }
  }
  return [...seen.values()];
}

// ────────────────────────────────────────────────────────────────
// GitHub — 최근 움직임이 있는 AI 저장소. 스타 수가 points.
//
// 스타 "증가 속도"는 API가 직접 주지 않는다. 우리가 시점별로 샘플을 남기므로
// 속도는 저장 쪽에서 계산된다 — 여기서는 현재 스타 수만 정확히 가져오면 된다.
// ────────────────────────────────────────────────────────────────
const GH_TOPICS: Record<SignalDomain, string[]> = {
  ai: ['llm', 'ai-agents', 'rag', 'generative-ai', 'llmops'],
  bio: ['bioinformatics', 'computational-biology', 'drug-discovery'],
};

async function fromGitHub(domain: SignalDomain, sinceMs: number): Promise<RawSignal[]> {
  const pushedSince = new Date(sinceMs).toISOString().slice(0, 10);
  const token = process.env.GITHUB_TOKEN;
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const out = new Map<string, RawSignal>();
  for (const topic of GH_TOPICS[domain]) {
    const url = 'https://api.github.com/search/repositories?' + new URLSearchParams({
      q: `topic:${topic} pushed:>${pushedSince}`,
      sort: 'stars', order: 'desc', per_page: '20',
    });
    try {
      const json = await getJson<{ items?: any[] }>(url, headers);
      for (const r of json.items ?? []) {
        if (!r?.full_name || out.has(r.full_name)) continue;
        out.set(r.full_name, {
          source: 'github',
          externalId: r.full_name,
          domain,
          // 저장소는 제목이 없으므로 이름 + 한 줄 설명을 제목처럼 쓴다.
          title: r.description ? `${r.full_name} — ${r.description}` : r.full_name,
          url: r.html_url,
          origin: 'GitHub',
          author: r.owner?.login ?? undefined,
          publishedAt: r.created_at ? new Date(r.created_at) : undefined,
          points: r.stargazers_count ?? 0,
          comments: r.open_issues_count ?? 0,
        });
      }
    } catch (e) {
      // 무인증은 시간당 60회 제한이라 403이 날 수 있다 — 조용히 넘긴다.
      console.error('[ai-signal] GitHub 실패:', topic, e);
    }
  }
  return [...out.values()];
}

// ────────────────────────────────────────────────────────────────
// Hugging Face Daily Papers — 무인증, upvotes 제공. AI 도메인 전용.
// ────────────────────────────────────────────────────────────────
async function fromHuggingFace(domain: SignalDomain): Promise<RawSignal[]> {
  if (domain !== 'ai') return [];
  try {
    const items = await getJson<any[]>('https://huggingface.co/api/daily_papers?limit=50');
    return (items ?? []).flatMap<RawSignal>(it => {
      const id = it?.paper?.id;
      const title = it?.title ?? it?.paper?.title;
      if (!id || !title) return [];
      return [{
        source: 'hf_papers',
        externalId: String(id),
        domain: 'ai',
        title: String(title).replace(/\s+/g, ' ').trim(),
        url: `https://huggingface.co/papers/${id}`,
        origin: 'Hugging Face Papers',
        author: it?.submittedBy?.name ?? it?.paper?.authors?.[0]?.name ?? undefined,
        publishedAt: it?.publishedAt ? new Date(it.publishedAt) : undefined,
        points: it?.paper?.upvotes ?? 0,
        comments: it?.numComments ?? 0,
      }];
    });
  } catch (e) {
    console.error('[ai-signal] Hugging Face 실패:', e);
    return [];
  }
}

// ────────────────────────────────────────────────────────────────
// AI 블로그 — 점수가 없다. 발행됐다는 사실 자체가 신호라, 열기 점수에서는
// 신선도로만 다룬다(점수 0). 연구소가 직접 쓰는 글이라 주류 매체보다 빠르다.
//
// 2026-09-02 확인: Anthropic(anthropic.com/rss.xml)과 Meta AI(ai.meta.com/blog/rss/)는
// 404라 제외했다. 주소를 찾으면 여기에 한 줄 추가하면 된다.
// ────────────────────────────────────────────────────────────────
const BLOG_FEEDS: Record<SignalDomain, { name: string; url: string }[]> = {
  ai: [
    { name: 'OpenAI', url: 'https://openai.com/news/rss.xml' },
    { name: 'Google DeepMind', url: 'https://deepmind.google/blog/rss.xml' },
    { name: 'Google AI', url: 'https://blog.google/technology/ai/rss/' },
    { name: 'Hugging Face', url: 'https://huggingface.co/blog/feed.xml' },
    { name: 'Microsoft Research', url: 'https://www.microsoft.com/en-us/research/feed/' },
    { name: 'Simon Willison', url: 'https://simonwillison.net/atom/everything/' },
    { name: 'Import AI', url: 'https://importai.substack.com/feed' },
  ],
  bio: [],
};

/** RSS와 Atom을 함께 처리한다 — 피드마다 형식이 다르다. */
function parseFeed(xml: string): { title: string; url: string; date?: Date }[] {
  const blocks = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/g) ?? [];
  return blocks.flatMap(b => {
    const title = b.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1];
    // RSS는 <link>텍스트</link>, Atom은 <link href="..."/>
    const url = b.match(/<link[^>]*href="([^"]+)"/)?.[1] ?? b.match(/<link>([\s\S]*?)<\/link>/)?.[1];
    const raw = b.match(/<(pubDate|published|updated)>([\s\S]*?)<\/\1>/)?.[2];
    if (!title || !url) return [];
    const d = raw ? new Date(raw.trim()) : undefined;
    return [{ title: decodeXml(title), url: decodeXml(url), date: d && !isNaN(+d) ? d : undefined }];
  });
}

async function fromBlogs(domain: SignalDomain, sinceMs: number): Promise<RawSignal[]> {
  const feeds = BLOG_FEEDS[domain];
  const results = await Promise.all(feeds.map(async f => {
    try {
      const entries = parseFeed(await getText(f.url));
      return entries
        // 피드에 수백 건이 들어 있는 곳이 있어(OpenAI 1163건) 기간으로 자른다.
        .filter(e => e.date && e.date.getTime() >= sinceMs)
        .slice(0, 15)
        .map<RawSignal>(e => ({
          source: 'blog',
          externalId: e.url,
          domain,
          title: e.title,
          url: e.url,
          origin: f.name,
          publishedAt: e.date,
          points: 0,
          comments: 0,
        }));
    } catch (e) {
      console.error('[ai-signal] 블로그 실패:', f.name, e);
      return [] as RawSignal[];
    }
  }));
  return results.flat();
}

// ────────────────────────────────────────────────────────────────
// Reddit — 자격증명이 있을 때만. RSS 폴백은 점수가 없어서 열기 점수에 못 쓴다.
// ────────────────────────────────────────────────────────────────
const SUBREDDITS: Record<SignalDomain, string[]> = {
  ai: ['MachineLearning', 'LocalLLaMA', 'artificial', 'singularity'],
  bio: ['biotech', 'bioinformatics'],
};

async function fromReddit(domain: SignalDomain): Promise<RawSignal[]> {
  const id = process.env.REDDIT_CLIENT_ID;
  const secret = process.env.REDDIT_CLIENT_SECRET;
  if (!id || !secret) return [];

  try {
    const auth = Buffer.from(`${id}:${secret}`).toString('base64');
    const tokenRes = await fetch('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
      body: 'grant_type=client_credentials',
      cache: 'no-store',
    });
    const { access_token } = (await tokenRes.json()) as { access_token?: string };
    if (!access_token) return [];

    const out: RawSignal[] = [];
    for (const sub of SUBREDDITS[domain]) {
      const res = await fetch(`https://oauth.reddit.com/r/${sub}/hot?limit=25`, {
        headers: { Authorization: `Bearer ${access_token}`, 'User-Agent': UA },
        cache: 'no-store',
      });
      if (!res.ok) continue;
      const j = (await res.json()) as any;
      for (const c of j?.data?.children ?? []) {
        const d = c.data;
        if (!d?.id || !d.title || d.stickied || isChrome(d.title)) continue;
        out.push({
          source: 'reddit',
          externalId: d.id,
          domain,
          title: d.title,
          url: `https://www.reddit.com${d.permalink}`,
          origin: `r/${sub}`,
          author: d.author ?? undefined,
          publishedAt: d.created_utc ? new Date(d.created_utc * 1000) : undefined,
          points: d.ups ?? 0,
          comments: d.num_comments ?? 0,
        });
      }
    }
    return out;
  } catch (e) {
    console.error('[ai-signal] Reddit 실패:', e);
    return [];
  }
}

// ────────────────────────────────────────────────────────────────
// X — 토큰이 있을 때만. 공개 스크래핑 경로는 2026-09-02 기준 존재하지 않는다
// (x.com은 로그인 필요한 JS 셸, syndication API는 429, nitter는 종료).
// 토큰이 생기면 이 함수만 채우면 나머지는 그대로 동작한다.
// ────────────────────────────────────────────────────────────────
async function fromX(domain: SignalDomain): Promise<RawSignal[]> {
  const token = process.env.X_BEARER_TOKEN;
  if (!token) return [];
  const q = domain === 'ai'
    ? '(AI OR LLM OR "machine learning") -is:retweet lang:en'
    : '(biotech OR CRISPR OR "drug discovery") -is:retweet lang:en';
  try {
    const url = 'https://api.x.com/2/tweets/search/recent?' + new URLSearchParams({
      query: q, max_results: '50', 'tweet.fields': 'public_metrics,created_at,author_id',
    });
    const j = await getJson<any>(url, { Authorization: `Bearer ${token}` });
    return (j.data ?? []).map((t: any) => ({
      source: 'x',
      externalId: String(t.id),
      domain,
      title: String(t.text ?? '').replace(/\s+/g, ' ').trim(),
      url: `https://x.com/i/web/status/${t.id}`,
      origin: 'X',
      author: t.author_id ?? undefined,
      publishedAt: t.created_at ? new Date(t.created_at) : undefined,
      points: t.public_metrics?.like_count ?? 0,
      comments: t.public_metrics?.reply_count ?? 0,
    }));
  } catch (e) {
    console.error('[ai-signal] X 실패:', e);
    return [];
  }
}

/** 어떤 소스가 실제로 붙어 있는지 — 화면에 상태를 그대로 보여주기 위해. */
export function signalSourceStatus(): { id: string; label: string; connected: boolean; note: string }[] {
  return [
    { id: 'hn', label: 'Hacker News', connected: true, note: '무인증 · 업보트·댓글 제공' },
    { id: 'github', label: 'GitHub', connected: true, note: process.env.GITHUB_TOKEN ? '토큰 있음 · 시간당 5000회' : '무인증 · 시간당 60회' },
    { id: 'hf_papers', label: 'Hugging Face Papers', connected: true, note: '무인증 · 업보트 제공' },
    { id: 'blog', label: 'AI 블로그', connected: true, note: '점수 없음 — 발행 자체가 신호' },
    { id: 'reddit', label: 'Reddit', connected: !!process.env.REDDIT_CLIENT_ID, note: process.env.REDDIT_CLIENT_ID ? '연결됨 · 업보트 제공' : '연결 필요 — REDDIT_CLIENT_ID/SECRET (등록 무료)' },
    { id: 'x', label: 'X', connected: !!process.env.X_BEARER_TOKEN, note: process.env.X_BEARER_TOKEN ? '연결됨' : '미연결 — 공개 스크래핑 경로 없음, API 유료' },
  ];
}

/**
 * 모든 소스에서 모은다. 한 소스가 죽어도 나머지는 그대로 들어온다 —
 * 하나가 실패했다고 배너 전체가 비면 안 된다.
 */
export async function collectAiSignals(domain: SignalDomain, sinceMs: number): Promise<RawSignal[]> {
  const settled = await Promise.allSettled([
    fromHackerNews(domain, sinceMs),
    fromGitHub(domain, sinceMs),
    fromHuggingFace(domain),
    fromBlogs(domain, sinceMs),
    fromReddit(domain),
    fromX(domain),
  ]);

  const all: RawSignal[] = [];
  for (const r of settled) {
    if (r.status === 'fulfilled') all.push(...r.value);
    else console.error('[ai-signal] 소스 실패:', r.reason);
  }

  // 같은 (source, externalId)가 두 번 들어오면 뒤엣것을 버린다 — upsert 충돌 방지.
  const seen = new Set<string>();
  return all.filter(s => {
    const k = `${s.source}:${s.externalId}`;
    if (seen.has(k) || !s.title.trim()) return false;
    seen.add(k);
    return true;
  });
}

/**
 * 수집한 것을 저장한다. 처음 보는 항목은 새로 만들고, 이미 있으면 최신 수치로 갱신하며,
 * 어느 쪽이든 이번 시점의 수치를 샘플로 한 줄 남긴다 — 그 차이가 상승 속도가 된다.
 */
export async function storeSignals(signals: RawSignal[]): Promise<{ created: number; updated: number }> {
  let created = 0;
  let updated = 0;

  for (const s of signals) {
    try {
      const existing = await prisma.socialSignal.findUnique({
        where: { source_externalId: { source: s.source, externalId: s.externalId } },
        select: { id: true },
      });

      const row = existing
        ? await prisma.socialSignal.update({
            where: { id: existing.id },
            data: {
              title: s.title, url: s.url, origin: s.origin, author: s.author,
              points: s.points, comments: s.comments, lastSeenAt: new Date(),
            },
            select: { id: true },
          })
        : await prisma.socialSignal.create({
            data: {
              source: s.source, externalId: s.externalId, domain: s.domain,
              title: s.title, url: s.url, origin: s.origin, author: s.author,
              publishedAt: s.publishedAt, points: s.points, comments: s.comments,
            },
            select: { id: true },
          });

      existing ? updated++ : created++;
      await prisma.socialSignalSample.create({
        data: { signalId: row.id, points: s.points, comments: s.comments },
      });
    } catch (e) {
      console.error('[ai-signal] 저장 실패:', s.source, s.externalId, e);
    }
  }

  return { created, updated };
}

/** 오래된 샘플 정리. 소스×아이템×시간이라 놔두면 계속 늘어난다. */
export async function pruneSignalSamples(keepDays = 7): Promise<number> {
  const cutoff = new Date(Date.now() - keepDays * 86400_000);
  const { count } = await prisma.socialSignalSample.deleteMany({ where: { sampledAt: { lt: cutoff } } });
  return count;
}
