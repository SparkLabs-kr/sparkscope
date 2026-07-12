/**
 * TOP 업계 키워드들이 현재 DB에서 어떤 category로 저장되어 있는지 확인
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
    console.log('\n📊 업계 키워드의 현재 category 분포\n');

    // 대시보드에서 TOP으로 나타나는 키워드들
    const industryKeywords = [
      'AI에이전트',
      '로보틱스',
      '생성형AI',
      'AI헬스',
      'AI',
      '챗봇',
      '머신러닝',
    ];

    for (const keyword of industryKeywords) {
      const distribution = await prisma.article.groupBy({
        by: ['category'],
        where: { matchedKeyword: keyword },
        _count: true,
      });

      console.log(`📌 "${keyword}":`);

      if (distribution.length === 0) {
        console.log(`  (DB에 없음)\n`);
        continue;
      }

      distribution.forEach(d => {
        console.log(`  - ${d.category}: ${d._count}건`);
      });
      console.log('');
    }

    // monitoring-targets에서 실제 category 확인
    console.log('\n🎯 monitoring-targets에서의 실제 category:\n');

    for (const keyword of industryKeywords) {
      const target = await prisma.monitoringTarget.findFirst({
        where: { primaryKeyword: keyword },
        select: { category: true, status: true },
      });

      if (target) {
        console.log(`"${keyword}": ${target.category} (${target.status})`);
      } else {
        console.log(`"${keyword}": ❌ monitoring-targets에 없음`);
      }
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
