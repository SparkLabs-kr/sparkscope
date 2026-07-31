// Inter 탭 과거 기사 백필 — RSS 피드는 각 매체 최신 20~50개만 노출해서 1년/3년 전 기사를
// 원천적으로 못 가져옴. 인트라 탭이 쓰는 구글 뉴스 검색(collector.ts의 fetchGoogleNews)과
// 같은 news.google.com/rss/search 엔드포인트를 "site:<도메인> after:X before:Y" 쿼리로 호출해
// 특정 매체·특정 기간의 과거 기사를 검색해서 채운다. 일회성 수동 스크립트 — 크론(daily-collect.yml,
// runner.ts)과는 별도 경로이며 그쪽은 건드리지 않음.
//
// 실행: npx tsx scripts/backfill-inter-historical.ts [--years=3] [--dry-run]

import { prisma } from '../src/lib/prisma';
import { FEEDS, decodeEntities, parseFeedItems, saveInterNewsIfNew } from '../src/lib/sparkscope/inter-collect';
import { resolveGoogleNewsUrl } from '../src/lib/sparkscope/google-news-resolver';
import { filterInterNewsWithGemini } from '../src/lib/sparkscope/inter-filter';
import { matchInterNewsWithPortfolio } from '../src/lib/sparkscope/inter-portfolio-match';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const ITEMS_PER_QUARTER = 12; // 매체당 분기별 최대 수집 개수 (너무 많으면 URL 해석 단계가 오래 걸림)
const SLEEP_MS = 400; // 구글 요청 사이 지연 (레이트리밋 방지)

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

function outletDomain(feedUrl: string): string {
  return new URL(feedUrl).hostname.replace(/^www\./, '');
}

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// 최근 90일(정규 RSS 수집이 이미 커버)을 제외하고, 그 이전부터 지정한 연수까지 3개월 단위로 자름.
function buildQuarterWindows(years: number): Array<{ after: Date; before: Date }> {
  const windows: Array<{ after: Date; before: Date }> = [];
  const now = new Date();
  let cursor = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const cutoff = new Date(now.getTime() - years * 365 * 24 * 60 * 60 * 1000);

  while (cursor > cutoff) {
    const before = new Date(cursor);
    const after = new Date(cursor.getTime() - 90 * 24 * 60 * 60 * 1000);
    windows.push({ after: after > cutoff ? after : cutoff, before });
    cursor = after;
  }
  return windows;
}

async function fetchGoogleNewsWindow(domain: string, after: Date, before: Date) {
  const q = `site:${domain} after:${fmt(after)} before:${fmt(before)}`;
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;

  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    const xml = await res.text();
    return parseFeedItems(xml)
      .map(t => ({ ...t, title: decodeEntities(t.title) }))
      .filter(t => t.title && t.url)
      .slice(0, ITEMS_PER_QUARTER);
  } catch (e: any) {
    console.error(`[Backfill] ${domain} ${fmt(after)}~${fmt(before)} 검색 실패: ${e.message}`);
    return [];
  }
}

async function main() {
  const years = Number(process.argv.find(a => a.startsWith('--years='))?.split('=')[1] ?? 3);
  const dryRun = process.argv.includes('--dry-run');

  console.log(`[Backfill] 최근 90일 이전 ~ ${years}년 전까지 매체별 과거 기사 검색 시작 (dryRun=${dryRun})`);

  const windows = buildQuarterWindows(years);
  console.log(`[Backfill] 매체당 ${windows.length}개 분기 구간 조회`);

  const newNewsIds: string[] = [];
  let candidateCount = 0;
  let resolvedCount = 0;

  for (const [name, feedUrl] of Object.entries(FEEDS)) {
    const domain = outletDomain(feedUrl);

    for (const { after, before } of windows) {
      const items = await fetchGoogleNewsWindow(domain, after, before);
      candidateCount += items.length;

      for (const item of items) {
        await sleep(SLEEP_MS);
        const realUrl = await resolveGoogleNewsUrl(item.url);
        if (!realUrl) continue; // 해석 실패 시 건너뜀 (원문 링크 없는 기사는 저장하지 않음)
        resolvedCount++;

        if (dryRun) {
          console.log(`[dry-run] ${name} | ${item.title} | ${realUrl} | ${item.pubDate}`);
          continue;
        }

        const newsId = await saveInterNewsIfNew({
          source: name,
          title: item.title,
          url: realUrl,
          publishedAt: item.pubDate ? new Date(item.pubDate) : before,
        });
        if (newsId) newNewsIds.push(newsId);
      }

      await sleep(SLEEP_MS);
    }
    console.log(`[Backfill] ${name} 완료 — 지금까지 신규 저장 ${newNewsIds.length}건`);
  }

  console.log(`[Backfill] 검색된 후보 ${candidateCount}건, URL 해석 성공 ${resolvedCount}건, 신규 저장 ${newNewsIds.length}건`);

  if (dryRun || newNewsIds.length === 0) {
    console.log('[Backfill] dry-run이거나 신규 기사 없음 — 필터링/매칭 생략');
    process.exit(0);
  }

  console.log('[Backfill] Gemini 관련성 필터링 시작...');
  const filterResult = await filterInterNewsWithGemini(newNewsIds);
  console.log(`[Backfill] 필터링 완료: ${filterResult.relevant}/${filterResult.filtered} 관련`);

  if (filterResult.relevant > 0) {
    const relevantVerdicts = await prisma.interNewsVerdict.findMany({
      where: { newsId: { in: newNewsIds }, relevant: true },
      select: { id: true },
    });
    const matchResult = await matchInterNewsWithPortfolio(relevantVerdicts.map(v => v.id));
    console.log(`[Backfill] 포트폴리오 매칭 완료: ${matchResult.matched}건`);
  }

  process.exit(0);
}

main().catch(e => {
  console.error('[Backfill] 실패:', e);
  process.exit(1);
});
