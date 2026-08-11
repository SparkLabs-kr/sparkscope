// pg_trgm + GIN 인덱스 — 챗봇 검색이 title/oneLiner를 ILIKE '%...%'로 여러 개 OR 하기 때문에
// 인덱스 없이는 매번 3만 행 순차 스캔이 된다. 추가 전용(additive)이라 기존 스키마를 건드리지 않는다.
// prisma db push는 프로덕션 drift 때문에 쓰지 않는다.
import { prisma } from '../src/lib/prisma';

const STMTS = [
  `CREATE EXTENSION IF NOT EXISTS pg_trgm`,
  `CREATE INDEX IF NOT EXISTS article_title_trgm ON "Article" USING gin (title gin_trgm_ops)`,
  `CREATE INDEX IF NOT EXISTS article_oneliner_trgm ON "Article" USING gin ("oneLiner" gin_trgm_ops)`,
  `CREATE INDEX IF NOT EXISTS article_related_trgm ON "Article" USING gin ("relatedCompanies" gin_trgm_ops)`,
];

async function main() {
  for (const s of STMTS) {
    process.stdout.write(`${s.slice(0, 70)}... `);
    await prisma.$executeRawUnsafe(s);
    console.log('OK');
  }
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
