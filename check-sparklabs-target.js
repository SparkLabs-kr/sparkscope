const fs = require('fs');

const env = fs.readFileSync('.env.local', 'utf-8');
for (const line of env.split('\n')) {
  const match = line.match(/^([^=]+)=(.+)$/);
  if (!match) continue;
  const key = match[1].trim();
  let val = match[2].trim();
  if (val.startsWith('"')) val = val.slice(1, -1);
  if (key.startsWith('POSTGRES') || key.startsWith('DATABASE')) {
    process.env[key] = val;
  }
}

(async () => {
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();

  const sparkLabsTarget = await prisma.monitoringTarget.findFirst({
    where: {
      name: '스파크랩',
    },
  });

  console.log('\n[스파크랩 모니터링 설정]\n');
  console.log('이름:', sparkLabsTarget.name);
  console.log('카테고리:', sparkLabsTarget.category);
  console.log('주 키워드:', sparkLabsTarget.primaryKeyword);
  console.log('보조 키워드:', sparkLabsTarget.helperKeywords || '(없음)');
  console.log('제외 키워드:', sparkLabsTarget.excludeWords || '(없음)');
  console.log('\n');

  // 지금 sparklabs_self인 모든 기사 확인
  const allSparkLabsSelf = await prisma.article.findMany({
    where: { category: 'sparklabs_self' },
    select: {
      id: true,
      title: true,
      matchedKeyword: true,
      tone: true,
    },
    orderBy: { pubDate: 'desc' },
    take: 20,
  });

  console.log(`[sparklabs_self 카테고리 기사 (최근 20건)]\n`);
  let hasSparkLabsInTitle = 0;
  let noSparkLabsInTitle = 0;

  for (const a of allSparkLabsSelf) {
    const hasKeyword = a.title.includes('스파크랩') || a.title.includes('SparkLabs');
    if (hasKeyword) {
      hasSparkLabsInTitle++;
    } else {
      noSparkLabsInTitle++;
    }
    const marker = hasKeyword ? '✅' : '❌';
    console.log(`${marker} ${a.title.substring(0, 60)}`);
  }

  console.log(`\n통계: 스파크랩 언급 있음 ${hasSparkLabsInTitle}건, 없음 ${noSparkLabsInTitle}건`);

  await prisma.$disconnect();
})();
