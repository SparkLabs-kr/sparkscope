/**
 * industry_trend category의 모든 키워드 조회
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
    const targets = await prisma.monitoringTarget.findMany({
      where: { category: 'industry_trend', status: 'ACTIVE' },
      select: { primaryKeyword: true },
      orderBy: { primaryKeyword: 'asc' },
    });

    const keywords = targets.map(t => t.primaryKeyword);

    console.log(`\n🎯 industry_trend 키워드 (${keywords.length}개):\n`);
    keywords.forEach((k, i) => {
      console.log(`  ${i + 1}. ${k}`);
    });

    console.log(`\n✅ TypeScript 배열 형식:\n`);
    console.log(`const INDUSTRY_TREND_KEYWORDS = [`);
    keywords.forEach(k => {
      console.log(`  '${k}',`);
    });
    console.log(`];\n`);

    await prisma.$disconnect();

  } catch (error: any) {
    console.error(`❌ 에러: ${error.message}`);
    await prisma.$disconnect();
    process.exit(1);
  }
}

main();
