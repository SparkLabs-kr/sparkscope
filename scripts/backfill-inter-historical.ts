// Inter 탭 과거 기사 백필 — RSS 피드는 각 매체 최신 20~50개만 노출해서 1년/3년 전 기사를
// 원천적으로 못 가져옴. 인트라 탭이 쓰는 구글 뉴스 검색(collector.ts의 fetchGoogleNews)과
// 같은 news.google.com/rss/search 엔드포인트를 "site:<도메인> after:X before:Y" 쿼리로 호출해
// 특정 매체·특정 기간의 과거 기사를 검색해서 채운다. 일회성 수동 스크립트 — 크론(daily-collect.yml,
// runner.ts)과는 별도 경로이며 그쪽은 건드리지 않음.
//
// 실행:
//   npx tsx scripts/backfill-inter-historical.ts [--years=3] [--dry-run]
//   npx tsx scripts/backfill-inter-historical.ts --after=2026-05-01 --before=2026-07-20 --chunk-days=25
//
// ⚠ 2026-08-04 확인된 함정: 기본 모드는 "최근 90일은 정규 RSS가 커버한다"고 보고 그 구간을 건너뛴다.
// 그런데 RSS는 매체당 최신 20~50개만 주므로 실제로는 2~3주치만 덮인다. 수집이 2026-07-31에
// 처음 돌았기 때문에 그 사이 구간(2026-05-05~07-15)이 통째로 비어 있었다.
// 그래서 --after/--before로 임의 구간을 직접 지정할 수 있게 했다. URL 기준 중복 저장은
// saveInterNewsIfNew가 막으니 이미 있는 기간과 겹쳐 돌려도 안전하다.

import './_env'; // ← .env.local 로드. 다른 import보다 먼저여야 한다
import { prisma } from '../src/lib/prisma';
import { FEEDS, decodeEntities, parseFeedItems, saveInterNewsIfNew } from '../src/lib/sparkscope/inter-collect';
import { resolveGoogleNewsUrl } from '../src/lib/sparkscope/google-news-resolver';
import { filterInterNewsWithGemini } from '../src/lib/sparkscope/inter-filter';
import { matchInterNewsWithPortfolio } from '../src/lib/sparkscope/inter-portfolio-match';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const DEFAULT_ITEMS_PER_WINDOW = 12; // 매체당 구간별 최대 수집 개수 (너무 많으면 URL 해석 단계가 오래 걸림)
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

/** --after/--before로 지정한 구간을 chunkDays 단위로 잘라 최신 구간부터 조회한다. */
function buildRangeWindows(after: Date, before: Date, chunkDays: number): Array<{ after: Date; before: Date }> {
  const windows: Array<{ after: Date; before: Date }> = [];
  const span = chunkDays * 24 * 60 * 60 * 1000;
  let cursor = new Date(before);
  while (cursor > after) {
    const winBefore = new Date(cursor);
    const winAfter = new Date(Math.max(after.getTime(), cursor.getTime() - span));
    windows.push({ after: winAfter, before: winBefore });
    cursor = winAfter;
  }
  return windows;
}

function parseYmd(s: string | undefined, label: string): Date | null {
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(`${label}는 YYYY-MM-DD 형식이어야 합니다: ${s}`);
  const d = new Date(`${s}T00:00:00Z`);
  if (isNaN(d.getTime())) throw new Error(`${label} 날짜를 해석할 수 없습니다: ${s}`);
  return d;
}

/**
 * 구글이 우리를 레이트리밋하면 RSS가 아니라 503 "Sorry..." HTML을 돌려준다.
 * 예전엔 그걸 그대로 parseFeedItems에 넘겨 "후보 0건"으로 조용히 넘어갔고,
 * 결과적으로 "그 기간엔 기사가 없다"로 오진하게 만들었다(2026-08-04 실제로 겪음).
 * 지금은 차단을 구분해서 위로 던지고, main이 즉시 중단한다.
 */
class RateLimitedError extends Error {}

