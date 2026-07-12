/**
 * 재분류: data 폴더 CSV 파일 기준 (Claude 자유판정 NO)
 *
 * category: 파일 매칭으로만 결정
 * tone: tone-keywords.csv의 키워드+예외단어로 결정
 *
 * 샘플 5건 테스트 → OK면 전체 24,534건 진행
 */
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import csv from 'csv-parse/sync';

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

interface ToneKeywordRow {
  유형: string;
  키워드: string;
  tone: 'negative' | 'crisis' | 'positive' | 'neutral';
  예외단어: string;
}

interface CategoryRow {
  카테고리: string;
  '기업명(한글)': string;
  '기업명(영문)': string;
  primaryKeyword: string;
  status: string;
}

// tone-keywords.csv 로드
function loadToneKeywords(): ToneKeywordRow[] {
  const csvPath = path.join(process.cwd(), 'data', 'tone-keywords.csv');
  const content = fs.readFileSync(csvPath, 'utf-8');
  const records = csv.parse(content, {
    columns: true,
    skip_empty_lines: true,
    encoding: 'utf-8',
  }) as ToneKeywordRow[];
  return records;
}

// category 파일들 로드
function loadCategoryData(): Map<string, { category: string; status?: string }> {
  const map = new Map<string, { category: string; status?: string }>();
  const categoryFiles = [
    'sparklabs_self.csv',
    'portfolio_company.csv',
    'competitor.csv',
    'industry_trend.csv',
  ];

  for (const filename of categoryFiles) {
    const csvPath = path.join(process.cwd(), 'data', filename);
    if (!fs.existsSync(csvPath)) {
      console.warn(`⚠️  ${filename} 없음`);
      continue;
    }

    const content = fs.readFileSync(csvPath, 'utf-8');
    const records = csv.parse(content, {
      columns: true,
      skip_empty_lines: true,
      encoding: 'utf-8',
    }) as CategoryRow[];

    const category = records[0]?.카테고리 || filename.replace('.csv', '');

    for (const row of records) {
      const keyword = row.primaryKeyword?.trim();
      if (keyword) {
        map.set(keyword, { category, status: row.status });
      }
    }
  }

  return map;
}

// tone 판정
function determineTone(title: string, toneKeywords: ToneKeywordRow[]): 'negative' | 'crisis' | 'positive' | 'neutral' {
  // crisis > negative > positive > neutral
  let maxTone: 'negative' | 'crisis' | 'positive' | 'neutral' = 'neutral';

  for (const tk of toneKeywords) {
    const keyword = tk.키워드?.trim();
    if (!keyword || !title.includes(keyword)) continue;

    // 예외단어 확인
    const exceptionsStr = tk.예외단어?.trim() || '';
    const exceptions = exceptionsStr
      .split(',')
      .map(e => e.trim())
      .filter(e => e.length > 0);

    const hasException = exceptions.some(e => title.includes(e));
    if (hasException) continue;

    // tone 우선순위
    if (tk.tone === 'crisis') {
      maxTone = 'crisis';
    } else if (tk.tone === 'negative' && maxTone !== 'crisis') {
      maxTone = 'negative';
    } else if (tk.tone === 'positive' && maxTone === 'neutral') {
      maxTone = 'positive';
    }
  }

  return maxTone;
}

// 로그 파일
const logDir = path.join(process.cwd(), 'logs');
fs.mkdirSync(logDir, { recursive: true });
const logFile = path.join(logDir, 'reclassify-by-data-files.log');

