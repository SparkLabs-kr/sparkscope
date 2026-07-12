/**
 * 배치 재분류 실제 반영 결과 - article 테이블 직접 검증
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

async function verifyBatchActual() {
  try {
    console.log('\n🔬 배치 재분류 실제 반영 검증 (article 테이블)\n');

    // 배치 작업 시각 추정: 어제 저녁~오늘 아침 (예: 2026-07-09 20:00 ~ 2026-07-10 08:00)
    // 대신 전체 updatedAt 분포로 확인

    const batchEstimateStart = new Date('2026-07-09T20:00:00Z');
    const batchEstimateEnd = new Date('2026-07-10T08:00:00Z');

    // [1] 전체 기사 수
    const total = await prisma.article.count();

    // [2] 배치 추정 시간 범위에 업데이트된 건수
    const batchUpdated = await prisma.article.count({
      where: {
        analyzedAt: {
          gte: batchEstimateStart,
          lte: batchEstimateEnd,
        },
      },
    });

    // [3] 배치 이전 (미업데이트)
    const beforeBatch = await prisma.article.count({
      where: {
        analyzedAt: {
          lt: batchEstimateStart,
        },
      },
    });

    // [4] 카테고리별 분포 (현재 상태)
    const byCat = await prisma.article.groupBy({
      by: ['category'],
      _count: true,
      orderBy: { _count: { _order: 'desc' } },
    });

    const catMap: Record<string, number> = {};
    byCat.forEach(row => {
      catMap[row.category] = row._count;
    });

    // [5] 카테고리별 배치 이후 업데이트된 건수
    const catBatchUpdated: Record<string, number> = {};
    for (const [cat, _] of Object.entries(catMap)) {
      const count = await prisma.article.count({
        where: {
          category: cat,
          updatedAt: {
            gte: batchEstimateStart,
            lte: batchEstimateEnd,
          },
        },
      });
      catBatchUpdated[cat] = count;
    }

    // [6] 최신 업데이트 시각
    const latest = await prisma.article.findFirst({
      orderBy: { updatedAt: 'desc' },
      select: { title: true, updatedAt: true, category: true },
    });

    // [7] updatedAt 분포 (시간대별)
    const all = await prisma.article.findMany({
      select: { analyzedAt: true },
    });

    const hourBuckets: Record<string, number> = {};
    all.forEach(a => {
      if (a.analyzedAt) {
        const hour = new Date(a.analyzedAt).toISOString().substring(0, 13);
        hourBuckets[hour] = (hourBuckets[hour] || 0) + 1;
      }
    });

    // 결과 출력
    console.log('📊 실제 반영 결과:\n');
    console.log('| 항목 | 건수 |');
    console.log('|------|------|');
    console.log(`| 전체 | ${total} |`);
    console.log(`| 배치 추정 시간 업데이트 (2026-07-09 20:00 ~ 2026-07-10 08:00) | ${batchUpdated} |`);
    console.log(`| 배치 이전 | ${beforeBatch} |`);

    console.log('\n📈 현재 카테고리 분포:\n');
    console.log('| 카테고리 | 건수 | 배치 이후 업데이트 |');
    console.log('|----------|------|----------|');
    Object.entries(catMap).forEach(([cat, count]) => {
      const updated = catBatchUpdated[cat] || 0;
      console.log(`| ${cat} | ${count} | ${updated} |`);
    });

    console.log('\n⏰ 최신 업데이트:\n');
    if (latest) {
      console.log(`| 항목 | 값 |`);
      console.log('|------|------|');
      console.log(`| 시각 | ${latest.updatedAt.toISOString()} |`);
      console.log(`| 카테고리 | ${latest.category} |`);
      console.log(`| 제목 | ${latest.title.substring(0, 60)}... |`);
    }

    console.log('\n🕐 업데이트 시간대별 분포:\n');
    console.log('| 시간 | 건수 |');
    console.log('|------|------|');
    Object.entries(hourBuckets)
      .sort()
      .slice(-24) // 최근 24시간
      .forEach(([hour, count]) => {
        console.log(`| ${hour}:00 | ${count} |`);
      });

    console.log('\n');

    await prisma.$disconnect();

  } catch (error: any) {
    console.error('\n❌ 에러:', error.message);
    await prisma.$disconnect();
    process.exit(1);
  }
}

verifyBatchActual();