async function fetchGoogleNewsWindow(domain: string, after: Date, before: Date, itemsPerWindow: number) {
  const q = `site:${domain} after:${fmt(after)} before:${fmt(before)}`;
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;

  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    const xml = await res.text();
    if (res.status === 429 || res.status === 503 || /^\s*<html/i.test(xml)) {
      throw new RateLimitedError(
        `구글 뉴스가 요청을 차단했습니다 (HTTP ${res.status}). 잠시(수십 분~수 시간) 기다렸다가 다시 실행하세요.`
      );
    }
    return parseFeedItems(xml)
      .map(t => ({ ...t, title: decodeEntities(t.title) }))
      .filter(t => t.title && t.url)
      .slice(0, itemsPerWindow);
  } catch (e: any) {
    if (e instanceof RateLimitedError) throw e; // 차단은 조용히 넘기지 않는다
    console.error(`[Backfill] ${domain} ${fmt(after)}~${fmt(before)} 검색 실패: ${e.message}`);
    return [];
  }
}

async function main() {
  const arg = (k: string) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=')[1];
  const years = Number(arg('years') ?? 3);
  const dryRun = process.argv.includes('--dry-run');
  const itemsPerWindow = Number(arg('items') ?? DEFAULT_ITEMS_PER_WINDOW);
  const chunkDays = Number(arg('chunk-days') ?? 90);
  const after = parseYmd(arg('after'), '--after');
  const before = parseYmd(arg('before'), '--before');

  if ((after && !before) || (!after && before)) {
    throw new Error('--after와 --before는 같이 지정해야 합니다.');
  }

  const windows = after && before
    ? buildRangeWindows(after, before, chunkDays)
    : buildQuarterWindows(years);

  if (after && before) {
    console.log(`[Backfill] 지정 구간 ${fmt(after)} ~ ${fmt(before)}을 ${chunkDays}일 단위로 검색 (dryRun=${dryRun})`);
  } else {
    console.log(`[Backfill] 최근 90일 이전 ~ ${years}년 전까지 매체별 과거 기사 검색 시작 (dryRun=${dryRun})`);
  }
  console.log(`[Backfill] 매체당 ${windows.length}개 구간 × 최대 ${itemsPerWindow}건 조회`);

  const newNewsIds: string[] = [];
  let candidateCount = 0;
  let resolvedCount = 0;

  let rateLimited: string | null = null;

  outer:
  for (const [name, feedUrl] of Object.entries(FEEDS)) {
    const domain = outletDomain(feedUrl);

    for (const { after, before } of windows) {
      let items;
      try {
        items = await fetchGoogleNewsWindow(domain, after, before, itemsPerWindow);
      } catch (e: any) {
        if (e instanceof RateLimitedError) {
          // 여기까지 모은 건 그대로 필터링·저장까지 진행하고, 수집만 멈춘다.
          rateLimited = e.message;
          break outer;
        }
        throw e;
      }
      candidateCount += items.length;

      for (const item of items) {
        await sleep(SLEEP_MS);
        const realUrl = await resolveGoogleNewsUrl(item.url);
        // 해석 실패(예: 구글 리졸버 429) 시에도 건너뛰지 않고 구글 뉴스 링크 그대로 저장 —
        // 인트라 탭의 titleOnlyFallback 배지와 같은 취지: 조용히 누락시키지 않는다.
        const finalUrl = realUrl ?? item.url;
        if (realUrl) resolvedCount++;

        if (dryRun) {
          console.log(`[dry-run] ${name} | ${item.title} | ${finalUrl}${realUrl ? '' : ' (원문 해석 실패, 구글 링크로 저장)'} | ${item.pubDate}`);
          continue;
        }

        const newsId = await saveInterNewsIfNew({
          source: name,
          title: item.title,
          url: finalUrl,
          publishedAt: item.pubDate ? new Date(item.pubDate) : before,
        });
        if (newsId) newNewsIds.push(newsId);
      }

      await sleep(SLEEP_MS);
    }
    console.log(`[Backfill] ${name} 완료 — 지금까지 신규 저장 ${newNewsIds.length}건`);
  }

  console.log(`[Backfill] 검색된 후보 ${candidateCount}건, URL 해석 성공 ${resolvedCount}건, 신규 저장 ${newNewsIds.length}건`);

  if (rateLimited) {
    console.error(`\n🔴 [Backfill] 수집이 중간에 끊겼습니다 — ${rateLimited}`);
    console.error('   이 실행의 결과는 해당 구간을 전부 덮지 못했습니다. "기사가 없다"고 해석하지 마세요.');
  }

  if (dryRun || newNewsIds.length === 0) {
    console.log('[Backfill] dry-run이거나 신규 기사 없음 — 필터링/매칭 생략');
    process.exit(rateLimited ? 1 : 0);
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
