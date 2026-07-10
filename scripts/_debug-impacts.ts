import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';

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
  // 최근 3일 (현재 기준)
  const now = new Date();
  const rc = new Date(now);
  rc.setDate(rc.getDate() - 3);
  rc.setHours(0, 0, 0, 0);

  // 포트폴리오 부정 기사 (모두)
  const allNeg = await prisma.article.findMany({
    where: {
      pubDate: { gte: rc, lte: now },
      isNoise: false,
      category: 'portfolio_company',
      OR: [
        { tone: 'NEGATIVE' },
        { title: { contains: '논란' } },
        { title: { contains: '고소' } },
        { title: { contains: '사기' } },
        { title: { contains: '철회' } },
        { title: { contains: '무산' } },
        { title: { contains: '구속' } },
        { title: { contains: '적자' } },
        { title: { contains: '유출' } },
        { title: { contains: '사고' } },
      ]
    },
    select: {
      id: true,
      title: true,
      matchedKeyword: true,
      tone: true,
      source: true,
      pubDate: true,
    }
  });

  console.log(`\n📰 최근 3일 포트폴리오 부정 기사(원본): ${allNeg.length}건\n`);

  allNeg.forEach((a, i) => {
    const date = new Date(a.pubDate).toLocaleDateString('ko-KR');
    console.log(`${i + 1}. [${date}] ${a.matchedKeyword}`);
    console.log(`   제목: ${a.title.substring(0, 80)}`);
    console.log(`   톤: ${a.tone || 'NULL'}`);
    console.log(`   소스: ${a.source}\n`);
  });

  // 임팩터스만 필터링
  const impacts = allNeg.filter(a => a.matchedKeyword.includes('임팩터스'));
  console.log(`\n🎯 임팩터스 부정 기사: ${impacts.length}건\n`);
  impacts.forEach((a, i) => {
    console.log(`${i + 1}. ${a.title}`);
  });

  await prisma.$disconnect();
}

main().catch(console.error);
