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
  console.log('🔄 tone을 대문자로 변환 중 (CRISIS 유지)\n');

  const updates = [
    { from: 'positive', to: 'POSITIVE' },
    { from: 'negative', to: 'NEGATIVE' },
    { from: 'neutral', to: 'NEUTRAL' },
    { from: 'crisis', to: 'CRISIS' },
  ];

  let totalUpdated = 0;

  for (const u of updates) {
    const result = await prisma.article.updateMany({
      where: { tone: u.from },
      data: { tone: u.to },
    });
    console.log(`  ✓ ${u.from} → ${u.to}: ${result.count}건`);
    totalUpdated += result.count;
  }

  console.log(`\n✅ 변환 완료! 총 ${totalUpdated}건 업데이트\n`);

  // 확인
  const after = await prisma.article.groupBy({
    by: ['tone'],
    _count: { _all: true },
  });

  console.log('변환 후:');
  for (const t of after) {
    console.log(`  - ${t.tone}: ${t._count._all}건`);
  }

  await prisma.$disconnect();
}

main();