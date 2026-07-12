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
  console.log('🔍 적자 오탐 수정 (예외단어 기준)\n');

  // 적자 예외단어 (tone-keywords.csv에서)
  const JAKJA_EXCEPTIONS = [
    '인적자원',
    '적자생존',
    '누적자',
    '면적자',
    '실적자료',
    '업적자',
    '적자색',
    '흑자전환',
    '적자탈출',
    '적자개선',
  ];

  console.log('적자 예외단어:');
  console.log(`  ${JAKJA_EXCEPTIONS.join(', ')}\n`);

  // 1. tone=NEGATIVE인 기사 중 "적자"가 있는 기사 찾기
  const negativeWithJakja = await prisma.article.findMany({
    where: {
      tone: 'NEGATIVE',
      title: { contains: '적자' },
    },
    select: { id: true, title: true, matchedKeyword: true, category: true, tone: true },
  });

  console.log(`1️⃣ NEGATIVE인 "적자" 포함 기사: ${negativeWithJakja.length}건\n`);

  // 2. 예외단어 포함 여부 확인
  const jakjaOversight = negativeWithJakja.filter(a => {
    return JAKJA_EXCEPTIONS.some(ex => a.title.includes(ex));
  });

  console.log(`2️⃣ 그 중 예외단어 포함 (오탐): ${jakjaOversight.length}건\n`);

  if (jakjaOversight.length > 0) {
    console.log('오탐 샘플 (3건):');
    for (const a of jakjaOversight.slice(0, 3)) {
      const title = a.title.substring(0, 65);
      const matched = JAKJA_EXCEPTIONS.filter(ex => a.title.includes(ex));
      console.log(`  - "${title}..."`);
      console.log(`    예외: ${matched.join(', ')}`);
    }
    if (jakjaOversight.length > 3) {
      console.log(`  ... 외 ${jakjaOversight.length - 3}건`);
    }

    // 3. NEUTRAL로 수정
    console.log(`\n3️⃣ 수정 중... NEGATIVE → NEUTRAL\n`);
    
    const ids = jakjaOversight.map(a => a.id);
    const result = await prisma.article.updateMany({
      where: { id: { in: ids } },
      data: { tone: 'NEUTRAL' },
    });
    
    console.log(`✅ ${result.count}건 수정됨\n`);
  }

  // 4. 최종 tone 분포
  const allTones = await prisma.article.groupBy({
    by: ['tone'],
    _count: { _all: true },
  });

  console.log(`📊 변경 후 전체 tone:\n`);
  for (const t of allTones) {
    console.log(`  - ${t.tone}: ${t._count._all}건`);
  }

  // 포트폴리오 부정
  const portfolioNeg = await prisma.article.count({
    where: {
      category: 'portfolio_company',
      tone: 'NEGATIVE',
    },
  });

  console.log(`\n📉 포트폴리오사 NEGATIVE 기사:`);
  console.log(`  이전: 250건`);
  console.log(`  현재: ${portfolioNeg}건`);
  console.log(`  감소: ${250 - portfolioNeg}건`);

  await prisma.$disconnect();
}

main();