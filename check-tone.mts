import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

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
  console.log('📊 현재 DB tone 상태 분석\n');

  // 1. 소문자 tone 건수 확인
  const allTones = await prisma.article.groupBy({
    by: ['tone'],
    _count: { _all: true },
  });

  console.log('1️⃣ 지금 DB의 tone 분포:');
  let lowercaseCount = 0;
  let uppercaseCount = 0;
  for (const t of allTones) {
    const count = t._count._all;
    const isLower = t.tone === t.tone?.toLowerCase();
    console.log(`  - ${t.tone}: ${count}건 ${isLower ? '(소문자 ⚠️)' : '(대문자 ✓)'}`);
    if (isLower && t.tone !== null) lowercaseCount += count;
    if (!isLower && t.tone !== null) uppercaseCount += count;
  }

  console.log(`\n  소문자: ${lowercaseCount}건`);
  console.log(`  대문자: ${uppercaseCount}건`);
  console.log(`  NULL: ${allTones.find(t => t.tone === null)?._count._all || 0}건`);

  // 2. 변환 영향 범위
  console.log('\n2️⃣ 변환할 범위:');
  const toLower = ['positive', 'negative', 'neutral', 'crisis'];
  for (const lower of toLower) {
    const count = await prisma.article.count({ where: { tone: lower } });
    if (count > 0) {
      console.log(`  - ${lower} → ${lower.toUpperCase()}: ${count}건`);
    }
  }

  // 3. crisis 처리
  console.log('\n3️⃣ CRISIS 대시보드 처리:');
  console.log('  현재 대시보드 ToneBreakdown에서:');
  console.log('  - POSITIVE (긍정)');
  console.log('  - NEUTRAL (중립)');
  console.log('  - NEGATIVE (부정) ← 여기에 CRISIS도 포함되나?');
  console.log('  ');
  console.log('  대시보드 코드 확인 필요: CRISIS가 NEGATIVE로 취급되나?');

  await prisma.$disconnect();
}

main();