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
  console.log('🔎 같은 유형 오탐 전수 검색\n');

  let totalMarked = 0;

  // 유형별 검색 규칙
  const searchPatterns = [
    { type: '드라마 (담화컴퍼니)', keyword: '담화컴퍼니', titles: ['이재욱', '신예은', '닥터섬보이', '환혼', 'OST'] },
    { type: '온도 오탐', keyword: '온도', titles: ['DNA', '화학', '기온'] },
    { type: '정치', keyword: '부산', titles: ['시장', '선거', '당선', '의혹'] },
    { type: '학회/세미나', keyword: '엑스브레인', titles: ['ICML', '학회', '심포지엄'] },
    { type: '선교', keyword: '카머스', titles: ['선교', '미션'] },
  ];

  for (const pattern of searchPatterns) {
    console.log(`【 ${pattern.type} 】`);
    
    const articles = await prisma.article.findMany({
      where: {
        matchedKeyword: pattern.keyword,
        isNoise: false,
        OR: pattern.titles.map(t => ({ title: { contains: t } })),
      },
      select: { id: true, title: true, isNoise: true },
      take: 20,
    });

    if (articles.length > 0) {
      console.log(`  ${articles.length}건 발견\n`);
      
      for (const a of articles.slice(0, 3)) {
        console.log(`  - "${a.title.substring(0, 60)}..."`);
      }
      if (articles.length > 3) {
        console.log(`  ... 외 ${articles.length - 3}건`);
      }

      // 모두 isNoise 마킹
      const result = await prisma.article.updateMany({
        where: {
          matchedKeyword: pattern.keyword,
          OR: pattern.titles.map(t => ({ title: { contains: t } })),
          isNoise: false,
        },
        data: { isNoise: true, noiseReason: '오탐' },
      });

      console.log(`  ✅ ${result.count}건 마킹\n`);
      totalMarked += result.count;
    } else {
      console.log(`  추가 없음\n`);
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`\n📊 최종 결과`);
  console.log(`\n초기 10건: 8건 마킹`);
  console.log(`추가 오탐: ${totalMarked}건 마킹`);
  console.log(`\n총 ${8 + totalMarked}건 노이즈 처리 완료\n`);

  await prisma.$disconnect();
}

main();