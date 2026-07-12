/**
 * 월요일 9시 발송을 위한 데이터 준비 상태 확인
 * skipCollect 모드에서 사용할 데이터(최근 3일, 분석 완료)가 충분한지 검증
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

async function checkDataReadiness() {
  console.log('\n📊 월요일 발송 데이터 준비 상태\n');

  try {
    // KST 기준 3일 전
    const kstNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
    const threeDaysAgo = new Date(kstNow.getTime() - 3 * 24 * 60 * 60 * 1000);

    console.log(`기준: KST ${kstNow.toISOString().split('T')[0]} (3일 내 분석 데이터)`);
    console.log(`범위: ${threeDaysAgo.toISOString().split('T')[0]} ~ ${kstNow.toISOString().split('T')[0]}\n`);

    // skipCollect가 사용할 데이터
    const readyData = await prisma.article.findMany({
      where: {
        pubDate: { gte: threeDaysAgo },
        isNoise: false,
        category: { not: 'unrelated' },
        analyzedAt: { not: null },
      },
      select: {
        id: true,
        title: true,
        category: true,
        tone: true,
        analyzedAt: true,
      },
      take: 500,
    });

    console.log(`✅ skipCollect 데이터: ${readyData.length}건\n`);

    // 카테고리별 분포
    const byCat = {
      sparklabs_self: readyData.filter(a => a.category === 'sparklabs_self').length,
      portfolio_company: readyData.filter(a => a.category === 'portfolio_company').length,
      competitor: readyData.filter(a => a.category === 'competitor').length,
      industry_trend: readyData.filter(a => a.category === 'industry_trend').length,
    };

    console.log('카테고리 분포:');
    Object.entries(byCat).forEach(([cat, count]) => {
      console.log(`  ${cat}: ${count}건`);
    });

    // 톤 분포
    const byTone = {
      positive: readyData.filter(a => a.tone === 'positive').length,
      neutral: readyData.filter(a => a.tone === 'neutral').length,
      negative: readyData.filter(a => a.tone === 'negative').length,
    };

    console.log('\n톤 분포:');
    Object.entries(byTone).forEach(([tone, count]) => {
      console.log(`  ${tone}: ${count}건`);
    });

    // 분석 완료도
    const analyzed = readyData.filter(a => a.analyzedAt).length;
    const analysisRate = readyData.length > 0 ? ((analyzed / readyData.length) * 100).toFixed(1) : '0';
    console.log(`\n분석 완료도: ${analyzed}/${readyData.length} (${analysisRate}%)`);

    // 최신 분석
    const latest = await prisma.article.findFirst({
      where: {
        analyzedAt: { not: null },
      },
      orderBy: { analyzedAt: 'desc' },
      select: { title: true, analyzedAt: true },
    });

    if (latest) {
      const analyzedTime = new Date(latest.analyzedAt!);
      const hoursSince = Math.floor((kstNow.getTime() - analyzedTime.getTime()) / (1000 * 60 * 60));
      console.log(`\n최신 분석: ${hoursSince}시간 전`);
      console.log(`  "${latest.title.slice(0, 60)}..."`);
    }

    if (readyData.length < 50) {
      console.log('\n⚠️  주의: 데이터가 부족하면 발송이 매우 작을 수 있습니다.');
    } else {
      console.log('\n✅ 월요일 9시 발송 준비 완료');
    }

    await prisma.$disconnect();

  } catch (error: any) {
    console.error('\n❌ 에러:', error.message);
    await prisma.$disconnect();
    process.exit(1);
  }
}

checkDataReadiness();
