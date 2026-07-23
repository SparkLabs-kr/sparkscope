/**
 * 마스터 시트(JSON)를 DB에 시드.
 * 첫 배포 직후 한 번 실행: npm run db:seed
 * 키워드를 추가/수정하면 다시 실행해도 안전 (upsert 사용)
 */
import { PrismaClient } from '@prisma/client';
import targets from '../data/master-keywords.json';

const prisma = new PrismaClient();

async function main() {
  console.log(`Seeding ${targets.length} monitoring targets...`);

  // 경쟁사 카테고리: 완전 교체 (이전 데이터 삭제)
  await prisma.monitoringTarget.deleteMany({
    where: { category: 'competitor' },
  });

  let created = 0;
  let updated = 0;

  for (const t of targets as any[]) {
    const existing = await prisma.monitoringTarget.findUnique({ where: { name: t.name } });

    await prisma.monitoringTarget.upsert({
      where: { name: t.name },
      create: {
        name: t.name,
        englishName: t.englishName,
        category: t.category,
        status: t.status,
        primaryKeyword: t.primaryKeyword,
        helperKeywords: t.helperKeywords,
        excludeWords: t.excludeWords,
        contextWords: t.contextWords ?? null,
        portfolioStatus: t.portfolioStatus ?? null,
        tier: t.tier ?? null,
        notes: t.notes,
      },
      update: {
        englishName: t.englishName,
        category: t.category,
        status: t.status,
        primaryKeyword: t.primaryKeyword,
        helperKeywords: t.helperKeywords,
        excludeWords: t.excludeWords,
        contextWords: t.contextWords ?? null,
        portfolioStatus: t.portfolioStatus ?? null,
        tier: t.tier ?? null,
        notes: t.notes,
      },
    });

    if (existing) updated++;
    else created++;
  }

  console.log(`✓ Created ${created}, Updated ${updated}`);

  // 카테고리별 카운트
  const cats = await prisma.monitoringTarget.groupBy({
    by: ['category', 'status'],
    _count: true,
  });
  console.log('\nDB state:');
  cats.forEach(c => console.log(`  · ${c.category} / ${c.status}: ${c._count}`));
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
