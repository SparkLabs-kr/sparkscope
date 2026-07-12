/**
 * 전체 26,070건 재분류 (일반 API, Haiku 1차분류만)
 * 병렬 처리로 최대한 빠르게, 로컬 백그라운드 실행
 *
 * 실행: npx tsx scripts/reclassify-all-api.ts
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

// 로그 파일
const logDir = path.join(process.cwd(), 'logs');
fs.mkdirSync(logDir, { recursive: true });
const logFile = path.join(logDir, `reclassify-all-${new Date().toISOString().split('T')[0]}.log`);
const reviewFile = path.join(logDir, `needs-review-${new Date().toISOString().split('T')[0]}.csv`);

let totalProcessed = 0;
let totalUpdated = 0;
let totalErrors = 0;
let needsReview: Array<{ id: string; reason: string; oldCat: string; newCat: string }> = [];

const log = (msg: string) => {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${msg}`;
  console.log(line);
  fs.appendFileSync(logFile, line + '\n');
};

async function reclassifyArticle(article: any) {
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

    const result = JSON.parse(jsonMatch[0]);
    return result;
  } catch (error: any) {
    throw new Error(`Haiku 분류 실패: ${error.message}`);
  }
}

async function processInParallel(articles: any[], concurrency: number) {
  const results: any[] = [];

  for (let i = 0; i < articles.length; i += concurrency) {
    const batch = articles.slice(i, i + concurrency);
    const promises = batch.map(article =>
      reclassifyArticle(article)
        .then(result => ({ article, result, error: null }))
        .catch(error => ({ article, result: null, error }))
    );

    const batchResults = await Promise.all(promises);
    results.push(...batchResults);

    totalProcessed += batch.length;
    if (totalProcessed % 100 === 0) {
      log(`진행: ${totalProcessed}/${articles.length} (${Math.round((totalProcessed / articles.length) * 100)}%)`);
    }
  }

  return results;
}

async function main() {
  try {
    log('\n🚀 전체 26,070건 API 재분류 시작\n');
    log('설정: Haiku 1차분류, 병렬 10개');

    // [1] 전체 기사 조회
    log('\n[1/3] 전체 기사 조회 중...');
    const articles = await prisma.article.findMany({
      select: {
        id: true,
        title: true,
        link: true,
        source: true,
        category: true,
        tone: true,
      },
      orderBy: { pubDate: 'desc' },
    });

    log(`조회됨: ${articles.length}건\n`);

    // [2] 병렬 분류
    log('[2/3] Haiku 병렬 분류 중 (10개 동시)...');
    const startTime = Date.now();
    const results = await processInParallel(articles, 10);

    log(`분류 완료: ${totalProcessed}/${articles.length}`);

    // [3] DB 저장 + 위험 체크
    log('\n[3/3] DB 저장 중...');

    for (const { article, result, error } of results) {
      if (error) {
        log(`❌ ${article.id}: ${error.message}`);
        totalErrors++;
        continue;
      }

      try {
        // 위험 체크
        let reason = '';
        if (result.isNoise && !article.isNoise) {
          reason = '새로 노이즈로 판정';
        }
        if (result.tone === 'negative' && article.tone !== 'negative') {
          reason = '톤이 부정으로 변경';
        }
        if (result.category !== article.category) {
          reason = `카테고리 변경: ${article.category} → ${result.category}`;
        }

        if (reason) {
          needsReview.push({
            id: article.id,
            reason,
            oldCat: article.category,
            newCat: result.category,
          });
          log(`⚠️  ${article.id}: needs-review (${reason})`);
          continue;
        }

        // 안전한 업데이트만 수행
        await prisma.article.update({
          where: { id: article.id },
          data: {
            category: result.category,
            tone: result.tone,
            isNoise: result.isNoise,
            noiseReason: result.noiseReason,
            analyzedAt: new Date(),
          },
        });

        totalUpdated++;
      } catch (e: any) {
        log(`❌ DB 저장 실패 ${article.id}: ${e.message}`);
        totalErrors++;
      }
    }

    // [4] 검토 대기 CSV 저장
    if (needsReview.length > 0) {
      const csv = [
        'ID,이유,이전카테고리,새카테고리',
        ...needsReview.map(r => `${r.id},"${r.reason}",${r.oldCat},${r.newCat}`),
      ].join('\n');
      fs.writeFileSync(reviewFile, csv, 'utf-8');
      log(`\n검토 대기 저장: ${reviewFile}`);
    }

    // [5] 최종 통계
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    log(`\n✅ 완료!\n`);
    log(`소요시간: ${elapsed}초`);
    log(`처리: ${totalProcessed}건`);
    log(`업데이트: ${totalUpdated}건`);
    log(`검토 대기: ${needsReview.length}건`);
    log(`에러: ${totalErrors}건`);
    log(`로그: ${logFile}`);

    await prisma.$disconnect();

  } catch (error: any) {
    log(`\n❌ 심각한 에러: ${error.message}`);
    await prisma.$disconnect();
    process.exit(1);
  }
}

main();
