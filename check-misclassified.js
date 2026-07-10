const fs = require('fs');
const path = require('path');

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

  // "기정원" 또는 "데모데이"로 검색
  const articles = await prisma.article.findMany({
    where: {
      title: {
        contains: '기정원',
      },
      category: 'sparklabs_self',
    },
    select: {
      id: true,
      title: true,
      source: true,
      category: true,
      matchedKeyword: true,
      importance: true,
      tone: true,
      isNoise: true,
      noiseReason: true,
    },
  });

  console.log(`\n[오분류 기사 확인]\n`);
  console.log(`검색 결과: ${articles.length}건\n`);

  for (const a of articles) {
    console.log(`📰 ${a.title}`);
    console.log(`   출처: ${a.source}`);
    console.log(`   분류: ${a.category} (중요도: ${a.importance})`);
    console.log(`   매칭키: ${a.matchedKeyword}`);
    console.log(`   스파크랩 언급: ${a.title.includes('스파크랩') || a.title.includes('SparkLabs') ? '✅ 있음' : '❌ 없음'}`);
    console.log('');
  }

  await prisma.$disconnect();
})();
