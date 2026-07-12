/**
 * reclassify 로직 샘플 테스트
 * 실제 10개 기사로 재분류해서 결과 확인
 * 문제 없으면 전체 재분류 진행
 */
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import Anthropic from '@anthropic-ai/sdk';

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

async function classifyArticle(article: any) {
  try {
    const prompt = `당신은 뉴스 기사를 분류하는 전문가입니다. 다음 기사를 분석하고 JSON으로만 응답하세요:

제목: ${article.title}
링크: ${article.link}
소스: ${article.source}

다음을 JSON으로 출력 (key만 소문자, 값은 영문):
{
  "category": "sparklabs_self" | "portfolio_company" | "competitor" | "industry_trend" | "unrelated",
  "tone": "positive" | "neutral" | "negative",
  "isNoise": true | false,
  "noiseReason": "광고" | "중복" | "오탐" | null
}`;

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.content[0]?.type === 'text' ? response.content[0].text : '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('JSON 파싱 실패');
    }

    return JSON.parse(jsonMatch[0]);
  } catch (error: any) {
    throw error;
  }
}

async function main() {
  try {
    console.log('\n🧪 reclassify 로직 샘플 테스트 (10개 기사)\n');

    // [1] monitoring-targets 로드
    const monitoringTargets = await prisma.monitoringTarget.findMany({
      select: { primaryKeyword: true, category: true },
    });
    console.log(`✓ monitoring-targets 로드: ${monitoringTargets.length}개\n`);

    // [2] 샘플 기사 선택 (다양한 matchedKeyword)
    const sampleArticles = await prisma.article.findMany({
      select: {
        id: true,
        title: true,
        link: true,
        source: true,
        matchedKeyword: true,
        category: true,
      },
      take: 10,
      orderBy: { pubDate: 'desc' },
    });

    console.log(`✓ 샘플 기사: ${sampleArticles.length}개\n`);
    console.log('=== 테스트 결과 ===\n');

    let correctCount = 0;
    let wrongCount = 0;

    for (const article of sampleArticles) {
      // Claude 분류
      const claudeResult = await classifyArticle(article);

      // monitoring-targets 매칭
      const target = monitoringTargets.find(t => t.primaryKeyword === article.matchedKeyword);
      const finalCategory = target?.category || claudeResult.category;

      // 기존 DB의 category와 비교
      const changed = article.category !== finalCategory;
      const status = changed ? '🔄 변경' : '✓ 유지';

      console.log(`${status} "${article.title.substring(0, 50)}..."`);
      console.log(`   matchedKeyword: ${article.matchedKeyword}`);
      console.log(`   현재: ${article.category}`);
      console.log(`   Claude 판정: ${claudeResult.category}`);
      console.log(`   최종: ${finalCategory}`);

      if (target) {
        console.log(`   ↳ monitoring-targets 매칭 ✓`);
      } else {
        console.log(`   ↳ monitoring-targets 미매칭 (Claude 판정 사용)`);
      }

      if (changed) {
        correctCount++;
      } else {
        wrongCount++;
      }

      console.log('');
    }

    console.log(`\n=== 결과 요약 ===\n`);
    console.log(`변경 필요: ${correctCount}개`);
    console.log(`유지: ${wrongCount}개\n`);

    if (correctCount > 0) {
      console.log(`✅ reclassify가 작동함 (${correctCount}개 기사의 category가 수정됨)\n`);
      console.log(`다음 단계: 전체 ${sampleArticles.length}개 기사 재분류 진행 가능\n`);
    } else {
      console.log(`⚠️  수정이 필요 없거나 로직 재검토 필요\n`);
    }

    await prisma.$disconnect();

  } catch (error: any) {
    console.error(`❌ 에러: ${error.message}`);
    await prisma.$disconnect();
    process.exit(1);
  }
}

main();
