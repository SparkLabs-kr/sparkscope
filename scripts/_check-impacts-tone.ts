import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';

// .env.local 수동 로드
const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      const value = match[2].trim().replace(/^"(.*)"$/, '$1');
      process.env[key] = value;
    }
  }
}

const prisma = new PrismaClient();

async function main() {
  // 임팩터스 관련 모든 기사 (기간: 2026-04-09 ~ 2026-07-08)
  const articles = await prisma.article.findMany({
    where: {
      matchedKeyword: { contains: '임팩터스' },
      pubDate: {
        gte: new Date('2026-04-09'),
        lte: new Date('2026-07-08'),
      }
    },
    orderBy: { pubDate: 'desc' },
    take: 50,
  });

  console.log(`\n📰 임팩터스 관련 기사 (2026-04-09 ~ 2026-07-08): ${articles.length}건\n`);
  console.log('톤별 분류:');
  const tones: Record<string, number> = {};
  articles.forEach(a => {
    tones[a.tone || 'NULL'] = (tones[a.tone || 'NULL'] || 0) + 1;
  });
  Object.entries(tones).forEach(([tone, count]) => {
    console.log(`  ${tone}: ${count}건`);
  });

  console.log('\n--- 부정(NEGATIVE) 기사만 ---\n');
  const negativeArticles = articles.filter(a => a.tone === 'NEGATIVE');

  negativeArticles.forEach((a, i) => {
    const date = new Date(a.pubDate);
    console.log(`${i + 1}. [${date.toLocaleDateString('ko-KR')} ${date.toLocaleTimeString('ko-KR')}]`);
    console.log(`   제목: ${a.title}`);
    console.log(`   ID: ${a.id}`);
    console.log(`   소스: ${a.source}`);
    console.log(`   톤: ${a.tone}\n`);
  });

  await prisma.$disconnect();
}

main().catch(console.error);
