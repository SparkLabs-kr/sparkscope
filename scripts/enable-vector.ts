// pgvector 확장 + 임베딩 테이블 생성. 추가 전용(additive) DDL이라 몇 번 돌려도 안전하다.
// prisma db push는 프로덕션 drift 때문에 쓰지 않는다(schema.prisma에 없는 컬럼이 운영 DB에 있음).
import { prisma } from '../src/lib/prisma';

const STMTS = [
  `CREATE EXTENSION IF NOT EXISTS vector`,
  `CREATE TABLE IF NOT EXISTS "ArticleEmbedding" (
     "articleId" text PRIMARY KEY REFERENCES "Article"(id) ON DELETE CASCADE,
     embedding vector(512) NOT NULL,
     model text NOT NULL,
     "updatedAt" timestamptz NOT NULL DEFAULT now()
   )`,
  // 코사인 거리 기준 HNSW. 30k행 기준 빌드가 수십 초면 끝난다.
  `CREATE INDEX IF NOT EXISTS article_embedding_hnsw
     ON "ArticleEmbedding" USING hnsw (embedding vector_cosine_ops)`,
];

async function main() {
  for (const s of STMTS) {
    process.stdout.write(`${s.split('\n')[0].slice(0, 62)}... `);
    await prisma.$executeRawUnsafe(s);
    console.log('OK');
  }
  const [{ n }] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*)::bigint n FROM "ArticleEmbedding"`
  );
  console.log(`\n현재 임베딩 ${Number(n).toLocaleString()}건`);
  await prisma.$disconnect();
}
main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
