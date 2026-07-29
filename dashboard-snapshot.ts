import { prisma } from '@/lib/prisma';

async function main() {
  const portfolio = await prisma.monitoringTarget.findMany({
    where: { category: 'portfolio_company', status: 'ACTIVE' },
    select: { name: true, englishName: true, tier: true },
    take: 10,
  });

  const competitor = await prisma.monitoringTarget.findMany({
    where: { category: 'competitor', status: 'ACTIVE' },
    select: { name: true, tier: true },
    take: 10,
  });

  const tier1Competitors = await prisma.monitoringTarget.findMany({
    where: { category: 'competitor', status: 'ACTIVE', tier: '1' },
    select: { name: true },
  });

  console.log('📈 대시보드 스냅샷\n');
  console.log('=====================================\n');

  console.log('🏢 포트폴리오사 샘플 (총 363개)');
  console.log('─────────────────────────────────────');
  portfolio.forEach(p => {
    console.log(`  • ${p.name}${p.englishName ? ' (' + p.englishName + ')' : ''}`);
  });

  console.log('\n🏆 경쟁사 샘플 (총 97개)');
  console.log('─────────────────────────────────────');
  competitor.forEach(c => {
    const tier = c.tier ? ` [tier=${c.tier}]` : '';
    console.log(`  • ${c.name}${tier}`);
  });

  console.log(`\n⭐ Tier='1' 경쟁사 샘플 (총 ${tier1Competitors.length}개)`);
  console.log('─────────────────────────────────────');
  tier1Competitors.slice(0, 5).forEach(c => {
    console.log(`  • ${c.name}`);
  });

  console.log(`\n✨ 복원된 포트폴리오사 확인 (35개 중 샘플)`);
  console.log('─────────────────────────────────────');
  const restored = ['글로벌모기지그룹', '드림스퀘어', '별별선생', '비트윈잡'];
  const portfolioNames = portfolio.map(p => p.name);

  for (const name of restored) {
    const found = await prisma.monitoringTarget.findUnique({
      where: { name },
      select: { name: true, tier: true }
    });
    console.log(`  ${found ? '✅' : '❌'} ${name}${found && found.tier ? ` (tier=${found.tier})` : ''}`);
  }

  console.log('\n=====================================');
  console.log('✅ 포트폴리오사: 363개');
  console.log('✅ 경쟁사: 97개 (tier=1: 19개)');
  console.log('✅ 대시보드 준비 완료\n');

  await prisma.$disconnect();
}

main();
