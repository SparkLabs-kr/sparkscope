/**
 * 매치의 '모양'을 본다 — 카드 UI를 뭘로 채울지 정하려면 필요한 값들.
 *  - 기사 1건에 회사가 몇 개나 붙는지 (매치수 > 기사수인 조합이 많았음)
 *  - 어떤 회사가 매치를 독식하는지
 *  - reason 문구가 카드에 쓸 만한 길이·내용인지
 */
import './_env';
import { loadInterData, type InterDomain } from '../src/lib/inter-sample-data';

async function main() {
  const until = new Date(); until.setHours(23, 59, 59, 999);
  const since = new Date(until.getTime() - 7 * 86400000); since.setHours(0, 0, 0, 0);

  for (const domain of ['bio', 'ai'] as InterDomain[]) {
    const data = await loadInterData(domain, since, until, 'all');
    const { verdicts, matches } = data;

    const byVerdict = new Map<string, string[]>();
    matches.forEach(m => {
      const arr = byVerdict.get(m.verdictId) ?? [];
      arr.push(m.companyName);
      byVerdict.set(m.verdictId, arr);
    });

    const byCompany = new Map<string, number>();
    matches.forEach(m => byCompany.set(m.companyName, (byCompany.get(m.companyName) ?? 0) + 1));

    const counts = Array.from(byVerdict.values()).map(a => a.length).sort((a, b) => b - a);

    console.log(`\n${'='.repeat(90)}`);
    console.log(`■ domain=${domain} · 최근 7일 · 기사 ${verdicts.length}건 / 매치 ${matches.length}건 / 매치된 기사 ${byVerdict.size}건`);
    console.log('='.repeat(90));
    console.log(`· 매치된 기사 1건당 회사 수: 최대 ${counts[0] ?? 0} / 중앙값 ${counts[Math.floor(counts.length / 2)] ?? 0} / 1개사뿐인 기사 ${counts.filter(c => c === 1).length}건`);
    console.log(`· 매치 안 된 기사: ${verdicts.length - byVerdict.size}건`);

    console.log(`\n[회사별 매치 수 TOP 8]`);
    Array.from(byCompany.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8)
      .forEach(([n, c]) => console.log(`   ${String(c).padStart(3)}건  ${n}`));

    console.log(`\n[회사가 가장 많이 붙은 기사 TOP 3]`);
    Array.from(byVerdict.entries()).sort((a, b) => b[1].length - a[1].length).slice(0, 3)
      .forEach(([vid, comps]) => {
        const v = verdicts.find(x => x.id === vid);
        console.log(`   ${comps.length}개사 ← ${(v?.titleKo || v?.news.title || '').slice(0, 60)}`);
        console.log(`          ${comps.slice(0, 12).join(', ')}`);
      });

    console.log(`\n[reason 샘플 3개]`);
    matches.slice(0, 3).forEach(m => console.log(`   (${m.companyName}) ${(m.reason ?? '').slice(0, 110)}`));
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
