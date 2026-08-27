/**
 * 대만 포트폴리오사 뉴스 수집 — 구글 뉴스 RSS(zh-TW) 기반.
 *
 * 왜 네이버가 아닌가:
 *   collector.ts는 네이버 뉴스 API 하나만 쓴다. 네이버는 대만 매체를 거의 색인하지 않아
 *   대만 69개사를 그대로 seed하면 기사가 0건이다.
 *
 * 왜 매체 RSS가 아닌가:
 *   TechNews·iThome·경제일보 등 공개 RSS는 링크가 깔끔하지만, 30일 트라이얼에서 실제로 기사가
 *   잡힌 매체(鏡週刊·三立新聞·Meet創業小聚·富聯網·環球生技月刊)를 거의 포함하지 못한다.
 *   대만은 매체가 파편화돼 있어 "전체 피드를 받아 거르는" 방식으로는 커버리지가 안 나온다.
 *
 * 한계 (반드시 알고 쓸 것):
 *   - 구글 뉴스 RSS의 <link>는 원문 URL이 아니라 리다이렉트 페이지다. 따라가도 200으로 구글
 *     페이지가 뜬다. 그래서 본문 스크래핑이 불가능하고(제목만으로 매칭), 링크는
 *     article-link.ts의 hasRealLink()가 걸러 검색 폴백으로 넘긴다.
 *   - <source url="...">은 매체 도메인만 준다(기사 URL 아님).
 *   - 공개 문서화된 엔드포인트가 아니라 SLA가 없다. 포맷이 바뀌면 조용히 0건이 될 수 있으므로
 *     수집 결과가 0건인 날이 이어지면 알람이 필요하다.
 *
 * 30일 트라이얼(2026-07-27~08-26) 실측: 후보 1,681건 → 유효 43건 / 6개사.
 * 한국(3개월 4,820건)보다 훨씬 얇다 — 매일보다 주 1회 수집이 현실적이다.
 */
import { parseFeedDate } from './inter-collect';

export const TAIWAN_NEWS_LOCALE = { hl: 'zh-TW', gl: 'TW', ceid: 'TW:zh-Hant' } as const;

export type TaiwanFeedItem = {
  title: string;
  link: string;
  source: string;
  pubDate: Date | null;
};

/** 회사 하나를 찾기 위한 구글 뉴스 검색 URL. 중문명과 영문명을 OR로 묶는다. */
export function buildQueryUrl(names: string[]): string {
  const q = names.filter(Boolean).map(n => `"${n}"`).join(' OR ');
  const params = new URLSearchParams({ q, ...TAIWAN_NEWS_LOCALE });
  return `https://news.google.com/rss/search?${params.toString()}`;
}

/**
 * 구글 뉴스 RSS 파싱. inter-collect의 parseFeedItems는 <source>를 읽지 않아 따로 둔다 —
 * 대만 기사는 매체명이 공시/시세 분류(taiwan-noise.ts)에 필요하다.
 */
export function parseGoogleNewsItems(xml: string): TaiwanFeedItem[] {
  const out: TaiwanFeedItem[] = [];
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  for (const raw of items) {
    const title = raw.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '';
    const link = raw.match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? '';
    const pub = raw.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] ?? '';
    const source = raw.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1] ?? '';
    if (!title || !link) continue;
    out.push({
      title: decodeXml(title).trim(),
      link: link.trim(),
      source: decodeXml(source).trim(),
      pubDate: parseFeedDate(pub),
    });
  }
  return out;
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}

/**
 * 구글 뉴스 제목은 "제목 - 매체명" 형태로 매체명이 붙는다. 매칭 전에 떼어낸다 —
 * 안 떼면 매체명이 사명·제외어와 우연히 겹쳐 오탐이 난다.
 */
export function stripSourceSuffix(title: string, source: string): string {
  if (!source) return title;
  const suffix = ` - ${source}`;
  return title.endsWith(suffix) ? title.slice(0, -suffix.length) : title;
}
