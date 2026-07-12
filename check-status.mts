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
  const categories = await prisma.article.groupBy({
    by: ['category'],
    _count: true,
  });

  console.log('📊 카테고리별 기사 수:');
  for (const cat of categories) {
    console.log(`  - ${cat.category}: ${cat._count}건`);
  }

  const sparkLabsTones = await prisma.article.groupBy({
    by: ['tone'],
    where: { category: 'sparklabs_self' },
    _count: true,
  });

  console.log('\n🎵 sparklabs_self 톤 분포:');
  for (const tone of sparkLabsTones) {
    console.log(`  - ${tone.tone}: ${tone._count}건`);
  }

  await prisma.$disconnect();
}

main();