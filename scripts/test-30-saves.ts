/**
 * 30건 재분류 테스트 (저장 검증용)
 * 배치마다 즉시 저장, 저장 건수 실시간 로그
 */
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import Anthropic from '@anthropic-ai/sdk';

// .env.local 수동 로드
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
const client = new Anthropic();

async function classify(article: any) {
  try {
    const prompt = `뉴스 기사를 분류하세요. JSON만:
제목: ${article.title}
{
  "category": "sparklabs_self" | "portfolio_company" | "competitor" | "industry_trend" | "unrelated",
  "tone": "positive" | "neutral" | "negative",
  "isNoise": boolean,
  "noiseReason": null
}`;

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 100,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('JSON 파싱 실패');
    return JSON.parse(match[0]);
  } catch (e: any) {
    throw e;
  }
}

async function main() {
  console.log('\n🔬 30건 저장 검증 테스트\n');

  try {
    // Before
    const beforeCount = await prisma.article.count({
      where: { analyzedAt: { gte: new Date('2026-07-10T09:30:00Z') } },
    });
    console.log(`[Before] 09:30 이후 저장된 기사: ${beforeCount}건\n`);

    // 30건 조회
    const articles = await prisma.article.findMany({
      select: { id: true, title: true, link: true },
      take: 30,
    });

    console.log(`[조회] ${articles.length}건\n`);

    // 배치 분류 & 저장
    let saved = 0;
    for (let i = 0; i < articles.length; i += 10) {
      const batch = articles.slice(i, i + 10);
      const start = Date.now();

      // 분류
      const results = await Promise.all(
        batch.map(a =>
          classify(a)
            .then(r => ({ article: a, result: r, error: null }))
            .catch(e => ({ article: a, result: null, error: e }))
        )
      );

      // 즉시 저장
      for (const { article, result, error } of results) {
        if (error) {
          console.log(`  ❌ ${article.id.slice(0, 8)}: ${error.message}`);
          continue;
        }
        try {
          await prisma.article.update({
            where: { id: article.id },
            data: {
              category: result.category,
              tone: result.tone,
              isNoise: result.isNoise,
              noiseReason: null,
              analyzedAt: new Date(),
            },
          });
          saved++;
          console.log(`  ✅ ${article.id.slice(0, 8)}: 저장됨 (누적: ${saved})`);
        } catch (e: any) {
          console.log(`  ❌ ${article.id.slice(0, 8)}: 저장 실패 - ${e.message}`);
        }
      }

      console.log(`[배치 ${i / 10 + 1}] 완료 (${batch.length}건, ${Date.now() - start}ms, 누적 저장: ${saved}\n`);
    }

    // After
    const afterCount = await prisma.article.count({
      where: { analyzedAt: { gte: new Date('2026-07-10T09:30:00Z') } },
    });

    console.log(`\n[결과]\n`);
    console.log(`조회: 30건`);
    console.log(`저장: ${saved}건`);
    console.log(`저장 증가: ${afterCount - beforeCount}건`);

    if (saved === 30 && (afterCount - beforeCount) >= 30) {
      console.log(`\n✅ 저장 검증 성공! DB에 실제 저장됨.\n`);
      console.log(`다음: 전체 26,070건 실행 가능`);
    } else {
      console.log(`\n⚠️  저장 미흡 - 원인 조사 필요`);
    }

    await prisma.$disconnect();

  } catch (error: any) {
    console.error(`\n❌ 에러:`, error.message);
    await prisma.$disconnect();
    process.exit(1);
  }
}

main();
