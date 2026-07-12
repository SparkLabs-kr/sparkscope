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
  console.log('🔧 모니터링 키워드 제외어 추가\n');

  const updates = [
    {
      primaryKeyword: '온도',
      excludeWords: 'DNA,화학,기온,실험',
      reason: 'DNA합성 기사 오탐 방지',
    },
    {
      primaryKeyword: '담화컴퍼니',
      excludeWords: '드라마,배우,OST,닥터섬보이,환혼,신예은,이재욱',
      reason: '드라마 관련 오탐 방지',
    },
    {
      primaryKeyword: '부산',
      excludeWords: '정치,시장,선거,당선,의혹',
      reason: '정치 기사 오탐 방지',
    },
    {
      primaryKeyword: '카머스',
      excludeWords: '선교,미션,종교',
      reason: '선교 관련 오탐 방지',
    },
    {
      primaryKeyword: '엑스브레인',
      excludeWords: '학회,심포지엄,ICML,컨퍼런스',
      reason: '학회 관련 오탐 방지',
    },
  ];

  for (const update of updates) {
    const target = await prisma.monitoringTarget.findFirst({
      where: { primaryKeyword: update.primaryKeyword },
    });

    if (target) {
      const currentExcludes = target.excludeWords ? target.excludeWords.split(',') : [];
      const newExcludes = update.excludeWords.split(',');
      const merged = Array.from(new Set([...currentExcludes, ...newExcludes]));
      
      await prisma.monitoringTarget.update({
        where: { id: target.id },
        data: { excludeWords: merged.join(',') },
      });

      console.log(`✅ "${update.primaryKeyword}"`);
      console.log(`   제외어 추가: ${newExcludes.join(', ')}\n`);
    }
  }

  console.log('완료!\n');

  await prisma.$disconnect();
}

main();