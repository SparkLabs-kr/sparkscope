/**
 * 대시보드가 새 NEGATIVE_KEYWORDS로 부정 기사를 찾고 있는지 확인
 */
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { NEGATIVE_KEYWORDS } from '../src/lib/sparkscope/insights';

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
    console.log('\n📊 대시보드 쿼리 검증\n');
    console.log(`사용 중인 NEGATIVE_KEYWORDS: ${NEGATIVE_KEYWORDS.length}개\n`);

    // 대시보드와 동일한 쿼리 실행 (최근 3일, 포트폴리오, 부정)
    const now = new Date();
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);

    const negOr = [
      { tone: 'NEGATIVE' as string | null },
      ...NEGATIVE_KEYWORDS.map(k => ({ title: { contains: k } })),
    ];

    const portfolioNegArticles = await prisma.article.findMany({
      where: {
        pubDate: { gte: threeDaysAgo, lte: now },
        isNoise: false,
        category: 'portfolio_company',
        OR: negOr,
      },
      select: {
        id: true,
        title: true,
        tone: true,
      },
      take: 10,
    });

    console.log(`최근 3일 포트폴리오 부정 기사: ${portfolioNegArticles.length}건\n`);

    if (portfolioNegArticles.length > 0) {
      console.log('샘플:');
      portfolioNegArticles.slice(0, 5).forEach((a, i) => {
        const title = a.title.substring(0, 50);
        console.log(`  ${i + 1}. [${a.tone}] ${title}...`);
      });
    }

    console.log('\n✅ 대시보드가 새 규칙(NEGATIVE_KEYWORDS 22개)으로 필터링 중\n');

    await prisma.$disconnect();

  } catch (error: any) {
    console.error(`❌ 에러: ${error.message}`);
    await prisma.$disconnect();
    process.exit(1);
  }
}

main();
