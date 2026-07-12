/**
 * [2] 톤 분석(스파크랩) 복구
 * sparklabs_self 기사의 tone이 비어있으면 재분류
 */
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { hasNegativeKeyword } from '../src/lib/sparkscope/keywords-loader';

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

const POSITIVE_HINTS = ['투자 유치', '상장', '협업', '계약', '돌파', '선정', '수상', 'MOU', '런칭', '개시', '진출', '기록', '성장', '확대'];

function heuristicTone(title: string): string {
  if (hasNegativeKeyword(title)) return 'NEGATIVE';
  const isPos = POSITIVE_HINTS.some(k => title.includes(k));
  if (isPos) return 'POSITIVE';
  return 'NEUTRAL';
}

async function main() {
  try {
    console.log('\n🎯 [2] 톤 분석(스파크랩) 복구\n');

    // sparklabs_self 중 tone이 NULL인 기사 찾기
    const missing = await prisma.article.findMany({
      where: {
        category: 'sparklabs_self',
        tone: null,
      },
      select: {
        id: true,
        title: true,
        tone: true,
      },
    });

    console.log(`스파크랩 기사 중 톤 미지정: ${missing.length}건\n`);

    if (missing.length === 0) {
      console.log(`✅ 모든 스파크랩 기사에 톤 지정됨\n`);
      await prisma.$disconnect();
      return;
    }

    // tone 재분류 및 저장
    let updated = 0;
    for (const article of missing) {
      const tone = heuristicTone(article.title);

      await prisma.article.update({
        where: { id: article.id },
        data: { tone },
      });

      updated++;

      if (updated % 50 === 0) {
        console.log(`  진행: ${updated}/${missing.length}건`);
      }
    }

    console.log(`\n✅ 톤 복구 완료: ${updated}건\n`);

    // 톤 분포 확인
    const distribution = await prisma.article.groupBy({
      by: ['tone'],
      where: { category: 'sparklabs_self' },
      _count: true,
    });

    console.log(`📊 스파크랩 기사 톤 분포:\n`);
    distribution.forEach(d => {
      console.log(`  ${d.tone || 'NULL'}: ${d._count}건`);
    });
    console.log('');

    await prisma.$disconnect();

  } catch (error: any) {
    console.error(`❌ 에러: ${error.message}`);
    await prisma.$disconnect();
    process.exit(1);
  }
}

main();
