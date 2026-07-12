/**
 * 배치 재분류 실제 반영 - 간단 검증
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

async function checkBatch() {
  try {
    console.log('\n📊 배치 재분류 실제 반영 검증\n');

    const batchStart = new Date('2026-07-09T20:00:00Z');

    // [1] 전체
    const total = await prisma.article.count();

    // [2] 배치 이후 업데이트 (analyzedAt >= 배치 시작)
    const updated = await prisma.article.count({
      where: { analyzedAt: { gte: batchStart } },
    });

    // [3] 미업데이트
    const notUpdated = total - updated;

    // [4] 카테고리별 현황
    const sparkLabsSelf = await prisma.article.count({
      where: { category: 'sparklabs_self' },
    });
    const portfolio = await prisma.article.count({
      where: { category: 'portfolio_company' },
    });
    const competitor = await prisma.article.count({
      where: { category: 'competitor' },
    });
    const industry = await prisma.article.count({
      where: { category: 'industry_trend' },
    });
    const unrelated = await prisma.article.count({
      where: { category: 'unrelated' },
    });

    // [5] 카테고리별 배치 이후 업데이트
    const upSparkLabs = await prisma.article.count({
      where: { category: 'sparklabs_self', analyzedAt: { gte: batchStart } },
    });
    const upPortfolio = await prisma.article.count({
      where: { category: 'portfolio_company', analyzedAt: { gte: batchStart } },
    });
    const upCompetitor = await prisma.article.count({
      where: { category: 'competitor', analyzedAt: { gte: batchStart } },
    });
    const upIndustry = await prisma.article.count({
      where: { category: 'industry_trend', analyzedAt: { gte: batchStart } },
    });

    // [6] 최신 분석
    const latest = await prisma.article.findFirst({
      where: { analyzedAt: { not: null } },
      orderBy: { analyzedAt: 'desc' },
      select: { analyzedAt: true },
    });

    console.log('| 항목 | 건수 |');
    console.log('|------|------|');
    console.log(`| 전체 | ${total} |`);
    console.log(`| 배치 후 업데이트 | ${updated} |`);
    console.log(`| 미업데이트 | ${notUpdated} |`);

    console.log('\n| 카테고리 | 현황 | 배치 이후 업데이트 |');
    console.log('|----------|------|----------|');
    console.log(`| sparklabs_self | ${sparkLabsSelf} | ${upSparkLabs} |`);
    console.log(`| portfolio_company | ${portfolio} | ${upPortfolio} |`);
    console.log(`| competitor | ${competitor} | ${upCompetitor} |`);
    console.log(`| industry_trend | ${industry} | ${upIndustry} |`);
    console.log(`| unrelated | ${unrelated} | - |`);

    if (latest) {
      console.log(`\n최신 분석: ${latest.analyzedAt.toISOString()}`);
    }

    console.log('\n');

    await prisma.$disconnect();

  } catch (error: any) {
    console.error('\n❌ 에러:', error.message);
    await prisma.$disconnect();
    process.exit(1);
  }
}

checkBatch();
