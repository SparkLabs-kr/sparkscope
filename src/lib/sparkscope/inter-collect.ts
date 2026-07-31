import { prisma } from '@/lib/prisma';

const FEEDS: Record<string, string> = {
  // === AI & 스타트업 버티컬 ===
  'TechCrunch': 'https://techcrunch.com/feed/',
  'The Information': 'https://www.theinformation.com/feed.rss',
  'VentureBeat': 'https://feeds.venturebeat.com/venturebeat/latest',
  'CB Insights': 'https://www.cbinsights.com/rss/combined.xml',
  'Wired': 'https://www.wired.com/feed/rss',
  'The Verge': 'https://www.theverge.com/rss/index.xml',
  'Ars Technica': 'https://feeds.arstechnica.com/arstechnica/index',

  // === 바이오 & 헬스케어 버티컬 ===
  'Endpoints News': 'https://www.endpointsnews.com/feed',
  'STAT News': 'https://www.statnews.com/feed',
  'Fierce Biotech': 'https://www.fiercebiotech.com/feed/rss',
  'BioCentury': 'https://www.biocentury.com/feed',
  'BioPharma Dive': 'https://www.biopharmadive.com/feeds/news.rss',

  // === 의견 & 학술 ===
  'MIT Tech Review': 'https://www.technologyreview.com/feed/',
  'Nature': 'https://www.nature.com/nature.rss',
  'Cell': 'https://www.cell.com/cell/home/rss',
  'Science': 'https://www.science.org/rss/all.xml',
  'Scientific American': 'https://feeds.scientificamerican.com/feeds/scientific-american-global-rss',

  // === 종합 경제 ===
  'Bloomberg': 'https://feeds.bloomberg.com/markets/news.rss',
  'Wall Street Journal': 'https://feeds.wsj.com/xml/rss/3_7085.xml',
  'Financial Times': 'https://feeds.ft.com/world/rss',
  'Reuters': 'https://www.reuters.com/technology',
  'New York Times': 'https://feeds.nytimes.com/nyt/rss/technology',
  'CNN': 'http://rss.cnn.com/rss/cnn_tech.rss',
  'Washington Post': 'https://feeds.washingtonpost.com/rss/business/technology',
};

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

async function fetchTitles(name: string, url: string, limit = 6): Promise<Array<{ source: string; title: string; url: string; publishedAt: Date }>> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const xml = await res.text();

    // 제목과 링크 추출
    const titleMatches = [...xml.matchAll(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/g)];
    const linkMatches = [...xml.matchAll(/<link>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/link>/g)];
    const pubDateMatches = [...xml.matchAll(/<pubDate>(.*?)<\/pubDate>/g)];

    const titles = titleMatches
      .map((m, i) => ({
        title: decodeEntities(m[1].trim()),
        url: linkMatches[i]?.[1]?.trim() || '',
        pubDate: pubDateMatches[i]?.[1]?.trim() || new Date().toISOString(),
      }))
      .filter(t => t.title && t.title !== name && !/^(TechCrunch|WIRED|Ars Technica|MIT Technology Review)/i.test(t.title));

    return titles.slice(0, limit).map(t => ({
      source: name,
      title: t.title,
      url: t.url,
      publishedAt: new Date(t.pubDate),
    }));
  } catch (e: any) {
    console.error(`[Inter] ${name} 피드 실패: ${e.message}`);
    return [];
  }
}

export async function collectInterNews(): Promise<{ newsIds: string[]; count: number; failed: string[] }> {
  console.log('[Inter] RSS 수집 시작...');

  const newsIds: string[] = [];
  const failed: string[] = [];

  for (const [name, url] of Object.entries(FEEDS)) {
    const articles = await fetchTitles(name, url);

    for (const article of articles) {
      try {
        // 중복 체크: URL로 이미 있는지 확인
        const existing = await prisma.interNews.findUnique({
          where: { url: article.url },
        });

        if (existing) {
          continue; // 이미 있으면 건너뛰기
        }

        // DB에 저장
        const news = await prisma.interNews.create({
          data: {
            source: article.source,
            title: article.title,
            url: article.url,
            publishedAt: article.publishedAt,
            collectedAt: new Date(),
          },
        });

        newsIds.push(news.id);
      } catch (e: any) {
        console.error(`[Inter] ${article.source} 저장 실패: ${e.message}`);
        failed.push(article.source);
      }
    }
  }

  console.log(`[Inter] 수집 완료: ${newsIds.length}건 (신규), ${failed.length}개 피드 실패`);
  return { newsIds, count: newsIds.length, failed };
}
