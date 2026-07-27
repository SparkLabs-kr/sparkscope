/**
 * 마스터 시트(JSON)를 DB에 시드.
 * 첫 배포 직후 한 번 실행: npm run db:seed
 * 키워드를 추가/수정하면 다시 실행해도 안전 (upsert 사용)
 * 프로덕션 자동 동기화는 /api/cron/seed-keywords 참고 (같은 로직 공유).
 */
import { seedKeywords } from '../src/lib/sparkscope/seed-keywords';
import { prisma } from '../src/lib/prisma';

async function main() {
  const result = await seedKeywords();
  console.log(`Seeding ${result.total} monitoring targets...`);
  console.log(`✓ Created ${result.created}, Updated ${result.updated}`);
  console.log('\nDB state:');
  result.counts.forEach(c => console.log(`  · ${c.category} / ${c.status}: ${c.count}`));
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
