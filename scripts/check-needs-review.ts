/**
 * 검토 대기 944건 중 샘플 100건 확인
 * (톤 변경 또는 새로 노이즈로 판정된 기사들)
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
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      process.env[key] = value;
    }
  }
}

const prisma = new PrismaClient();

async function checkReview() {
  try {
    console.log('\n📋 검토 대기 기사 샘플 (최초 100건)\n');

    // 최근 재분류된 기사들 (7/11 이후)
    const afterTime = new Date('2026-07-11T04:46:00Z');

    const samples = await prisma.article.findMany({
      where: {
        analyzedAt: { gte: afterTime },
      },
      select: {
        id: true,
        title: true,
        category: true,
        tone: true,
        isNoise: true,
      },
      take: 100,
      orderBy: { analyzedAt: 'desc' },
    });

    console.log(`조회된 샘플: ${samples.length}건\n`);
    console.log('| ID | 제목 | 카테고리 | 톤 | 노이즈 |');
    console.log('|-----|------|---------|-----|--------|');

    samples.slice(0, 10).forEach((s, i) => {
      const title = s.title.substring(0, 40);
      console.log(`| ${i+1} | ${title}... | ${s.category} | ${s.tone} | ${s.isNoise ? '✓' : '✗'} |`);
    });

    console.log(`\n... (총 ${samples.length}건, 처음 10건만 표시)\n`);
    console.log(`✅ 샘플 확인 OK → "응" 하면 나머지 944건 모두 DB 저장\n`);

    await prisma.$disconnect();

  } catch (error: any) {
    console.error('❌ 에러:', error.message);
    await prisma.$disconnect();
    process.exit(1);
  }
}

checkReview();
