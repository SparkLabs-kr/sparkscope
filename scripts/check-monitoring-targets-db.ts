/**
 * DB의 MonitoringTarget 테이블이 data 파일 데이터로 채워져 있는가?
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
    console.log('\n📊 MonitoringTarget DB 상태 확인\n');

    const total = await prisma.monitoringTarget.count();
    console.log(`총 항목: ${total}건\n`);

    const byCategory = await prisma.monitoringTarget.groupBy({
      by: ['category'],
      _count: true,
    });

    console.log('카테고리별:\n');
    byCategory.forEach(b => {
      console.log(`  ${b.category}: ${b._count}건`);
    });

    if (total === 0) {
      console.log('\n❌ DB가 비어있음! data 폴더 파일을 DB에 로드해야 함\n');
    } else {
      console.log('\n✅ DB에 데이터 있음\n');
    }

    await prisma.$disconnect();

  } catch (error: any) {
    console.error(`❌ 에러: ${error.message}`);
    await prisma.$disconnect();
    process.exit(1);
  }
}

main();
