/**
 * 과거 기사 백필 — build-backfill 스크립트가 만든 JSON을 Article 테이블에 삽입.
 * 링크(backfill://해시)가 이미 있으면 건너뜀(skipDuplicates)이라 재실행 안전.
 * AI 재분석 없음 — importance/tone/oneLiner 등은 비워둠(priorityScore=0).
 *
 * 실행: BACKFILL_JSON=<경로> tsx scripts/backfill-articles.ts
 */
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';

const prisma = new PrismaClient();

interface Row {
  title: string;
  link: string;
  source: string;
  pubDate: string; // YYYY-MM-DD
  matchedKeyword: string;
  category: string;
}

const CHUNK = 500;

async function main() {
  const jsonPath = process.env.BACKFILL_JSON ?? 'data/backfill.json';
  const rows: Row[] = JSON.parse(readFileSync(jsonPath, 'utf8'));
  console.log(`읽은 백필 대상: ${rows.length}건 (${jsonPath})`);

  let inserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const batch = rows.slice(i, i + CHUNK).map(r => ({
      title: r.title,
      link: r.link,
      source: r.source,
      pubDate: new Date(r.pubDate + 'T00:00:00Z'),
      matchedKeyword: r.matchedKeyword,
      category: r.category,
      isNoise: false,
      priorityScore: 0,
      collectedAt: new Date(),
    }));
    const res = await prisma.article.createMany({ data: batch, skipDuplicates: true });
    inserted += res.count;
  }

  const skipped = rows.length - inserted;
  console.log(`\n백필 완료: 신규 ${inserted}건 / 기존(중복) 건너뜀 ${skipped}건`);

  // 백필 데이터 카테고리별 집계
  const g = await prisma.article.groupBy({
    by: ['category'],
    where: { link: { startsWith: 'backfill://' } },
    _count: true,
  });
  console.log('\n=== 현재 DB의 백필 기사 (카테고리별) ===');
  g.forEach(x => console.log(`  ${x.category}: ${(x as any)._count}`));
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
