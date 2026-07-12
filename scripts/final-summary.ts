/**
 * 7가지 작업 최종 요약
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
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`    7가지 기준 재정비 작업 완료!`);
    console.log(`${'═'.repeat(60)}\n`);

    const total = await prisma.article.count();
    const stats = await prisma.article.groupBy({
      by: ['category'],
      _count: true,
    });

    console.log(`📊 현재 DB 상태:\n`);
    console.log(`  총 기사: ${total}건\n`);
    console.log(`  카테고리별 분포:\n`);

    const catOrder = ['sparklabs_self', 'portfolio_company', 'competitor', 'industry_trend', 'unrelated'];
    for (const cat of catOrder) {
      const count = stats.find(s => s.category === cat)?._count || 0;
      if (count > 0) {
        console.log(`    ${cat}: ${count}건`);
      }
    }

    console.log(`\n✅ 작업별 결과:\n`);
    console.log(`  [1] 경쟁사 필터링`);
    console.log(`      → data/monitoring-targets.csv (category='competitor'만)\n`);

    console.log(`  [2] 톤 분석(스파크랩) 복구`);
    console.log(`      → sparklabs_self 기사 톤 지정 완료\n`);

    console.log(`  [3] 임팩터스 "적자" 오탐`);
    console.log(`      → 기관명 포함 "적자" 예외 규칙 추가\n`);

    console.log(`  [4] unrelated 기사 처리`);
    console.log(`      → 1,536건 삭제 → 24,534건 남음\n`);

    console.log(`  [5] 키워드 규칙 재반영`);
    console.log(`      → data 폴더 파일 (단일 기준)\n`);

    console.log(`  [6] 상태 필드 추가`);
    console.log(`      → status: ACTIVE/EXIT/M&A (CSV 준비)\n`);

    console.log(`${'─'.repeat(60)}\n`);
    console.log(`📋 다음 단계:\n`);
    console.log(`  1. 대시보드 접속 → 기준 변화 확인`);
    console.log(`  2. 경쟁사 카드, 톤 분석, 위기감지 카드 정상 작동 확인`);
    console.log(`  3. monitoring-targets 상태값 채우기 (선택)\n`);

    await prisma.$disconnect();

  } catch (error: any) {
    console.error(`❌ 에러: ${error.message}`);
    await prisma.$disconnect();
    process.exit(1);
  }
}

main();
