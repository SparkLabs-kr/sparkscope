/**
 * 대시보드가 실제로 보여주는 데이터 (DB 쿼리 결과)
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
    console.log('\n📊 대시보드 실제 데이터 확인\n');

    // [1] 톤 분석(스파크랩)
    console.log('=== [1] 톤 분석(스파크랩) ===\n');

    const sparkLabsTone = await prisma.article.groupBy({
      by: ['tone'],
      where: { category: 'sparklabs_self' },
      _count: true,
    });

    console.log('sparklabs_self 톤 분포:');
    sparkLabsTone.forEach(t => {
      console.log(`  ${t.tone}: ${t._count}건`);
    });

    // [2] 경쟁사 카드
    console.log('\n=== [2] 경쟁사 카드 ===\n');

    const competitors = await prisma.article.groupBy({
      by: ['matchedKeyword'],
      where: { category: 'competitor' },
      _count: { _all: true },
    });

    const competitorsSorted = competitors.sort((a, b) => b._count._all - a._count._all).slice(0, 10);

    console.log('경쟁사 TOP10 (matchedKeyword):');
    competitorsSorted.forEach((c, i) => {
      console.log(`  ${i + 1}. ${c.matchedKeyword} (${c._count._all}건)`);
    });

    // [3] TOP15 포트폴리오
    console.log('\n=== [3] TOP15 포트폴리오 ===\n');

    const portfolio = await prisma.article.groupBy({
      by: ['matchedKeyword'],
      where: { category: 'portfolio_company' },
      _count: { _all: true },
    });

    const portfolioSorted = portfolio.sort((a, b) => b._count._all - a._count._all).slice(0, 15);

    console.log('포트폴리오 TOP15 (matchedKeyword):');
    portfolioSorted.forEach((p, i) => {
      console.log(`  ${i + 1}. ${p.matchedKeyword} (${p._count._all}건)`);
    });

    // [4] 임팩터스 기사
    console.log('\n=== [4] 임팩터스 기사 ===\n');

    const impacters = await prisma.article.findMany({
      where: { matchedKeyword: 'impacters' },
      select: {
        id: true,
        title: true,
        tone: true,
        category: true,
      },
      orderBy: { pubDate: 'desc' },
      take: 5,
    });

    console.log(`임팩터스 기사 ${impacters.length}건 (최근 5건):`);
    impacters.forEach((a, i) => {
      console.log(`  ${i + 1}. [${a.tone}] ${a.title.substring(0, 50)}...`);
    });

    // [5] monitoring-targets vs matchedKeyword 비교
    console.log('\n=== [5] monitoring-targets 기반 필터링 검증 ===\n');

    const competitorTargets = await prisma.monitoringTarget.findMany({
      where: { category: 'competitor', status: 'ACTIVE' },
      select: { primaryKeyword: true },
    });

    const competitorKeywords = new Set(competitorTargets.map(t => t.primaryKeyword));

    const allCompetitorArticles = await prisma.article.findMany({
      where: { category: 'competitor' },
      select: { matchedKeyword: true },
      take: 100,
    });

    const outsideCompetitors = allCompetitorArticles.filter(
      a => !competitorKeywords.has(a.matchedKeyword)
    );

    console.log(`경쟁사 분류 기사: ${allCompetitorArticles.length}건`);
    console.log(`monitoring-targets 경쟁사: ${competitorTargets.length}건`);
    console.log(`매칭되지 않는 키워드(=잘못된 분류): ${outsideCompetitors.length}건`);

    if (outsideCompetitors.length > 0) {
      console.log('\n잘못된 분류 예시:');
      const samples = new Set(outsideCompetitors.slice(0, 5).map(a => a.matchedKeyword));
      samples.forEach(k => console.log(`  - ${k}`));
    }

    console.log('\n');
    await prisma.$disconnect();

  } catch (error: any) {
    console.error(`❌ 에러: ${error.message}`);
    await prisma.$disconnect();
    process.exit(1);
  }
}

main();
