/**
 * 최근 2주간 다이제스트가 발송된다고 가정했을 때, Inter 섹션에 실제로 채울 게 있는지 점검.
 *  - 매치(InterPortfolioMatch) 건수 / 매치된 회사 수
 *  - 매치가 걸린 조합(주제×사건유형)별 기사 수 → "카드당 기사 2~3건"이 가능한지
 *  - hottest 1위 조합이 날마다 바뀌는지(= 반복 피로가 실제로 생기는지)
 *
 * 임시 점검용 스크래치 파일. WINDOW_DAYS 로 조회창 길이를 바꿔가며 본다.
 */
import './_env';
import { loadInterData, buildMatrix, type InterDomain } from '../src/lib/inter-sample-data';

const WINDOW_DAYS = Number(process.env.WINDOW_DAYS ?? 7);
const DAYS_BACK = 14;

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function main() {
  const today = new Date();
  const domains: InterDomain[] = ['bio', 'ai'];

  for (const domain of domains) {
    console.log(`\n${'='.repeat(100)}`);
    console.log(`■ domain=${domain} · 조회창 ${WINDOW_DAYS}일 · 최근 ${DAYS_BACK}일간 매일 발송했다고 가정`);
    console.log('='.repeat(100));
    console.log('발송일       기사  매치  회사 | 1위 급증 조합                       | 매치 걸린 조합 (매치수/기사수)');
    console.log('-'.repeat(130));

    const hotHistory: string[] = [];
    let zeroMatchDays = 0;

    for (let back = DAYS_BACK - 1; back >= 0; back--) {
      const until = new Date(today.getTime() - back * 86400000);
      until.setHours(23, 59, 59, 999);
      const since = new Date(until.getTime() - WINDOW_DAYS * 86400000);
      since.setHours(0, 0, 0, 0);

      const data = await loadInterData(domain, since, until, 'all');
      const matrix = buildMatrix(domain, data);
      const h = matrix.headline;

      const matchedCells = matrix.rows
        .flatMap(r => r.cells)
        .filter(c => c.matchCount > 0)
        .sort((a, b) => b.matchCount - a.matchCount);

      const hot = h.hottest[0];
      const hotLabel = hot ? `${hot.label} (${hot.count}건)` : '—';
      hotHistory.push(hot?.label ?? '—');
      if (h.matchCount === 0) zeroMatchDays++;

      console.log(
        `${ymd(until)}  ${String(h.total).padStart(4)}  ${String(h.matchCount).padStart(4)}  ${String(h.matchedCompanyCount).padStart(4)} | ` +
        `${hotLabel.padEnd(35).slice(0, 35)} | ` +
        (matchedCells.length
          ? matchedCells.slice(0, 3).map(c => `${c.topicKey}×${c.eventKey}(${c.matchCount}/${c.count})`).join(', ')
          : '(없음)')
      );
    }

    const uniqueHot = new Set(hotHistory.filter(x => x !== '—'));
    console.log('-'.repeat(130));
    console.log(`· 매치 0건인 날: ${zeroMatchDays}/${DAYS_BACK}일`);
    console.log(`· 1위 급증 조합 종류: ${uniqueHot.size}가지 (${DAYS_BACK}일 중) → ${Array.from(uniqueHot).join(' / ') || '없음'}`);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
