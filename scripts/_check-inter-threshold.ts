/**
 * "회사가 적게 붙은 기사일수록 신호가 강하다" 가설의 문턱값 탐색.
 *
 * 기사 1건에 붙은 회사 수(fanout)가 N개 이하인 매치만 채택했을 때,
 * 최근 14일 각 발송일에 Inter 섹션에 실제로 쓸 카드가 몇 장 남는지 센다.
 * 목표: 발송일마다 카드 1~3장이 안정적으로 나오는 문턱을 찾는 것.
 *
 * ※ Inter 전용 점검 — Intra/다이제스트 로직은 건드리지 않는다.
 * 임시 스크래치 파일(커밋 대상 아님).
 */
import './_env';
import { loadInterData, type InterDomain } from '../src/lib/inter-sample-data';

const THRESHOLDS = [1, 2, 3, 5, 8];
const WINDOW_DAYS = Number(process.env.WINDOW_DAYS ?? 7);
const DAYS_BACK = 14;

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function main() {
  const today = new Date();

  for (const domain of ['bio', 'ai'] as InterDomain[]) {
    console.log(`\n${'='.repeat(104)}`);
    console.log(`■ domain=${domain} · 조회창 ${WINDOW_DAYS}일 · fanout(기사당 회사수) N개 이하만 채택했을 때 남는 "기사 장수"`);
    console.log('='.repeat(104));
    console.log(`발송일       매치기사 |  ${THRESHOLDS.map(t => `≤${t}개사`.padStart(7)).join(' |')}  | 채택 시 대표 사례(≤3)`);
    console.log('-'.repeat(140));

    const survivors: Record<number, number[]> = Object.fromEntries(THRESHOLDS.map(t => [t, []]));

    for (let back = DAYS_BACK - 1; back >= 0; back--) {
      const until = new Date(today.getTime() - back * 86400000);
      until.setHours(23, 59, 59, 999);
      const since = new Date(until.getTime() - WINDOW_DAYS * 86400000);
      since.setHours(0, 0, 0, 0);

      const { verdicts, matches } = await loadInterData(domain, since, until, 'all');

      // 기사별 매치 회사 묶기
      const byVerdict = new Map<string, string[]>();
      matches.forEach(m => {
        const arr = byVerdict.get(m.verdictId) ?? [];
        if (!arr.includes(m.companyName)) arr.push(m.companyName);
        byVerdict.set(m.verdictId, arr);
      });

      const cells = THRESHOLDS.map(t =>
        Array.from(byVerdict.values()).filter(c => c.length <= t).length
      );
      THRESHOLDS.forEach((t, i) => survivors[t].push(cells[i]));

      // ≤3 통과 기사 중 대표 1건 제목
      const sample = Array.from(byVerdict.entries())
        .filter(([, c]) => c.length <= 3)
        .sort((a, b) => a[1].length - b[1].length)[0];
      const sampleTitle = sample
        ? `${sample[1].join('·')} ← ${(verdicts.find(v => v.id === sample[0])?.titleKo
            || verdicts.find(v => v.id === sample[0])?.news.title || '').slice(0, 46)}`
        : '(없음)';

      console.log(
        `${ymd(until)}  ${String(byVerdict.size).padStart(7)} | ` +
        cells.map(c => String(c).padStart(7)).join(' |') + `  | ${sampleTitle}`
      );
    }

    console.log('-'.repeat(140));
    for (const t of THRESHOLDS) {
      const arr = survivors[t];
      const zero = arr.filter(x => x === 0).length;
      const avg = (arr.reduce((s, x) => s + x, 0) / arr.length).toFixed(1);
      console.log(`  ≤${t}개사 → 하루 평균 ${avg}장 · 0장인 날 ${zero}/${DAYS_BACK}일 · 최소 ${Math.min(...arr)} 최대 ${Math.max(...arr)}`);
    }
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
