import { prisma } from '@/lib/prisma';

const FEEDS: Record<string, string> = {
  'TechCrunch': 'https://techcrunch.com/feed/',
  'Ars Technica': 'https://feeds.arstechnica.com/arstechnica/index',
  'Wired': 'https://www.wired.com/feed/rss',
  'MIT Tech Review': 'https://www.technologyreview.com/feed/',
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
