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
  console.log('🔍 한샘 김유진 기사 처리\n');

  // 한샘 김유진 기사 찾기
  const articles = await prisma.article.findMany({
    where: {
      title: { contains: '한샘' },
      title: { contains: '김유진' },
    },
    select: { id: true, title: true, tone: true, isNoise: true, matchedKeyword: true },
  });

  console.log(`찾은 기사: ${articles.length}건\n`);

  for (const a of articles) {
    console.log(`제목: "${a.title.substring(0, 70)}..."`);
    console.log(`  현재: isNoise=${a.isNoise}, tone=${a.tone}`);
    console.log(`  키워드: ${a.matchedKeyword}\n`);
    
    // isNoise 마킹
    if (!a.isNoise) {
      await prisma.article.update({
        where: { id: a.id },
        data: { isNoise: true, noiseReason: '중복' },
      });
      console.log(`  ✅ isNoise=true로 마킹됨\n`);
    }
  }

  await prisma.$disconnect();
}

main();