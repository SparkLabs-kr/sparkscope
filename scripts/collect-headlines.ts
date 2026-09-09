/**
 * 매체 1면 헤드라인·인기기사 관측 — GitHub Actions에서 2시간마다 돈다.
 *
 * 왜 Vercel이 아니라 여기인가:
 *   FierceBiotech는 Cloudflare 봇 차단에 걸려 Vercel 서버리스에서 403이 난다.
 *   UA 문제가 아니다 — 같은 Chrome UA로 내 맥에서는 200이고, python-requests 같은
 *   알려진 스크래퍼 UA만 403이 난다(2026-09-09 실측). 즉 Cloudflare가 UA 외에
 *   IP 평판을 함께 보고 데이터센터 대역인 Vercel(AWS icn1)을 봇으로 깐 것이다.
 *   헤드리스 브라우저를 써도 IP는 그대로라 풀리지 않는다.
 *
 *   그런데 GitHub Actions 러너에서는 열린다. probe-sources 워크플로로 확인했다:
 *     200  https://www.fiercebiotech.com/biotech
 *     200  https://www.fiercebiotech.com/rss/xml
 *   그래서 긁는 주체만 이쪽으로 옮긴다. 결과는 NewsHeadline 테이블에 들어가고
 *   다이제스트는 그것을 읽으므로(news-popular-store.ts), 화면 쪽 코드는 그대로다.
 *
 * CLAUDE.md 규칙: 같은 작업을 Vercel과 GitHub Actions 양쪽에 두지 않는다 —
 * collect-social 크론에서 헤드라인 관측을 빼고 여기로 옮겼다.
 */
import { refreshPopular, prunePopular } from '../src/lib/sparkscope/news-popular-store';

async function main() {
  let total = 0;
  for (const domain of ['ai', 'bio'] as const) {
    try {
      const n = await refreshPopular(domain);
      console.log(`[collect-headlines] ${domain}: ${n}건 저장`);
      total += n;
    } catch (e) {
      // 한 도메인이 실패해도 나머지는 계속한다.
      console.error(`[collect-headlines] ${domain} 실패:`, e);
    }
  }

  const pruned = await prunePopular().catch(e => {
    console.error('[collect-headlines] 정리 실패:', e);
    return 0;
  });

  console.log(`[collect-headlines] 완료 — 저장 ${total}건, 오래된 관측 정리 ${pruned}건`);
  // 전부 실패했으면 워크플로를 실패로 남긴다 — 조용히 0건이 되는 게 제일 나쁘다.
  if (total === 0) {
    console.error('[collect-headlines] 저장 0건 — 매체 마크업이 바뀌었거나 접근이 막혔습니다');
    process.exit(1);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
