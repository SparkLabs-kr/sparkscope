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
      const value = match[2].trim().replace(/^"(.*)"$/, '$1');
      process.env[key] = value;
    }
  }
}

const prisma = new PrismaClient();
const NEGATIVE_KEYWORDS = ['논란', '고소', '사기', '철회', '무산', '구속', '적자', '유출', '사고'];

async function main() {
  // 임팩터스 기사 모두 조회
  const articles = await prisma.article.findMany({
    where: { matchedKeyword: { contains: '임팩터스' } },
    orderBy: { pubDate: 'desc' },
    take: 20,
  });

  console.log(`\n🔍 임팩터스 기사 분류 분석 (${articles.length}건)\n`);

  articles.forEach((a, i) => {
    const date = new Date(a.pubDate).toLocaleDateString('ko-KR');
    console.log(`${i + 1}. [${date}] ${a.title.substring(0, 80)}...`);
    console.log(`   현재 톤: ${a.tone || 'NULL'}`);

    // 부정 키워드 매칭 확인
    const matchedKeywords = NEGATIVE_KEYWORDS.filter(k => a.title.includes(k));
    if (matchedKeywords.length > 0) {
      console.log(`   ⚠️ 매칭된 부정 키워드: ${matchedKeywords.join(', ')}`);
    }

    // 긍정 키워드 확인
    const POSITIVE_KEYWORDS = ['투자 유치', '시리즈', '상장', '수상', '선정', 'MOU', '파트너십', '업무협약', '출시', '런칭', '흑자', '수출', '돌파', '체결', '협력'];
    const positiveMatches = POSITIVE_KEYWORDS.filter(k => a.title.includes(k));
    if (positiveMatches.length > 0) {
      console.log(`   ✅ 긍정 키워드: ${positiveMatches.join(', ')}`);
    }

    console.log(`   ID: ${a.id}\n`);
  });

  await prisma.$disconnect();
}

main().catch(console.error);
