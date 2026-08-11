// 기사 임베딩 백필. 이미 임베딩이 있는 기사는 건너뛰므로 중간에 끊겨도 다시 돌리면 이어서 된다.
//
//   npm run embed:backfill                 전부
//   npm run embed:backfill -- --limit 500  일부만 (시험용)
//
// OPENAI_API_KEY는 .env.local에 있는데 Prisma는 .env만 읽는다. 그래서 실행할 때
// --env-file=.env.local이 필요하다(npm 스크립트에 이미 들어 있다).
import { prisma } from '../src/lib/prisma';
import { backfillEmbeddings } from '../src/lib/sparkscope/embedding';

async function main() {
  const i = process.argv.indexOf('--limit');
  const limit = i >= 0 ? Number(process.argv[i + 1]) : undefined;

  const started = Date.now();
  let last = 0;
  const done = await backfillEmbeddings({
    limit,
    onProgress: (n, total) => {
      // 1000건마다 한 줄
      if (n - last >= 1000 || n === total) {
        const sec = (Date.now() - started) / 1000;
        console.log(`  ${n.toLocaleString()} / ${total.toLocaleString()}  (${sec.toFixed(0)}초, ${(n / sec).toFixed(0)}건/초)`);
        last = n;
      }
    },
  });

  console.log(`\n완료: ${done.toLocaleString()}건 임베딩 (${((Date.now() - started) / 1000).toFixed(0)}초)`);
  const [{ n }] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*)::bigint n FROM "ArticleEmbedding"`
  );
  console.log(`전체 임베딩 보유: ${Number(n).toLocaleString()}건`);
  await prisma.$disconnect();
}
main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
