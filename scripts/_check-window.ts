import './_env';
import { prisma } from '../src/lib/prisma';

async function main() {
  const since = new Date('2026-05-06');
  const until = new Date('2026-08-06');
  const matches = await prisma.interPortfolioMatch.findMany({
    include: { verdict: { include: { news: true } } },
  });
  const paperOpinion = /Nature|Cell|Science|MIT Tech Review/i;
  const filtered = matches.filter(m => paperOpinion.test(m.verdict.news.source));
  const inWindow = filtered.filter(m => m.verdict.news.publishedAt >= since && m.verdict.news.publishedAt <= until);
  const outWindow = filtered.filter(m => !(m.verdict.news.publishedAt >= since && m.verdict.news.publishedAt <= until));
  console.log('전체 논문/오피니언 매칭:', filtered.length);
  console.log('현재 3개월 창 안:', inWindow.length);
  console.log('창 밖(과거 백필분):', outWindow.length);
  process.exit(0);
}
main();
