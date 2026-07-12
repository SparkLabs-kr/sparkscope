import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      let value = match[2].trim();
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  }
}

const prisma = new PrismaClient();

async function main() {
  console.log('🔍 노이즈 기사 처리\n');

  const noiseArticles = [
    '온도로 DNA 합성',
    '스마트팜의 미래 경쟁력',
    '경기경제청, 외투기업',
    '화학 시약',
    '환혼',
    '피습 자작극',
    '닥터 섬보이',
    'ICML 2026',
    '미션카 선교회',
  ];

  let markedCount = 0;
  const foundArticles = [];

  for (const keyword of noiseArticles) {
    const article = await prisma.article.findFirst({
      where: {
        title: { contains: keyword },
      },
      select: { 
        id: true, 
        title: true, 
        matchedKeyword: true,
        isNoise: true,
      },
    });

    if (article) {
      foundArticles.push(article);
      
      if (!article.isNoise) {
        await prisma.article.update({
          where: { id: article.id },
          data: { isNoise: true, noiseReason: '오탐' },
        });
        markedCount++;
      }
    }
  }

  console.log(`✅ ${markedCount}건 isNoise=true 마킹\n`);
  
  console.log('【 기사별 모니터링 키워드 】\n');
  for (const a of foundArticles) {
    console.log(`"${a.title.substring(0, 65)}..."`);
    console.log(`  키워드: ${a.matchedKeyword}\n`);
  }

  await prisma.$disconnect();
}

main();