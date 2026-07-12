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
  console.log('🔍 임팩터스 기사 상태 확인\n');

  const impacters = await prisma.article.findMany({
    where: {
      matchedKeyword: 'impacters',
      category: 'portfolio_company',
    },
    select: { id: true, title: true, tone: true, pubDate: true },
    orderBy: { pubDate: 'desc' },
    take: 20,
  });

  console.log(`임팩터스 기사: ${impacters.length}건\n`);
  
  const negCount = impacters.filter(a => a.tone === 'NEGATIVE').length;
  console.log(`NEGATIVE tone: ${negCount}건\n`);

  if (negCount > 0) {
    console.log('NEGATIVE인 기사들:');
    for (const a of impacters.filter(a => a.tone === 'NEGATIVE')) {
      console.log(`  - "${a.title.substring(0, 60)}..."`);
      console.log(`    tone: ${a.tone}`);
    }
    console.log(`\n❌ 이 기사들이 부정으로 표시되고 있습니다.`);
  } else {
    console.log('✅ 모든 임팩터스 기사가 NEGATIVE가 아닙니다.');
  }

  await prisma.$disconnect();
}

main();