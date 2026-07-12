/**
 * 배치마다 즉시 DB 저장 (Incremental Save)
 * 중간에 끊겨도 저장된 것은 남음
 *
 * 실행: npx tsx scripts/reclassify-incremental.ts [--limit N]
 * 예: npx tsx scripts/reclassify-incremental.ts --limit 30
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

// 옵션 (전체 26,070건)
const limit = 26070;

// monitoring-targets 로드
let monitoringTargets: any[] = [];
const loadMonitoringTargets = async () => {
  monitoringTargets = await prisma.monitoringTarget.findMany({
    select: { primaryKeyword: true, category: true },
  });
};

// 로그 파일
const logDir = path.join(process.cwd(), 'logs');
fs.mkdirSync(logDir, { recursive: true });
const logFile = path.join(logDir, `reclassify-incremental-${new Date().toISOString().split('T')[0]}.log`);

let totalProcessed = 0;
let totalUpdated = 0;
let totalErrors = 0;
let totalSkipped = 0;

const log = (msg: string) => {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${msg}`;
  console.log(line);
  fs.appendFileSync(logFile, line + '\n');
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
    log('\n🚀 재분류 시작 (배치마다 즉시 저장)\n');
    log(`제한: ${limit}건`);
    log(`배치 크기: 10개\n`);

    // [0] monitoring-targets 로드
    log('[0/3] monitoring-targets 로드 중...');
    await loadMonitoringTargets();
    log(`로드됨: ${monitoringTargets.length}개 회사\n`);

    // [1] 기사 조회 (이미 저장된 것 제외)
    log('[1/3] 미처리 기사 조회 중...');
    const afterTime = new Date('2026-07-10T09:30:00Z');
    const articles = await prisma.article.findMany({
      where: {
        OR: [
          { analyzedAt: null },
          { analyzedAt: { lt: afterTime } },
        ],
      },
      select: {
        id: true,
        title: true,
        link: true,
        source: true,
        matchedKeyword: true,
        category: true,
        tone: true,
        isNoise: true,
      },
      take: limit,
      orderBy: { pubDate: 'desc' },
    });

    log(`미처리 조회됨: ${articles.length}건\n`);
    log('[2/3] 배치 분류 & 즉시 저장\n');

    // [2] 배치마다 분류 → 즉시 저장
    const batchSize = 10;
    for (let i = 0; i < articles.length; i += batchSize) {
      const batch = articles.slice(i, i + batchSize);
      const batchStart = Date.now();

      // 배치 분류
      const promises = batch.map(article =>
        classifyArticle(article)
          .then(result => ({ article, result, error: null }))
          .catch(error => ({ article, result: null, error }))
      );

      const results = await Promise.all(promises);

      // 배치 즉시 저장
      let batchUpdated = 0;
      for (const { article, result, error } of results) {
        totalProcessed++;

        if (error) {
          log(`  ❌ ${article.id.slice(0, 8)}: ${error.message}`);
          totalErrors++;
          continue;
        }

        // 위험 체크
        let skip = false;
        if (result.isNoise && !article.isNoise) {
          log(`  ⏭️  ${article.id.slice(0, 8)}: needs-review (새로 노이즈)`);
          skip = true;
        }
        if (result.tone === 'negative' && article.tone !== 'negative') {
          log(`  ⏭️  ${article.id.slice(0, 8)}: needs-review (톤 부정 변경)`);
          skip = true;
        }

        if (skip) {
          totalSkipped++;
          continue;
        }

        // 즉시 저장
        try {
          // monitoring-targets과 매칭해서 category 확정
          const target = monitoringTargets.find(t => t.primaryKeyword === article.matchedKeyword);
          const finalCategory = target?.category || result.category;

          await prisma.article.update({
            where: { id: article.id },
            data: {
              category: finalCategory,
              tone: result.tone,
              isNoise: result.isNoise,
              noiseReason: result.noiseReason,
              analyzedAt: new Date(),
            },
          });
          batchUpdated++;
          totalUpdated++;
        } catch (e: any) {
          log(`  ❌ 저장 실패 ${article.id.slice(0, 8)}: ${e.message}`);
          totalErrors++;
        }
      }

      // 배치 완료 로그
      const elapsed = Math.round((Date.now() - batchStart) / 1000);
      const progress = Math.round((totalProcessed / articles.length) * 100);
      log(`배치 완료: ${i + 1}-${Math.min(i + batchSize, articles.length)} (저장 ${batchUpdated}건, ${elapsed}초) | 전체: ${totalProcessed}/${articles.length} (${progress}%) | 누적 저장: ${totalUpdated}`);
    }

    // [3] 최종 통계
    log(`\n[3/3] 최종 통계\n`);
    log(`✅ 완료!\n`);
    log(`총 처리: ${totalProcessed}건`);
    log(`저장 완료: ${totalUpdated}건`);
    log(`검토 대기: ${totalSkipped}건`);
    log(`에러: ${totalErrors}건`);
    log(`로그: ${logFile}\n`);

    await prisma.$disconnect();

  } catch (error: any) {
    log(`\n❌ 심각한 에러: ${error.message}`);
    await prisma.$disconnect();
    process.exit(1);
  }
}

main();
