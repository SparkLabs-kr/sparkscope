/**
 * 구글 뉴스 중계주소로 저장된 기사를 진짜 원문 주소로 바꾼다.
 *
 *   npx tsx --env-file=.env.local scripts/resolve-relay-links.ts            # 200건
 *   npx tsx --env-file=.env.local scripts/resolve-relay-links.ts --limit 500
 *   npx tsx --env-file=.env.local scripts/resolve-relay-links.ts --days 30
 *   npx tsx --env-file=.env.local scripts/resolve-relay-links.ts --dry
 *
 * 네이버 뉴스 검색으로 되찾아 Article.link를 갱신한다(naver-resolver.ts에 근거).
 * 구글 해석기는 여기서 쓰지 않는다 — 몇십 건이면 막혀서 대량 처리에 못 쓴다.
 * 못 찾은 기사는 손대지 않는다. 지금까지와 똑같이 제목 검색으로 열린다.
 */
import './_env';
import { prisma } from '../src/lib/prisma';
import { resolveViaNaver } from '../src/lib/sparkscope/naver-resolver';

const arg = (name: string, dflt: number) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? Number(process.argv[i + 1]) : dflt;
};

async function main() {
  const limit = arg('--limit', 200);
  const days = arg('--days', 14);
  const dry = process.argv.includes('--dry');

  const rows = await prisma.article.findMany({
    where: {
      pubDate: { gte: new Date(Date.now() - days * 86_400_000) },
      isNoise: false,
      link: { contains: 'news.google.com/rss/articles' },
    },
    select: { id: true, title: true, source: true, link: true },
    orderBy: { pubDate: 'desc' },
    take: limit,
  });
  console.log(`대상 ${rows.length}건 (최근 ${days}일)${dry ? ' · 저장하지 않음' : ''}`);

  let ok = 0, miss = 0, dup = 0;
  for (const [i, a] of rows.entries()) {
    const real = await resolveViaNaver(a.title).catch(() => null);
    if (!real) { miss++; }
    else if (dry) { ok++; }
    else {
      // link는 unique다. 같은 주소가 이미 있으면 그 기사가 제대로 저장돼 있다는 뜻이라
      // 중복 행을 남기지 않고 넘어간다(digest-links.ts와 같은 처리).
      try { await prisma.article.update({ where: { id: a.id }, data: { link: real } }); ok++; }
      catch { dup++; }
    }
    if ((i + 1) % 25 === 0) console.log(`  ${i + 1}/${rows.length} — 복구 ${ok} · 실패 ${miss} · 중복 ${dup}`);
    // 네이버에 부담을 주지 않는 간격. 25건에 약 13초.
    await new Promise(r => setTimeout(r, 500));
  }
  const rate = rows.length ? ((ok / rows.length) * 100).toFixed(0) : '0';
  console.log(`\n복구 ${ok}건 (${rate}%) · 못 찾음 ${miss}건 · 이미 있는 주소 ${dup}건`);
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
