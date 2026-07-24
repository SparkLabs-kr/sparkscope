import { prisma } from '@/lib/prisma';

async function main() {
  const competitors = await prisma.monitoringTarget.findMany({
    where: { category: 'competitor', status: 'ACTIVE' },
    select: { name: true, tier: true },
  });

  console.log(`DB의 경쟁사: ${competitors.length}개`);

  const tier1 = competitors.filter(c => c.tier === '1');
  console.log(`tier='1': ${tier1.length}개`);

  // 알토스벤처스 확인
  const altos = competitors.find(c => c.name.includes('알토스'));
  console.log(`\n알토스벤처스 확인: ${altos ? '✅ 있음' : '❌ 없음'}`);
  if (altos) {
    console.log(`  - 이름: ${altos.name}`);
    console.log(`  - tier: ${altos.tier}`);
  }

  console.log(`\ntier='1' 샘플 5개:`);
  tier1.slice(0, 5).forEach(c => {
    console.log(`  - ${c.name}`);
  });

  await prisma.$disconnect();
}

main();
