/**
 * sparklabs_self 부정 기사 확인
 * - tone='NEGATIVE'인지?
 * - 부정 키워드 포함인지?
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
    console.log('\n📊 sparklabs_self 부정 기사 분석\n');

    // [1] 톤 분석
    console.log('[1] 톤 분포:\n');
    const toneGroups = await prisma.article.groupBy({
      by: ['tone'],
      where: { category: 'sparklabs_self' },
      _count: true,
    });

    toneGroups.forEach(t => {
      console.log(`  ${t.tone}: ${t._count}건`);
    });

    // [2] 부정 기사 (tone='NEGATIVE')
    console.log('\n[2] tone=NEGATIVE 기사:\n');
    const negTone = await prisma.article.count({
      where: { category: 'sparklabs_self', tone: 'NEGATIVE' },
    });
    console.log(`  건수: ${negTone}건\n`);

    if (negTone > 0) {
      const samples = await prisma.article.findMany({
        where: { category: 'sparklabs_self', tone: 'NEGATIVE' },
        select: { id: true, title: true, tone: true },
        take: 5,
      });
      console.log(`  샘플 (최근 5건):`);
      samples.forEach((a, i) => {
        console.log(`    ${i + 1}. [${a.tone}] ${a.title.substring(0, 60)}...`);
      });
    }

    // [3] 부정 키워드 포함
    console.log(`\n[3] 부정 키워드(${NEGATIVE_KEYWORDS.length}개) 포함 기사:\n`);

    const allSparkLabs = await prisma.article.findMany({
      where: { category: 'sparklabs_self' },
      select: { id: true, title: true, tone: true },
      take: 10000,
    });

    let negKeywordCount = 0;
    const negKeywordArticles = [];

    for (const a of allSparkLabs) {
      const hasNegKeyword = NEGATIVE_KEYWORDS.some(k => {
        if (k === '적자') {
          // 기관명 예외 처리
          if (a.title.match(/\w+인적자\w+/)) return false;
        }
        return a.title.includes(k);
      });

      if (hasNegKeyword) {
        negKeywordCount++;
        if (negKeywordArticles.length < 5) {
          negKeywordArticles.push(a);
        }
      }
    }

    console.log(`  건수: ${negKeywordCount}건\n`);

    if (negKeywordArticles.length > 0) {
      console.log(`  샘플 (최근 5건):`);
      negKeywordArticles.forEach((a, i) => {
        const matchedKeywords = NEGATIVE_KEYWORDS.filter(k => {
          if (k === '적자' && a.title.match(/\w+인적자\w+/)) return false;
          return a.title.includes(k);
        });
        console.log(`    ${i + 1}. [${a.tone}] ${a.title.substring(0, 50)}...`);
        console.log(`       매칭 키워드: ${matchedKeywords.join(', ')}`);
      });
    }

    // [4] 결론
    console.log(`\n[4] 결론:\n`);

    const totalSparkLabs = await prisma.article.count({
      where: { category: 'sparklabs_self' },
    });

    console.log(`  전체: ${totalSparkLabs}건`);
    console.log(`  tone=NEGATIVE: ${negTone}건 (${((negTone / totalSparkLabs) * 100).toFixed(1)}%)`);
    console.log(`  부정 키워드 포함: ${negKeywordCount}건 (${((negKeywordCount / totalSparkLabs) * 100).toFixed(1)}%)`);

    if (negTone === 0 && negKeywordCount === 0) {
      console.log(`\n  ✅ 부정 기사 없음 (대시보드 표시 "부정 0"이 정확함)\n`);
    } else if (negTone === 0 && negKeywordCount > 0) {
      console.log(`\n  ⚠️  부정 키워드는 있는데 tone=NEGATIVE로 판정 안 됨`);
      console.log(`     → 해당 기사들의 tone을 'NEGATIVE'로 수정 필요\n`);
    }

    await prisma.$disconnect();

  } catch (error: any) {
    console.error(`❌ 에러: ${error.message}`);
    await prisma.$disconnect();
    process.exit(1);
  }
}

main();