const log = (msg: string) => {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${msg}`;
  console.log(line);
  fs.appendFileSync(logFile, line + '\n');
};

async function main() {
  try {
    log('\n🚀 재분류 시작: data 폴더 파일 기준\n');

    // [1] 데이터 로드
    log('[1/3] 데이터 로드 중...');
    const toneKeywords = loadToneKeywords();
    const categoryData = loadCategoryData();
    log(`  ✓ tone-keywords: ${toneKeywords.length}개`);
    log(`  ✓ category data: ${categoryData.size}개 회사\n`);

    // [2] 샘플 테스트 (5건)
    log('[2/3] 샘플 테스트 (5건)\n');

    const sampleArticles = await prisma.article.findMany({
      select: { id: true, title: true, matchedKeyword: true, category: true, tone: true },
      take: 5,
      orderBy: { pubDate: 'desc' },
    });

    let testPass = true;

    for (const article of sampleArticles) {
      const newCategory = categoryData.get(article.matchedKeyword)?.category || 'unrelated';
      const newTone = determineTone(article.title, toneKeywords);

      const catChanged = article.category !== newCategory;
      const toneChanged = article.tone !== newTone;

      log(`"${article.title.substring(0, 50)}..."`);
      log(`  키워드: ${article.matchedKeyword}`);
      log(`  category: ${article.category} → ${newCategory} ${catChanged ? '🔄' : '✓'}`);
      log(`  tone: ${article.tone} → ${newTone} ${toneChanged ? '🔄' : '✓'}`);

      // 임팩터스 "한국인적자원연구센터" 특수 체크
      if (article.matchedKeyword === 'impacters' && article.title.includes('한국인적자원')) {
        if (newTone === 'neutral') {
          log(`  ✓ [중요] 임팩터스 "적자" 오탐 방지 성공\n`);
        } else {
          log(`  ❌ [중요] 임팩터스 "적자" 오탐 방지 실패! tone=${newTone}\n`);
          testPass = false;
        }
      } else {
        log('');
      }
    }

    if (!testPass) {
      log('\n❌ 샘플 테스트 실패. 전체 진행 취소.\n');
      await prisma.$disconnect();
      process.exit(1);
    }

    log('✅ 샘플 테스트 성공!\n');

    // [3] 전체 재분류
    log('[3/3] 전체 24,534건 재분류 시작\n');

    const allArticles = await prisma.article.findMany({
      select: { id: true, title: true, matchedKeyword: true, category: true, tone: true },
      take: 24534,
      orderBy: { pubDate: 'desc' },
    });

    log(`전체 기사: ${allArticles.length}건\n`);

    let updated = 0;
    let unrelated = 0;
    const categoryCount = new Map<string, number>();
    const sparkLabsToneCount = new Map<string, number>();

    const batchSize = 100;
    for (let i = 0; i < allArticles.length; i += batchSize) {
      const batch = allArticles.slice(i, i + batchSize);

      for (const article of batch) {
        const newCategory = categoryData.get(article.matchedKeyword)?.category || 'unrelated';
        const newTone = determineTone(article.title, toneKeywords);

        // category 계산
        categoryCount.set(newCategory, (categoryCount.get(newCategory) || 0) + 1);

        // sparklabs_self tone 계산
        if (newCategory === 'sparklabs_self') {
          sparkLabsToneCount.set(newTone, (sparkLabsToneCount.get(newTone) || 0) + 1);
        }

        // unrelated 체크
        if (newCategory === 'unrelated') {
          unrelated++;
        }

        // 변경 필요하면 UPDATE
        if (article.category !== newCategory || article.tone !== newTone) {
          await prisma.article.update({
            where: { id: article.id },
            data: { category: newCategory, tone: newTone },
          });
          updated++;
        }
      }

      const progress = Math.round(((i + batchSize) / allArticles.length) * 100);
      log(`  진행: ${Math.min(i + batchSize, allArticles.length)}/${allArticles.length} (${progress}%)`);
    }

    // [4] 최종 통계
    log(`\n✅ 재분류 완료!\n`);
    log(`업데이트: ${updated}건`);
    log(`제외 (unrelated): ${unrelated}건\n`);

    log(`카테고리별 건수:`);
    for (const [cat, count] of categoryCount.entries()) {
      log(`  - ${cat}: ${count}건`);
    }

    log(`\n스파크랩 톤 분포:`);
    for (const [tone, count] of sparkLabsToneCount.entries()) {
      log(`  - ${tone}: ${count}건`);
    }

    log(`\n📊 로그: ${logFile}\n`);
    log(`다음: npm run dev → 대시보드 확인 → 배포\n`);

    await prisma.$disconnect();

  } catch (error: any) {
    log(`\n❌ 에러: ${error.message}`);
    await prisma.$disconnect();
    process.exit(1);
  }
}

main();
