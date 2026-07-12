/**
 * 2단계 재적용 대상 규모 파악
 */
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
  try {
    console.log('\n📋 2단계 재적용 대상 규모\n');

    const total = await prisma.article.count();
    console.log(`전체 기사: ${total}건\n`);

    // 톤이 비어있는 기사 (sparklabs_self)
    const noTone = await prisma.article.count({
      where: { tone: null },
    });
    console.log(`tone이 NULL: ${noTone}건\n`);

    // 임팩터스 "적자" 오탐 (tone='NEGATIVE'인데 기관명 포함)
    const impactersArticles = await prisma.article.findMany({
      where: {
        matchedKeyword: 'impacters',
        tone: 'NEGATIVE',
      },
      select: { id: true, title: true },
    });
    console.log(`임팩터스 부정기사: ${impactersArticles.length}건`);
    if (impactersArticles.length > 0) {
      console.log(`  예시: ${impactersArticles[0].title.substring(0, 50)}...\n`);
    }

    // 경쟁사/포트폴리오에서 제외해야 할 업계 키워드 기사
    const industryInTop = await prisma.article.count({
      where: {
        OR: [
          { category: 'competitor' },
          { category: 'portfolio_company' },
        ],
      },
    });
    console.log(`경쟁사/포트폴리오 기사: ${industryInTop}건\n`);

    console.log(`⏱️  예상 소요 시간:`);
    console.log(`  - 톤 채우기(${noTone}건): ~1초`);
    console.log(`  - 오탐 수정(${impactersArticles.length}건): ~1초`);
    console.log(`  - 카테고리 재검토(전체): ~5분\n`);

    await prisma.$disconnect();

  } catch (error: any) {
    console.error(`❌ 에러: ${error.message}`);
    await prisma.$disconnect();
    process.exit(1);
  }
}

main();
