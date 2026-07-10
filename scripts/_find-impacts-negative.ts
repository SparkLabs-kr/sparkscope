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
  // 임팩터스 관련 부정 기사 (최근 3일 = 2026-07-06 이후)
  const articles = await prisma.article.findMany({
    where: {
      matchedKeyword: { contains: '임팩터스' },
      tone: 'NEGATIVE',
      pubDate: {
        gte: new Date('2026-07-06'),
      }
    },
    orderBy: { pubDate: 'desc' },
  });

  console.log(`\n📰 임팩터스 부정 기사 (최근 3일): ${articles.length}건\n`);

  articles.forEach((a, i) => {
    const date = new Date(a.pubDate).toLocaleDateString('ko-KR');
    console.log(`${i + 1}. [${date}] ${a.title.substring(0, 80)}`);
    console.log(`   ID: ${a.id}`);
    console.log(`   소스: ${a.source}`);
    console.log(`   톤: ${a.tone}`);
    console.log(`   링크: ${a.link}\n`);
  });

  await prisma.$disconnect();
}

main().catch(console.error);
