/**
 * 오늘의 시그널 패널 사전계산 — GitHub Actions에서 2시간마다 돈다.
 *
 * 왜: 이 패널은 요청마다 전부 새로 만들고 있었고 캐시가 다 찬 상태에서도 12.5초가
 * 걸렸다(digest-store.ts 주석에 내역). 대시보드 AI 요약이 쓰는 것과 같은 패턴으로
 * 미리 계산해 두고 화면은 읽기만 하게 한다.
 *
 * 헤드라인 관측(collect-headlines.ts) 다음에 돌아야 한다 — 그래야 방금 관측한 1면이
 * 이번 계산에 반영된다. 워크플로에서 순서를 그렇게 잡아 뒀다.
 */
import { collectDigest, type NewsDomain } from '../src/lib/sparkscope/news-digest';
import { ensureSummaries } from '../src/lib/sparkscope/news-summary';
import { ensurePortfolioHits } from '../src/lib/sparkscope/news-portfolio';
import { saveDigest, digestAge } from '../src/lib/sparkscope/digest-store';
import { DISPLAY_COUNT } from '../src/lib/sparkscope/signal-display';
import { buildEntityCards, type CommunityPost } from '../src/lib/sparkscope/entity-cards';
import { readSignals } from '../src/lib/sparkscope/social-store';
import { DOMAIN_SOURCES, SOURCE_META, type SocialSourceId } from '../src/lib/sparkscope/social-collect';

/** 커뮤니티 글을 이름 카드가 쓰는 모양으로 읽어 온다. */
async function communityPosts(domain: NewsDomain, days: number): Promise<CommunityPost[]> {
  const ids = DOMAIN_SOURCES[domain];
  // 커뮤니티는 화제가 며칠씩 이어지므로 기사보다 창을 넓게 잡는다 — 최소 2주.
  const since = Date.now() - Math.max(days, 14) * 86_400_000;
  const bySource = await readSignals(domain, ids, since, 20);
  const out: CommunityPost[] = [];
  for (const [id, rows] of bySource) {
    for (const r of rows) {
      out.push({
        source: SOURCE_META[id as SocialSourceId]?.label ?? id,
        sourceId: id,
        title: r.title,
        titleKo: r.titleKo,
        url: r.url,
        points: r.peakPoints,
        pointsLabel: r.pointsLabel,
        blurb: r.blurb,
      });
    }
  }
  return out;
}

/** 화면이 고를 수 있는 기간. 라우트의 허용값과 같아야 한다. */
const WINDOWS = [1, 7, 30];

/**
 * 창마다 다시 계산할 최소 간격.
 *
 * 이 스크립트는 매시간 돌지만 창 전부를 매시간 다시 만들 이유는 없다.
 * "이번 달" 상위 12건은 한 시간에 바뀌지 않는다 — 30일 분모에 한 시간이 더해질 뿐이다.
 * 반면 "오늘"과 "이번 주"는 새 기사가 바로 순위를 바꾼다.
 *
 * 사건 병합(groundSameStory)은 URL 캐시가 없어 실행마다 새로 과금되는 유일한 호출이고
 * 창 하나가 월 $1.13이다(2026-09-10 산정). 30일 창을 6시간마다로 내리면 결과는
 * 사실상 같으면서 월 $1.88이 줄어든다.
 */
const MIN_INTERVAL_MS: Record<number, number> = {
  1: 0,                 // 오늘 — 매시간
  7: 0,                 // 이번 주 — 매시간
  30: 6 * 3600_000,     // 이번 달 — 6시간마다
};

async function main() {
  let ok = 0;
  let failed = 0;

  for (const domain of ['ai', 'bio'] as NewsDomain[]) {
    for (const days of WINDOWS) {
      const t = Date.now();

      // 아직 다시 만들 때가 아니면 건너뛴다. 저장된 것이 그대로 쓰이므로 화면은 그대로다.
      // --force는 주기를 무시한다 — 랭킹 로직을 바꾼 직후 바로 다시 만들 때 쓴다.
      const minGap = process.argv.includes('--force') ? 0 : (MIN_INTERVAL_MS[days] ?? 0);
      if (minGap > 0) {
        const age = await digestAge(domain, days).catch(() => null);
        if (age !== null && age < minGap) {
          console.log(`[precompute-digest] ${domain}/${days}일 건너뜀 — ${(age / 3600_000).toFixed(1)}시간 전 계산 (주기 ${minGap / 3600_000}시간)`);
          continue;
        }
      }

      try {
        const { items, feeds, keywords } = await collectDigest(domain, days, 12);
        await ensureSummaries(items);
        await ensurePortfolioHits(items);
        // 원문 발췌는 화면으로 내보내지 않는다 — 라우트가 하던 것과 같게 여기서 지운다.
        const safe = items.map(({ sourceText, ...rest }) => rest);
        // 이름 카드 — 기사와 커뮤니티를 이름으로 잇는다. 실패해도 목록은 나가야 한다.
        // 화면에 실제로 깔리는 기사만으로 카드를 만든다 — 카드가 가리키는 기사는
        // 목록에 있어야 한다(signal-display.ts 주석 참고).
        const entities = await buildEntityCards(
          domain, safe.slice(0, DISPLAY_COUNT), await communityPosts(domain, days))
          .catch(e => { console.error('[precompute-digest] 이름 카드 실패(무시):', e); return []; });
        await saveDigest(domain, days, { items: safe, feeds, keywords, entities });
        console.log(`[precompute-digest] ${domain}/${days}일: ${safe.length}건 · 키워드 ${keywords.length}개 · 이름 ${entities.length}개 · ${Date.now() - t}ms`);
        ok++;
      } catch (e) {
        // 한 조합이 실패해도 나머지는 계속한다 — 여섯 칸이 서로 독립이다.
        console.error(`[precompute-digest] ${domain}/${days}일 실패:`, e);
        failed++;
      }
    }
  }

  console.log(`[precompute-digest] 완료 — 성공 ${ok} / 실패 ${failed}`);
  // 전부 실패했을 때만 워크플로를 실패로 남긴다. 일부 실패는 화면이 즉석 계산으로 메운다.
  if (ok === 0) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
