/**
 * 배치 재분류 작업의 실제 반영 결과 검증
 * DB 실측 숫자로 확인
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

async function verifyBatchResults() {
  try {
    console.log('\n🔬 배치 재분류 실제 반영 검증\n');

    // [1] 배치 작업 시각 찾기
    const batchLog = await prisma.runLog.findFirst({
      where: {
        runType: 'batch_reclassify',
      },
      orderBy: { startedAt: 'desc' },
    });

    if (!batchLog) {
      console.log('❌ 배치 작업 로그 없음');
      await prisma.$disconnect();
      process.exit(1);
    }

    const batchStartTime = batchLog.createdAt;
    console.log(`배치 작업: ${batchStartTime.toISOString()}`);
    console.log(`상태: ${batchLog.status}\n`);

    // [2] 전체 기사 수
    const totalArticles = await prisma.article.count();
    console.log(`[전체] ${totalArticles}건\n`);

    // [3] 배치 이후 업데이트된 건수 (analyzedAt >= 배치시각)
    const updated = await prisma.article.count({
      where: {
        analyzedAt: {
          gte: batchStartTime,
        },
      },
    });

    // [4] 배치 이전 (미업데이트)
    const notUpdated = totalArticles - updated;

    // [5] 카테고리별 갱신 건수
    const byCategory = await prisma.article.groupBy({
      by: ['category'],
      where: {
        analyzedAt: {
          gte: batchStartTime,
        },
      },
      _count: true,
    });

    const catCounts: Record<string, number> = {
      sparklabs_self: 0,
      portfolio_company: 0,
      competitor: 0,
      industry_trend: 0,
      unrelated: 0,
    };

    byCategory.forEach(row => {
      catCounts[row.category] = row._count;
    });

    // [6] 에러/스킵 건수 (로그에서)
    const errors = batchLog.errors ? batchLog.errors.split('\n').length : 0;

    // [7] 대시보드 데이터 (digestData 테이블)
    const latestDigest = await prisma.digest.findFirst({
      orderBy: { date: 'desc' },
    });

    console.log('📊 실제 반영 결과:\n');
    console.log('| 항목 | 건수 |');
    console.log('|------|------|');
    console.log(`| 배치 후 업데이트됨 (analyzedAt >= ${batchStartTime.toISOString().split('T')[0]}) | ${updated} |`);
    console.log(`| 미업데이트 (배치 이전) | ${notUpdated} |`);
    console.log(`| 에러/스킵 | ${errors} |`);
    console.log(`| 총합 | ${totalArticles} |`);

    console.log('\n📈 카테고리별 갱신 건수:\n');
    console.log('| 카테고리 | 갱신 건수 |');
    console.log('|----------|----------|');
    Object.entries(catCounts).forEach(([cat, count]) => {
      if (count > 0) {
        console.log(`| ${cat} | ${count} |`);
      }
    });

    console.log('\n📋 대시보드 반영:\n');
    if (latestDigest) {
      console.log(`| 항목 | 상태 |`);
      console.log('|------|------|');
      console.log(`| 최신 다이제스트 | ${latestDigest.date.toISOString().split('T')[0]} |`);
      console.log(`| 발송 여부 | ${latestDigest.sentAt ? '✅ 발송' : '❌ 미발송'} |`);
      console.log(`| 에러 | ${latestDigest.errorMsg ? latestDigest.errorMsg : '없음'} |`);
    } else {
      console.log('❌ 다이제스트 없음');
    }

    console.log('\n');

    await prisma.$disconnect();

  } catch (error: any) {
    console.error('\n❌ 에러:', error.message);
    await prisma.$disconnect();
    process.exit(1);
  }
}

verifyBatchResults();
