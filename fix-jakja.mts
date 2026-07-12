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
  console.log('🔍 적자 오탐 감지 및 수정\n');

  // 1. tone-keywords.csv에서 "적자" 규칙의 예외단어 로드 (수동 파싱)
  const csvPath = path.join(process.cwd(), 'data', 'tone-keywords.csv');
  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = content.split('\n');
  
  let allExceptions = new Set();
  console.log('tone-keywords.csv의 "적자" 규칙:\n');
  
  for (const line of lines) {
    if (!line.includes('적자')) continue;
    
    const cols = line.split(',');
    const keyword = cols[1]?.trim();
    const tone = cols[2]?.trim();
    const exceptionStr = cols[3]?.trim().slice(1, -1) || ''; // 따옴표 제거
    
    if (keyword === '적자') {
      console.log(`  - 키워드: ${keyword}, 톤: ${tone}`);
      if (exceptionStr) {
        const exceptions = exceptionStr.split(',').map(e => e.trim()).filter(e => e.length > 0);
        console.log(`    예외단어: ${exceptions.join(', ')}`);
        exceptions.forEach(e => allExceptions.add(e));
      } else {
        console.log(`    예외단어: 없음`);
      }
    }
  }

  console.log(`\n예외단어 총 ${allExceptions.size}개: ${Array.from(allExceptions).join(', ')}\n`);

  // 2. tone=NEGATIVE인 기사 중 "적자"가 있는 기사 찾기
  const negativeWithJakja = await prisma.article.findMany({
    where: {
      tone: 'NEGATIVE',
      title: { contains: '적자' },
    },
    select: { id: true, title: true, matchedKeyword: true, category: true },
  });

  console.log(`1️⃣ 부정(NEGATIVE)으로 분류된 "적자" 포함 기사: ${negativeWithJakja.length}건\n`);

  // 3. 예외단어 포함 여부 확인
  const jakjaOversight = negativeWithJakja.filter(a => {
    return Array.from(allExceptions).some(ex => a.title.includes(ex));
  });

  console.log(`2️⃣ 그 중 예외단어 포함 (오탐): ${jakjaOversight.length}건\n`);

  if (jakjaOversight.length > 0) {
    console.log('오탐된 기사 샘플:');
    for (const a of jakjaOversight.slice(0, 5)) {
      console.log(`  - "${a.title.substring(0, 60)}..."`);
      console.log(`    키워드: ${a.matchedKeyword}, 카테고리: ${a.category}`);
    }
    if (jakjaOversight.length > 5) {
      console.log(`  ... 외 ${jakjaOversight.length - 5}건`);
    }

    console.log(`\n3️⃣ 수정 중... ${jakjaOversight.length}건의 tone을 NEGATIVE → NEUTRAL로 변경`);
    
    const ids = jakjaOversight.map(a => a.id);
    const result = await prisma.article.updateMany({
      where: { id: { in: ids } },
      data: { tone: 'NEUTRAL' },
    });
    
    console.log(`✅ 완료! ${result.count}건 수정됨\n`);
  }

  // 4. 한국인적자원 기사 특수 처리
  const koreanHRArticle = await prisma.article.findFirst({
    where: {
      title: { contains: '한국인적자원연구센터' },
    },
    select: { id: true, title: true, tone: true, matchedKeyword: true },
  });

  if (koreanHRArticle) {
    console.log(`4️⃣ 한국인적자원연구센터 기사 특수 처리:`);
    console.log(`  제목: "${koreanHRArticle.title.substring(0, 70)}..."`);
    console.log(`  현재 tone: ${koreanHRArticle.tone}`);
    
    if (koreanHRArticle.tone === 'NEUTRAL') {
      // 임팩터스 기사면 POSITIVE로
      if (koreanHRArticle.matchedKeyword === 'impacters') {
        console.log(`  → POSITIVE로 변경 (임팩터스 협력 뉴스)`);
        await prisma.article.update({
          where: { id: koreanHRArticle.id },
          data: { tone: 'POSITIVE' },
        });
      }
    }
  }

  // 5. 변경 후 전체 tone 분포
  const allTones = await prisma.article.groupBy({
    by: ['tone'],
    _count: { _all: true },
  });

  console.log(`\n📊 변경 후 전체 tone 분포:`);
  for (const t of allTones) {
    console.log(`  - ${t.tone}: ${t._count._all}건`);
  }

  // 포트폴리오 부정 기사
  const portfolioNeg = await prisma.article.count({
    where: {
      category: 'portfolio_company',
      tone: 'NEGATIVE',
    },
  });

  console.log(`\n포트폴리오사 부정 기사: ${portfolioNeg}건 (이전: 250건)`);

  await prisma.$disconnect();
}

main();