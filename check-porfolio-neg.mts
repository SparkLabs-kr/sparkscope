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
  console.log('📊 포트폴리오 부정 기사 TOP 현황\n');

  // 부정 키워드 정의 (tone-keywords.csv에서)
  const NEGATIVE_KEYWORDS = [
    '파산', '도산', '부도', '회생절차',
    '손실', '손해', '적자', '영업손실',
    '소송', '피소', '고발', '분쟁',
    '위반', '적발', '급락', '급감', '폭락',
    '논란', '비판', '의혹', '횡령', '배임',
    '유출', '리콜', '해킹',
  ];

  // 포트폴리오 부정 기사 (기간 전체)
  const negOr = [
    { tone: 'NEGATIVE' },
    ...NEGATIVE_KEYWORDS.map(k => ({ title: { contains: k } })),
  ];

  const portfolioNeg = await prisma.article.findMany({
    where: {
      category: 'portfolio_company',
      isNoise: false,
      OR: negOr,
    },
    select: { 
      id: true, 
      title: true, 
      matchedKeyword: true, 
      tone: true,
      pubDate: true,
    },
    orderBy: { pubDate: 'desc' },
    take: 10,
  });

  console.log(`포트폴리오 부정 기사 TOP 10:\n`);
  
  for (let i = 0; i < Math.min(3, portfolioNeg.length); i++) {
    const a = portfolioNeg[i];
    console.log(`${i + 1}. "${a.title.substring(0, 65)}..."`);
    console.log(`   키워드: ${a.matchedKeyword}`);
    console.log(`   tone: ${a.tone}`);
    console.log('');
  }

  await prisma.$disconnect();
}

main();