/**
 * fanout이 3 아니면 10~14로 갈라지는 원인 규명.
 * 프롬프트는 "기사당 최대 3개사"인데 12개사가 붙은 기사가 있다 →
 * 한 번의 판정이 헐거운 게 아니라, 여러 번(모델/실행 회차) 매칭이 누적된 것인지 본다.
 *
 * ※ Inter 전용 점검. 임시 스크래치 파일(커밋 대상 아님).
 */
import './_env';
import { prisma } from '../src/lib/prisma';

async function main() {
  const since = new Date(Date.now() - 7 * 86400000);

  const matches = await prisma.interPortfolioMatch.findMany({
    where: { verdict: { news: { publishedAt: { gte: since } } } },
    select: { verdictId: true, companyName: true, model: true, matchedAt: true,
              verdict: { select: { titleKo: true, news: { select: { title: true } } } } },
  });

  const byVerdict = new Map<string, typeof matches>();
  matches.forEach(m => {
    const a = byVerdict.get(m.verdictId) ?? [];
    a.push(m); byVerdict.set(m.verdictId, a);
  });

  // fanout 분포
  const dist = new Map<number, number>();
  byVerdict.forEach(rows => {
    const n = new Set(rows.map(r => r.companyName)).size;
    dist.set(n, (dist.get(n) ?? 0) + 1);
  });
  console.log('■ fanout(기사당 고유 회사 수) 분포');
  Array.from(dist.entries()).sort((a, b) => a[0] - b[0])
    .forEach(([n, c]) => console.log(`   ${String(n).padStart(2)}개사 : ${'█'.repeat(c)} ${c}건`));

  // fanout 큰 기사들의 model / matchedAt 회차 분해
  console.log('\n■ fanout 큰 기사 상위 3건 — 모델·실행시각별로 쪼개보기');
  Array.from(byVerdict.entries())
    .sort((a, b) => new Set(b[1].map(r => r.companyName)).size - new Set(a[1].map(r => r.companyName)).size)
    .slice(0, 3)
    .forEach(([, rows]) => {
      const title = (rows[0].verdict.titleKo || rows[0].verdict.news.title).slice(0, 58);
      console.log(`\n   [${new Set(rows.map(r => r.companyName)).size}개사] ${title}`);
      const byRun = new Map<string, string[]>();
      rows.forEach(r => {
        const k = `${r.model} @ ${r.matchedAt.toISOString().slice(0, 16)}`;
        const a = byRun.get(k) ?? []; a.push(r.companyName); byRun.set(k, a);
      });
      Array.from(byRun.entries()).sort().forEach(([k, comps]) =>
        console.log(`      ${k}  →  ${comps.length}개사: ${comps.join(', ')}`));
    });

  // 모델별 총량
  console.log('\n■ 모델별 매치 row 수');
  const byModel = new Map<string, number>();
  matches.forEach(m => byModel.set(m.model, (byModel.get(m.model) ?? 0) + 1));
  Array.from(byModel.entries()).sort((a, b) => b[1] - a[1])
    .forEach(([m, c]) => console.log(`   ${c}건  ${m}`));
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
