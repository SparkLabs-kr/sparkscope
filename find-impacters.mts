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
  console.log('🔍 임팩터스 기사 찾기\n');

  const impacters = await prisma.article.findMany({
    where: {
      title: { contains: '임팩터스' },
    },
    select: { id: true, title: true, tone: true, matchedKeyword: true, category: true, pubDate: true },
    orderBy: { pubDate: 'desc' },
    take: 10,
  });

  console.log(`제목에 "임팩터스"가 있는 기사: ${impacters.length}건\n`);
  
  for (const a of impacters) {
    console.log(`제목: "${a.title.substring(0, 60)}..."`);
    console.log(`  matchedKeyword: ${a.matchedKeyword}`);
    console.log(`  category: ${a.category}`);
    console.log(`  tone: ${a.tone}`);
    console.log('');
  }

  await prisma.$disconnect();
}

main();