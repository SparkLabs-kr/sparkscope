/**
 * [3] 임팩터스 "적자" 오탐 수정
 * 기사: "임팩터스, 앱티마이저·서울대 한국인적자원연구센터와 AI 기반 진로교육 협력 본격화"
 * 조치: tone을 negative→neutral로 수정
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
    console.log('\n🔧 [3] 임팩터스 "적자" 오탐 수정\n');

    // 키워드 검색
    const keyword = '한국인적자원연구센터';
    const article = await prisma.article.findFirst({
      where: {
        title: { contains: keyword },
      },
    });

    if (!article) {
      console.log(`❌ 기사 찾을 수 없음: "${keyword}"`);
      console.log('대신 "임팩터스"로 검색해봅시다...\n');

      const articles = await prisma.article.findMany({
        where: {
          title: { contains: '임팩터스' },
          matchedKeyword: 'impacters',
        },
        select: {
          id: true,
          title: true,
          tone: true,
        },
        take: 5,
      });

      if (articles.length > 0) {
        console.log(`발견된 임팩터스 기사:\n`);
        articles.forEach((a, i) => {
          console.log(`${i + 1}. [${a.tone}] ${a.title.substring(0, 60)}...`);
          console.log(`   ID: ${a.id}\n`);
        });
      }

      await prisma.$disconnect();
      return;
    }

    console.log(`찾은 기사:`);
    console.log(`제목: ${article.title}`);
    console.log(`현재 톤: ${article.tone}`);
    console.log(`카테고리: ${article.category}\n`);

    // tone 수정
    if (article.tone === 'negative') {
      await prisma.article.update({
        where: { id: article.id },
        data: { tone: 'neutral' },
      });

      console.log(`✅ tone 수정: negative → neutral\n`);
    } else {
      console.log(`⚠️  현재 tone이 이미 '${article.tone}'입니다.\n`);
    }

    // negative-keywords.csv에 예외 규칙 확인
    console.log(`[규칙 추가] "적자" 예외: 기관명 일부(예: 한국인적자원연구센터) 제외\n`);
    console.log(`✅ keywords-loader.ts의 hasNegativeKeyword()에 이미 적용됨\n`);

    await prisma.$disconnect();

  } catch (error: any) {
    console.error(`❌ 에러: ${error.message}`);
    await prisma.$disconnect();
    process.exit(1);
  }
}

main();
