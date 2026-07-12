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
  console.log('🔄 CRISIS → NEGATIVE 통합\n');

  // CRISIS 건수 확인
  const crisisCount = await prisma.article.count({ where: { tone: 'CRISIS' } });
  console.log(`CRISIS 건수: ${crisisCount}건\n`);

  // UPDATE
  const result = await prisma.article.updateMany({
    where: { tone: 'CRISIS' },
    data: { tone: 'NEGATIVE' },
  });

  console.log(`✅ ${result.count}건 업데이트 완료\n`);

  // 최종 확인
  const tones = await prisma.article.groupBy({
    by: ['tone'],
    _count: { _all: true },
  });

  console.log('최종 tone 분포:');
  for (const t of tones) {
    console.log(`  - ${t.tone}: ${t._count._all}건`);
  }

  await prisma.$disconnect();
}

main();