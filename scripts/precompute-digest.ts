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
import { saveDigest } from '../src/lib/sparkscope/digest-store';

/** 화면이 고를 수 있는 기간. 라우트의 허용값과 같아야 한다. */
const WINDOWS = [1, 7, 30];

async function main() {
  let ok = 0;
  let failed = 0;

  for (const domain of ['ai', 'bio'] as NewsDomain[]) {
    for (const days of WINDOWS) {
      const t = Date.now();
      try {
        const { items, feeds, keywords } = await collectDigest(domain, days, 12);
        await ensureSummaries(items);
        await ensurePortfolioHits(items);
        // 원문 발췌는 화면으로 내보내지 않는다 — 라우트가 하던 것과 같게 여기서 지운다.
        const safe = items.map(({ sourceText, ...rest }) => rest);
        await saveDigest(domain, days, { items: safe, feeds, keywords });
        console.log(`[precompute-digest] ${domain}/${days}일: ${safe.length}건 · 키워드 ${keywords.length}개 · ${Date.now() - t}ms`);
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
