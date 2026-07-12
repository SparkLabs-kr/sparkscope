/**
 * 현재 시스템의 모니터링 대상 + 부정/위기 키워드를 CSV로 export
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

async function exportKeywords() {
  try {
    console.log('\n📊 시스템 키워드 데이터 Export\n');

    // [1] 모니터링 대상 (MonitoringTarget)
    console.log('[1/2] 모니터링 대상 조회 중...');
    const targets = await prisma.monitoringTarget.findMany({
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });

    console.log(`  조회됨: ${targets.length}건\n`);

    // CSV 헤더
    const headers = [
      '카테고리',
      '기업명(한글)',
      '기업명(영문)',
      'primaryKeyword',
      'helperKeywords',
      'excludeWords',
      'mustIncludeAny',
      'businessContext',
      'tier',
      'status',
    ];

    // CSV 데이터
    const rows = targets.map(t => [
      t.category || '',
      t.name || '',
      t.nameEn || '',
      t.primaryKeyword || '',
      Array.isArray(t.helperKeywords) ? t.helperKeywords.join('; ') : '',
      Array.isArray(t.excludeWords) ? t.excludeWords.join('; ') : '',
      Array.isArray(t.mustIncludeAny) ? t.mustIncludeAny.join('; ') : '',
      t.businessContext || '',
      t.tier || '',
      t.status || '',
    ]);

    // CSV 문자열 생성
    const csv = [
      headers.join(','),
      ...rows.map(row => row.map(cell => {
        const s = String(cell);
        return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
      }).join(',')),
    ].join('\n');

    // 파일 저장
    const csvPath = path.join(process.cwd(), 'data', 'monitoring-targets.csv');
    fs.mkdirSync(path.dirname(csvPath), { recursive: true });
    fs.writeFileSync(csvPath, csv, 'utf-8');

    // 카테고리별 통계
    const byCat = targets.reduce((acc, t) => {
      acc[t.category] = (acc[t.category] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    console.log('📈 카테고리별 개수:');
    Object.entries(byCat).forEach(([cat, count]) => {
      console.log(`  ${cat}: ${count}건`);
    });
    console.log(`  총합: ${targets.length}건\n`);

    console.log(`✅ 저장됨: ${csvPath}\n`);

    // [2] 부정/위기 키워드 (코드에서 추출)
    console.log('[2/2] 부정/위기 키워드 추출 중...\n');

    // 부정 키워드 (relevance.ts에서)
    const negativeKeywords = {
      '부도/파산': ['파산', '도산', '부도'],
      '손실/손해': ['손실', '손해', '적자', '적손'],
      '분쟁/고소': ['소송', '고소', '분쟁', '논란'],
      '위반/적발': ['위반', '적발', '적발됨', '뜻밖의'],
      '감소/하락': ['감소', '하락', '급락', '급감'],
      '부정적 평가': ['비판', '평가절하', '낮은평가'],
    };

    // 위기 키워드 (runner.ts 참조)
    const crisisKeywords = {
      '규제위험': ['제제', '조사', '규제', '처벌', '행정지도'],
      '법적분쟁': ['고소', '소송', '법적', '계약분쟁'],
      '시장위험': ['시장축소', '수요감소', '경쟁심화'],
      '운영위험': ['인사', '이탈', '경영진교체'],
      '재무위험': ['적자', '손실', '유동성부족'],
    };

    const allNegKeywords = Object.entries(negativeKeywords).flatMap(([cat, words]) =>
      words.map(w => [cat, w])
    );

    const allCrisisKeywords = Object.entries(crisisKeywords).flatMap(([cat, words]) =>
      words.map(w => [cat, w])
    );

    // 부정 키워드 CSV
    const negCsv = [
      '유형,키워드',
      ...allNegKeywords.map(([cat, word]) =>
        `"${cat}","${word}"`
      ),
    ].join('\n');

    const negPath = path.join(process.cwd(), 'data', 'negative-keywords.csv');
    fs.writeFileSync(negPath, negCsv, 'utf-8');

    // 위기 키워드 CSV
    const crisisCsv = [
      '카테고리,키워드',
      ...allCrisisKeywords.map(([cat, word]) =>
        `"${cat}","${word}"`
      ),
    ].join('\n');

    const crisisPath = path.join(process.cwd(), 'data', 'crisis-keywords.csv');
    fs.writeFileSync(crisisPath, crisisCsv, 'utf-8');

    console.log('📋 부정 키워드:');
    Object.entries(negativeKeywords).forEach(([cat, words]) => {
      console.log(`  ${cat}: ${words.length}개`);
    });
    console.log(`  소계: ${allNegKeywords.length}개`);

    console.log('\n⚠️  위기 키워드:');
    Object.entries(crisisKeywords).forEach(([cat, words]) => {
      console.log(`  ${cat}: ${words.length}개`);
    });
    console.log(`  소계: ${allCrisisKeywords.length}개\n`);

    console.log(`✅ 저장됨: ${negPath}`);
    console.log(`✅ 저장됨: ${crisisPath}\n`);

    await prisma.$disconnect();

    console.log('📁 최종 파일 위치:');
    console.log(`  1️⃣  ${csvPath}`);
    console.log(`  2️⃣  ${negPath}`);
    console.log(`  3️⃣  ${crisisPath}\n`);

  } catch (error: any) {
    console.error('\n❌ 에러:', error.message);
    await prisma.$disconnect();
    process.exit(1);
  }
}

exportKeywords();
