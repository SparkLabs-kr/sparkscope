/**
 * [4] unrelated 기사 삭제 전 개수 확인
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
    console.log('\n📊 [4] unrelated 기사 개수 확인\n');

    const count = await prisma.article.count({
      where: { category: 'unrelated' },
    });

    console.log(`⚠️  삭제 예정: ${count}건\n`);

    if (count > 0) {
      // 샘플 몇 건 표시
      const samples = await prisma.article.findMany({
        where: { category: 'unrelated' },
        select: {
          id: true,
          title: true,
          pubDate: true,
        },
        take: 5,
        orderBy: { pubDate: 'desc' },
      });

      console.log('샘플 기사:\n');
      samples.forEach((s, i) => {
        console.log(`${i + 1}. [${s.pubDate.toISOString().split('T')[0]}] ${s.title.substring(0, 50)}...`);
      });
      console.log('');
    }

    console.log(`📋 확인 사항:`);
    console.log(`- 전체 기사: ${await prisma.article.count()}건`);
    console.log(`- unrelated: ${count}건`);
    console.log(`- 삭제 후: ${await prisma.article.count() - count}건\n`);

    console.log(`⏳ 다음 단계: 사용자가 "삭제 확인"하면 처리\n`);

    await prisma.$disconnect();

  } catch (error: any) {
    console.error(`❌ 에러: ${error.message}`);
    await prisma.$disconnect();
    process.exit(1);
  }
}

main();
