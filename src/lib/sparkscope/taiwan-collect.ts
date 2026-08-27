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
import { prisma } from '@/lib/prisma';
import { parseFeedDate } from './inter-collect';
import { isRelevant } from './relevance';
import { classifyTaiwanArticle } from './taiwan-noise';
import type { RawArticle } from './types';

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


export const TAIWAN_CATEGORY = 'portfolio_company_tw' as const;

/** 구글 뉴스는 쿼리당 100건이 상한 — 기간을 쪼개야 과거 기사를 잃지 않는다. */
const RESULT_CAP = 100;
const WINDOW_DAYS = 15;

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function fetchXml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SparkScope/1.0)' },
  });
  if (!res.ok) throw new Error(`google news ${res.status}`);
  return res.text();
}

/**
 * 대만 포트폴리오사 기사 수집.
 *
 * 네이버 대신 구글 뉴스 RSS(zh-TW)를 쓰고, 매칭은 한국과 같은 relevance.isRelevant()를 그대로 탄다.
 * 본문은 넘기지 않는다(body='') — 구글 뉴스 링크는 원문이 아니라 리다이렉트 페이지라
 * 스크래핑이 불가능하기 때문. 따라서 제목만으로 판정되며, 그만큼 문맥어 설정이 중요하다.
 *
 * @param sinceDays 조회 기간(일). 주 1회 실행 기준 10일 정도면 누락 없이 겹친다.
 */
export async function collectTaiwanArticles(sinceDays = 10): Promise<RawArticle[]> {
  const targets = await prisma.monitoringTarget.findMany({
    where: { category: TAIWAN_CATEGORY, status: 'ACTIVE' },
    orderBy: { name: 'asc' },
  });

  const until = new Date();
  const since = new Date(until.getTime() - sinceDays * 86400_000);
  const out: RawArticle[] = [];
  const seenLinks = new Set<string>();

  for (const t of targets) {
    const names = [t.name, t.englishName, t.primaryKeyword].filter(
      (v): v is string => !!v && v.trim().length > 0,
    );
    const uniqueNames = [...new Set(names)];
    if (uniqueNames.length === 0) continue;

    let items: TaiwanFeedItem[] = [];
    try {
      items = parseGoogleNewsItems(await fetchXml(buildQueryUrl(uniqueNames)));
    } catch (e) {
      console.error(`[taiwan-collect] ${t.name} 조회 실패:`, e);
      continue;
    }

    // 상한에 걸린 대상만 기간 분할 재조회 — 그 외는 요청 낭비다.
    if (items.length >= RESULT_CAP) {
      for (let d = new Date(since); d < until; d.setDate(d.getDate() + WINDOW_DAYS)) {
        const lo = ymd(d);
        const hi = ymd(new Date(d.getTime() + WINDOW_DAYS * 86400_000));
        try {
          const extra = parseGoogleNewsItems(
            await fetchXml(`${buildQueryUrl(uniqueNames)}+after:${lo}+before:${hi}`),
          );
          for (const it of extra) {
            if (!items.some(x => x.link === it.link)) items.push(it);
          }
        } catch { /* 분할 조회 실패는 무시 — 기본 조회분은 이미 확보했다 */ }
      }
    }

    for (const it of items) {
      if (!it.pubDate || it.pubDate < since || it.pubDate > until) continue;
      if (seenLinks.has(it.link)) continue;

      // 구글 뉴스 제목의 " - 매체명" 접미사를 떼고 판정한다 — 안 떼면 매체명이
      // 문맥어·제외어와 우연히 겹쳐 오분류된다(예: "CMoney投資網誌"의 "投資").
      const title = stripSourceSuffix(it.title, it.source);

      const relevant = isRelevant({
        title,
        body: '', // 구글 뉴스 링크는 스크래핑 불가 — 제목만으로 판정
        primaryKeyword: t.primaryKeyword,
        name: t.name,
        englishName: t.englishName,
        helperKeywords: t.helperKeywords,
        excludeWords: t.excludeWords,
        contextWords: t.contextWords,
        category: t.category,
        link: it.link,
        source: it.source,
      });
      if (!relevant) continue;

      seenLinks.add(it.link);
      out.push({
        title,
        link: it.link,
        source: it.source,
        pubDate: it.pubDate,
        matchedKeyword: t.name,
        category: TAIWAN_CATEGORY,
        // 공시·시세 자동생성물은 우선순위를 낮춰 대시보드 상단을 차지하지 않게 한다.
        basePriority: classifyTaiwanArticle({ title, source: it.source }) === 'disclosure' ? 10 : 70,
      });
    }
  }

  console.log(`[taiwan-collect] ${targets.length}개사 조회 → ${out.length}건 수집`);
  return out;
}
