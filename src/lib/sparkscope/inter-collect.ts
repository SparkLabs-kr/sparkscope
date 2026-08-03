import { prisma } from '@/lib/prisma';

// 소스 목록은 팀에서 정한 4개 카테고리 기준(2026-07-31). 여기 딱 한 곳만 고치면 전체 파이프라인에 반영됨.
// 검증일 기준으로 공개 RSS가 없거나(구독 전용/봇 차단/공식 종료) 살릴 방법을 못 찾은 3곳은 주석으로 남겨둠 —
// 대체 피드를 찾으면 그때 추가.
export const FEEDS: Record<string, string> = {
  // === [AI, 스타트업 버티컬 전문지] ===
  'TechCrunch': 'https://techcrunch.com/feed/',
  // 'The Information': 구독자 전용 RSS라 봇 요청은 403 — 대체 피드 없음
  'VentureBeat': 'https://venturebeat.com/feed/',
  'CB Insights': 'https://www.cbinsights.com/research/feed/',
  'Wired': 'https://www.wired.com/feed/rss',
  'The Verge': 'https://www.theverge.com/rss/index.xml', // Atom 포맷
  'Ars Technica': 'https://feeds.arstechnica.com/arstechnica/index',

  // === [바이오, 헬스케어 버티컬 전문지] ===
  'Endpoints News': 'https://endpts.com/category/news/feed/',
  'STAT News': 'https://www.statnews.com/feed',
  'Fierce Biotech': 'https://www.fiercebiotech.com/rss.xml',
  'BioCentury': 'https://www.biocentury.com/rss/news.xml',
  'BioPharma Dive': 'https://www.biopharmadive.com/feeds/news/',

  // === [오피니언 리딩 사이트] ===
  'MIT Tech Review': 'https://www.technologyreview.com/feed/',
  'Nature': 'https://www.nature.com/nature.rss',
  'Cell': 'https://www.cell.com/action/showFeed?ui=0&mi=0&ai=n2h&jc=cell&type=etoc&feed=rss',
  'Science': 'https://www.science.org/action/showFeed?type=etoc&feed=rss&jc=science',
  // 'Scientific American': 공개 RSS 엔드포인트를 찾지 못함(기존/대체 URL 전부 404/네트워크 실패) — 대체 피드 없음

  // === [종합 경제 대표지] ===
  'Bloomberg': 'https://feeds.bloomberg.com/markets/news.rss',
  'Wall Street Journal': 'https://feeds.a.dj.com/rss/RSSWSJD.xml',
  'Financial Times': 'https://www.ft.com/rss/home',
  // 'Reuters': 2020년에 공개 RSS를 전면 종료해서 무료로 받아올 방법이 없음(현재 URL도 401) — 유료 API 필요
  'New York Times': 'https://feeds.nytimes.com/nyt/rss/technology',
  'CNN': 'http://rss.cnn.com/rss/cnn_tech.rss',
  // 'Washington Post': RSS 엔드포인트가 전부 홈페이지 HTML로 리다이렉트됨(자체 RSS 서비스 종료) — 대체 피드 없음
};

export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

// RSS(<title>text</title>, <link>url</link>, <pubDate>)와 Atom(<title type="...">, <link href="url"/>, <updated>/<published>)
// 둘 다 지원. <channel>/<feed> 레벨에도 title·link가 한 번씩 나오는데 그건 <item>/<entry> 블록 밖이라 여기 안 걸림 —
// 예전엔 title/link/pubDate를 각각 배열로 뽑아서 index로 짝지었는데, channel 레벨 title·link 때문에
// item들이 한 칸씩 밀려서 (예: Washington Post 채널 제목이 첫 "기사"로 잘못 들어가는) 버그가 있었음.
export function parseFeedItems(xml: string): Array<{ title: string; url: string; pubDate: string }> {
  const blocks = [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>|<entry\b[^>]*>([\s\S]*?)<\/entry>/g)];
  return blocks.map(b => {
    const block = b[1] ?? b[2] ?? '';
    const title = block.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/)?.[1] ?? '';
    const link =
      block.match(/<link(?:\s[^>]*)?>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/)?.[1] ??
      block.match(/<link[^>]*\shref=["']([^"']+)["'][^>]*\/?>/)?.[1] ??
      '';
    const pubDate =
      block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] ??
      block.match(/<(?:updated|published)>([\s\S]*?)<\/(?:updated|published)>/)?.[1] ??
      '';
    return { title: title.trim(), url: link.trim(), pubDate: pubDate.trim() };
  });
}

async function fetchTitles(name: string, url: string, limit = 6): Promise<Array<{ source: string; title: string; url: string; publishedAt: Date }>> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' },
    });
    const xml = await res.text();

    const titles = parseFeedItems(xml)
      .map(t => ({ ...t, title: decodeEntities(t.title) }))
      .filter(t => t.title && t.url);

    return titles.slice(0, limit).map(t => ({
      source: name,
      title: t.title,
      url: t.url,
      publishedAt: t.pubDate ? new Date(t.pubDate) : new Date(),
    }));
  } catch (e: any) {
    console.error(`[Inter] ${name} 피드 실패: ${e.message}`);
    return [];
  }
}

// URL로 중복 체크 후 없으면 저장. 이미 있으면 null 반환.
export async function saveInterNewsIfNew(article: { source: string; title: string; url: string; publishedAt: Date }): Promise<string | null> {
  const existing = await prisma.interNews.findUnique({
    where: { url: article.url },
  });

  if (existing) {
    return null;
  }

  const news = await prisma.interNews.create({
    data: {
      source: article.source,
      title: article.title,
      url: article.url,
      publishedAt: article.publishedAt,
      collectedAt: new Date(),
    },
  });

  return news.id;
}

export async function collectInterNews(): Promise<{ newsIds: string[]; count: number; failed: string[] }> {
  console.log('[Inter] RSS 수집 시작...');

  const newsIds: string[] = [];
  const failed: string[] = [];

  for (const [name, url] of Object.entries(FEEDS)) {
    const articles = await fetchTitles(name, url);

    for (const article of articles) {
      try {
        const newsId = await saveInterNewsIfNew(article);
        if (newsId) newsIds.push(newsId);
      } catch (e: any) {
        console.error(`[Inter] ${article.source} 저장 실패: ${e.message}`);
        failed.push(article.source);
      }
    }
  }

  console.log(`[Inter] 수집 완료: ${newsIds.length}건 (신규), ${failed.length}개 피드 실패`);
  return { newsIds, count: newsIds.length, failed };
}
