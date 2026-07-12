/**
 * [4] unrelated 기사 1,536건 삭제
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
    console.log('\n🗑️  [4] unrelated 기사 삭제\n');

    const result = await prisma.article.deleteMany({
      where: { category: 'unrelated' },
    });

    console.log(`✅ 삭제 완료: ${result.count}건\n`);

    // 최종 확인
    const remaining = await prisma.article.count();
    console.log(`📊 남은 기사: ${remaining}건\n`);

    await prisma.$disconnect();

  } catch (error: any) {
    console.error(`❌ 에러: ${error.message}`);
    await prisma.$disconnect();
    process.exit(1);
  }
}

main();
