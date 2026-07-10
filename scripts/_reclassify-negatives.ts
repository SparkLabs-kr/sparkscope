/**
 * 배치 재분류: 부정으로 분류된 기사 재분석
 * 개선된 분류 규칙(협력·교육·파트너십 명백한 긍정 맥락 무시)을 적용.
 * 특히 임팩터스 같은 협력 뉴스가 올바르게 재분류되는지 확인.
 */
import fs from 'fs';
import path from 'path';
import { Anthropic } from '@anthropic-ai/sdk';
import { PrismaClient } from '@prisma/client';
import { buildSonnetDeepUserMessage, SONNET_DEEP_SYSTEM } from '@/lib/sparkscope/prompts';

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
const client = new Anthropic();

async function reclassifyNegatives() {
  console.log('\n🔄 배치 재분류 시작: 부정으로 분류된 기사\n');

  // 최근 10일 내 부정으로 분류된 기사
  const tenDaysAgo = new Date();
  tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);

  const negativeArticles = await prisma.article.findMany({
    where: {
      tone: 'NEGATIVE',
      pubDate: { gte: tenDaysAgo },
      isNoise: false,
    },
    orderBy: { pubDate: 'desc' },
    take: 50,
  });

  console.log(`📊 재분석 대상: ${negativeArticles.length}건\n`);

  if (negativeArticles.length === 0) {
    console.log('✅ 재분류할 기사가 없습니다.\n');
    await prisma.$disconnect();
    return;
  }

  // 포트폴리오 정보
  const portfolioTargets = await prisma.monitoringTarget.findMany({
    where: { category: 'portfolio_company', status: 'ACTIVE' },
    select: { name: true },
  });
  const portfolioUniverse = portfolioTargets.map(t => t.name);

  const trendTargets = await prisma.monitoringTarget.findMany({
    where: { category: 'industry_trend', status: 'ACTIVE' },
    select: { name: true },
  });
  const trendingTopics = trendTargets.map(t => t.name);

  let reclassified = 0;
  let unchanged = 0;

  for (const article of negativeArticles) {
    try {
      const prompt = buildSonnetDeepUserMessage(
        {
          id: article.id,
          title: article.title,
          source: article.source,
          matchedKeyword: article.matchedKeyword,
          category: article.category,
        },
        portfolioUniverse,
        trendingTopics,
      );

      const response = await client.messages.create({
        model: 'claude-sonnet-5',
        max_tokens: 500,
        system: SONNET_DEEP_SYSTEM,
        messages: [{ role: 'user', content: prompt }],
      });

      const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
      const result = JSON.parse(text);

      const newTone = result.tone || 'NEUTRAL';
      const oldTone = article.tone;

      // 톤이 변경되었으면 업데이트
      if (newTone !== oldTone) {
        await prisma.article.update({
          where: { id: article.id },
          data: {
            tone: newTone,
            oneLiner: result.oneLiner || article.oneLiner,
            ourTake: result.ourTake || article.ourTake,
            riskFlag: result.riskFlag || null,
          },
        });

        console.log(`✅ ${article.title.substring(0, 60)}...`);
        console.log(`   ${oldTone} → ${newTone}\n`);
        reclassified++;
      } else {
        unchanged++;
      }
    } catch (e: any) {
      console.error(`❌ ${article.title.substring(0, 60)}: ${e.message}`);
    }
  }

  console.log(`\n📈 재분류 완료:`);
  console.log(`   재분류됨: ${reclassified}건`);
  console.log(`   유지됨: ${unchanged}건\n`);

  // 임팩터스 확인
  const impacts = await prisma.article.findMany({
    where: { matchedKeyword: { contains: '임팩터스' }, pubDate: { gte: tenDaysAgo } },
    select: { title: true, tone: true, pubDate: true },
    orderBy: { pubDate: 'desc' },
  });

  console.log(`🎯 임팩터스 재분류 결과 (${impacts.length}건):`);
  impacts.slice(0, 5).forEach(a => {
    const date = new Date(a.pubDate).toLocaleDateString('ko-KR');
    console.log(`   [${date}] ${a.tone}: ${a.title.substring(0, 60)}...`);
  });
  console.log();

  await prisma.$disconnect();
}

reclassifyNegatives().catch(console.error);
