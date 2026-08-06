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
  // 'CNN': 테크 RSS가 전부 갱신이 멈춘 좀비 피드라 2026-08-06에 제외. cnn_tech.rss는 2024년 기사 3건에서 멈춰 있고
  //        (게다가 <title>이 비어 있어 파서가 전부 버림 = 기여 0건), 대체 후보 edition_technology.rss는 2016년,
  //        money_technology.rss는 2018년에 멈춤. 살아있는 건 edition.rss(종합 뉴스)뿐인데 AI/바이오 전문지가 아니라
  //        대부분 noise로 걸러질 거라 필터 비용만 늘어서 안 넣음.
  // 'Washington Post': RSS 엔드포인트가 전부 홈페이지 HTML로 리다이렉트됨(자체 RSS 서비스 종료) — 대체 피드 없음

  // === [아시아·중동 지역 매체] (2026-08-06 추가) ===
  // 위 20곳이 전부 미국·영국 영어 매체라 중국·일본·사우디 기사가 구조적으로 거의 안 들어오던 문제를 메우려고 추가.
  // country는 여전히 매체 국적이 아니라 기사 내용 기준으로 LLM이 판별한다(inter-filter.ts) — 여기 매체를 넣는다고
  // 그 기사가 자동으로 해당 국가 탭에 붙는 게 아니라, 그 국가를 다루는 기사가 애초에 수집망에 들어오게 하는 것.
  'TechNode': 'https://technode.com/feed/',                                        // 중국 / 영어
  'SCMP Tech': 'https://www.scmp.com/rss/36/feed',                                 // 중국(홍콩) / 영어
  'Wamda': 'https://www.wamda.com/feed',                                           // 사우디·MENA / 영어
  'Japan Today': 'https://japantoday.com/feed',                                    // 일본 / 영어
  'ITmedia': 'https://rss.itmedia.co.jp/rss/2.0/itmedia_all.xml',                  // 일본 / 일본어 — 루트 경로는 302라 이 파일 경로로 직접 접근해야 함
  'Impress Watch': 'https://www.watch.impress.co.jp/data/rss/1.0/ipw/feed.rdf',    // 일본 / 일본어 — RSS 1.0(RDF) 포맷
  'AnswersNews': 'https://answers.and-pro.jp/pharmanews/feed/',                    // 일본 / 일본어 — 제약·바이오 전문
  // 아래 3곳은 검증했지만 팀 정책 판단으로 제외(2026-08-06):
  // 'Nikkei Asia' / 'BRIDGE': robots.txt가 ClaudeBot·anthropic-ai를 명시적으로 차단 — UA 위장으로 우회 가능하지만 하지 않기로 함
  // 'Japan Times': robots.txt엔 AI봇 차단 문구가 없으나 Cloudflare 봇관리에 걸려 수집이 불안정 — 안정화 방법을 찾으면 재검토
  // Caixin·36Kr·KrASIA·MAGNiTT·Zawya는 공개 RSS가 없고 WAF로 완전 차단 — 헤드리스 브라우저나 유료 API 없인 불가
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
      // RSS 1.0(RDF)은 pubDate 대신 dc:date를 쓴다 — Impress Watch가 이 포맷.
      // 없으면 발행일이 전부 수집 시각으로 찍혀서 늘 최신 기사처럼 보이는 문제가 생김.
      block.match(/<dc:date>([\s\S]*?)<\/dc:date>/)?.[1] ??
      '';
    return { title: title.trim(), url: link.trim(), pubDate: pubDate.trim() };
  });
}

// RSS 날짜에는 JS Date가 못 읽는 타임존 약어가 그대로 박혀 오기도 한다(Wamda는 "EEST").
// 그대로 new Date()에 넣으면 Invalid Date가 되고, Prisma DateTime에 넣는 순간 저장이 통째로 실패한다.
const TZ_ABBR: Record<string, string> = {
  EET: '+0200', EEST: '+0300', CET: '+0100', CEST: '+0200',
  BST: '+0100', MSK: '+0300', JST: '+0900', KST: '+0900',
};

export function parseFeedDate(raw: string): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  if (!isNaN(d.getTime())) return d;
  const fixed = raw.trim().replace(/\b([A-Z]{2,4})$/, (m, abbr) => TZ_ABBR[abbr] ?? m);
  const d2 = new Date(fixed);
  return isNaN(d2.getTime()) ? null : d2;
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
      publishedAt: parseFeedDate(t.pubDate) ?? new Date(),
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
