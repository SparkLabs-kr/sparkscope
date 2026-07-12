/**
 * 검토 대기 944건 추출 → CSV 내보내기
 * 다시 분류해서 needs-review 항목들을 CSV로 저장
 *
 * 실행: npx tsx scripts/export-needs-review.ts
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

const logDir = path.join(process.cwd(), 'logs');
fs.mkdirSync(logDir, { recursive: true });
const csvFile = path.join(logDir, `needs-review-${new Date().toISOString().split('T')[0]}.csv`);

const log = (msg: string) => {
  console.log(msg);
};

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
  "noiseReason": "광고" | "중복" | "오탐" | null,
  "isPolitical": true | false,
  "hasNegativeKeyword": true | false
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
    log('\n🚀 검토 대기 944건 추출 시작\n');

    // [1] 기사 조회 (이미 저장된 것들 = 7/11 이후)
    log('[1/2] 분류된 기사 조회 중...');
    const afterTime = new Date('2026-07-10T09:30:00Z');
    const articles = await prisma.article.findMany({
      where: {
        analyzedAt: { gte: afterTime },
      },
      select: {
        id: true,
        title: true,
        link: true,
        source: true,
        category: true,
        tone: true,
        isNoise: true,
      },
      take: 26070,
      orderBy: { pubDate: 'desc' },
    });

    log(`분류된 기사: ${articles.length}건\n`);
    log('[2/2] needs-review 항목 추출\n');

    // [2] 검토 대기 항목 추출
    const needsReview: Array<{
      id: string;
      title: string;
      oldCategory: string;
      oldTone: string;
      oldIsNoise: boolean;
      newCategory: string;
      newTone: string;
      newIsNoise: boolean;
      reason: string;
    }> = [];

    const batchSize = 10;
    let totalProcessed = 0;

    for (let i = 0; i < articles.length; i += batchSize) {
      const batch = articles.slice(i, i + batchSize);

      const promises = batch.map(article =>
        classifyArticle(article)
          .then(result => ({ article, result, error: null }))
          .catch(error => ({ article, result: null, error }))
      );

      const results = await Promise.all(promises);

      for (const { article, result, error } of results) {
        totalProcessed++;

        if (error || !result) continue;

        // 위험 체크
        let reason = '';
        if (result.isNoise && !article.isNoise) {
          reason = '새로 노이즈';
        }
        if (result.tone === 'negative' && article.tone !== 'negative') {
          if (reason) reason += ' + 톤 부정 변경';
          else reason = '톤 부정 변경';
        }

        if (reason) {
          needsReview.push({
            id: article.id,
            title: article.title.substring(0, 60),
            oldCategory: article.category,
            oldTone: article.tone,
            oldIsNoise: article.isNoise,
            newCategory: result.category,
            newTone: result.tone,
            newIsNoise: result.isNoise,
            reason,
          });
        }
      }

      const progress = Math.round((totalProcessed / articles.length) * 100);
      log(`배치 처리: ${i + batchSize}/${articles.length} (${progress}%) | needs-review 누적: ${needsReview.length}건`);
    }

    // [3] CSV 저장
    log(`\n[3/3] CSV 저장 중...\n`);

    const csv = [
      'ID,제목,이전카테고리,이전톤,이전노이즈,새카테고리,새톤,새노이즈,사유',
      ...needsReview.map(r =>
        `${r.id},"${r.title}",${r.oldCategory},${r.oldTone},${r.oldIsNoise},${r.newCategory},${r.newTone},${r.newIsNoise},"${r.reason}"`
      ),
    ].join('\n');

    fs.writeFileSync(csvFile, csv, 'utf-8');

    log(`✅ 완료!\n`);
    log(`검토 대기: ${needsReview.length}건`);
    log(`CSV 파일: ${csvFile}\n`);

    await prisma.$disconnect();

  } catch (error: any) {
    log(`\n❌ 에러: ${error.message}`);
    await prisma.$disconnect();
    process.exit(1);
  }
}

main();
