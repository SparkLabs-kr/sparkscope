/**
 * 부분 재분류 결과 확인 (15,100건 처리 후)
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

async function checkPartialUpdates() {
  try {
    console.log('\n📊 부분 재분류 결과 (15,100건 처리 후)\n');

    const afterTime = new Date('2026-07-10T07:52:00Z');

    // [1] 전체
    const total = await prisma.article.count();

    // [2] 이번 재분류 후 업데이트 (analyzedAt >= 재분류 시작)
    const updated = await prisma.article.count({
      where: { analyzedAt: { gte: afterTime } },
    });

    // [3] 카테고리별
    const sparkLabs = await prisma.article.count({
      where: { category: 'sparklabs_self', analyzedAt: { gte: afterTime } },
    });
    const portfolio = await prisma.article.count({
      where: { category: 'portfolio_company', analyzedAt: { gte: afterTime } },
    });
    const competitor = await prisma.article.count({
      where: { category: 'competitor', analyzedAt: { gte: afterTime } },
    });
    const industry = await prisma.article.count({
      where: { category: 'industry_trend', analyzedAt: { gte: afterTime } },
    });

    console.log('| 항목 | 건수 |');
    console.log('|------|------|');
    console.log(`| 전체 | ${total} |`);
    console.log(`| 재분류 후 업데이트 | ${updated} |`);
    console.log(`| 미업데이트 | ${total - updated} |`);

    console.log('\n| 카테고리 | 업데이트 건수 |');
    console.log('|----------|------------|');
    console.log(`| sparklabs_self | ${sparkLabs} |`);
    console.log(`| portfolio_company | ${portfolio} |`);
    console.log(`| competitor | ${competitor} |`);
    console.log(`| industry_trend | ${industry} |`);

    console.log(`\n진행률: ${updated}/${15100} (${Math.round((updated / 15100) * 100)}%)`);

    await prisma.$disconnect();

  } catch (error: any) {
    console.error('\n❌ 에러:', error.message);
    await prisma.$disconnect();
    process.exit(1);
  }
}

checkPartialUpdates();
