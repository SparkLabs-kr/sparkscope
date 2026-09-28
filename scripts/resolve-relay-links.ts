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
import { lookupViaNaver } from '../src/lib/sparkscope/naver-resolver';

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

  let ok = 0, miss = 0, dup = 0, throttled = 0, done = 0;
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

  for (const [i, a] of rows.entries()) {
    let r = await lookupViaNaver(a.title).catch(() => ({ status: 'throttled' } as const));

    // 검색 결과가 0건이면 속도 제한으로 본다. 잠깐 쉬고 한 번 더 해 본다 —
    // 이걸 "그 기사는 없다"로 기록하면 멀쩡한 기사가 영영 안 고쳐진다
    // (2026-09-28에 500건을 그렇게 날렸다, naver-resolver.ts 주석 참고).
    if (r.status === 'throttled') {
      await sleep(20_000);
      r = await lookupViaNaver(a.title).catch(() => ({ status: 'throttled' } as const));
      if (r.status === 'throttled') {
        throttled++;
        if (throttled >= 3) {
          console.log(`\n네이버가 계속 빈 결과를 줍니다 — ${done}건까지만 처리하고 멈춥니다.`);
          console.log('시간을 두고 다시 실행하면 이어서 진행됩니다(이미 고친 것은 대상에서 빠집니다).');
          break;
        }
        continue;
      }
      throttled = 0;
    }

    done++;
    if (r.status === 'nomatch') miss++;
    else if (dry) ok++;
    else {
      // link는 unique다. 같은 주소가 이미 있으면 그 기사가 제대로 저장돼 있다는 뜻이라
      // 중복 행을 남기지 않고 넘어간다(digest-links.ts와 같은 처리).
      try { await prisma.article.update({ where: { id: a.id }, data: { link: r.url } }); ok++; }
      catch { dup++; }
    }
    if (done % 25 === 0) console.log(`  ${i + 1}/${rows.length} — 복구 ${ok} · 불일치 ${miss} · 중복 ${dup}`);
    // 0.5초로 돌렸다가 100건쯤부터 전부 빈 결과를 받았다. 1.2초면 안정적이다.
    await sleep(1_200);
  }
  const rate = done ? ((ok / done) * 100).toFixed(0) : '0';
  console.log(`\n처리 ${done}건 — 복구 ${ok}건 (${rate}%) · 같은 기사 못 찾음 ${miss}건 · 이미 있는 주소 ${dup}건`);
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
