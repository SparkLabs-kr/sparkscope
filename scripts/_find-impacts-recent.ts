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
  // 임팩터스 관련 최근 기사 (최근 10일)
  const from = new Date();
  from.setDate(from.getDate() - 10);

  const articles = await prisma.article.findMany({
    where: {
      matchedKeyword: { contains: '임팩터스' },
      pubDate: {
        gte: from,
      }
    },
    orderBy: { pubDate: 'desc' },
  });

  console.log(`\n📰 임팩터스 관련 최근 기사 (${from.toLocaleDateString('ko-KR')} 이후): ${articles.length}건\n`);

  articles.forEach((a, i) => {
    const date = new Date(a.pubDate);
    console.log(`${i + 1}. [${date.toLocaleDateString('ko-KR')}] ${a.title}`);
    console.log(`   톤: ${a.tone || 'NULL'} | 소스: ${a.source}`);
    console.log(`   ID: ${a.id}\n`);
  });

  await prisma.$disconnect();
}

main().catch(console.error);
