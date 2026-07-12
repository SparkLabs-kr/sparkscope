/**
 * 검토 완료한 CSV → DB 일괄 저장
 * 파일: logs/needs-review-2026-07-12_검토.csv
 *
 * 실행: npx tsx scripts/save-reviewed-articles.ts
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

// 간단한 CSV 파싱
function parseCSV(content: string) {
  const lines = content.split('\n').filter(l => l.trim());
  const header = parseCSVLine(lines[0]);
  const records = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const record: any = {};
    header.forEach((h, idx) => {
      record[h] = values[idx] || '';
    });
    records.push(record);
  }

  return records;
}

function parseCSVLine(line: string) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result;
}

async function main() {
  try {
    const csvPath = path.join(process.cwd(), 'logs', 'needs-review-2026-07-12_검토.csv');

    if (!fs.existsSync(csvPath)) {
      console.error(`❌ 파일 없음: ${csvPath}`);
      process.exit(1);
    }

    console.log('\n🚀 검토 완료 파일 DB 저장 시작\n');
    console.log(`파일: ${csvPath}\n`);

    // CSV 읽기
    let content = fs.readFileSync(csvPath, 'utf-8');
    // UTF-8 BOM 제거
    if (content.charCodeAt(0) === 0xfeff) {
      content = content.slice(1);
    }

    const records = parseCSV(content);

    console.log(`CSV 레코드: ${records.length}건\n`);

    let saved = 0;
    let skipped = 0;
    let errors = 0;

    for (const record of records) {
      try {
        // 컬럼 매핑 (유연한 헤더 처리)
        const id = record.ID || record.id || record['Column1'];
        const newCat = record['새카테고리'] || record['Column6'] || record.newCategory;
        const newTone = record['새톤'] || record['Column7'] || record.newTone;
        const newIsNoise = record['새노이즈'] || record['Column8'] || record.newIsNoise;

        if (!id) {
          console.log(`  ⏭️  스킵: ID 없음`);
          skipped++;
          continue;
        }

        // 저장할 데이터
        const updateData: any = {};

        if (newCat && newCat !== 'undefined') {
          updateData.category = newCat;
        }
        if (newTone && newTone !== 'undefined') {
          updateData.tone = newTone;
        }
        if (newIsNoise !== undefined && newIsNoise !== 'undefined' && newIsNoise !== '') {
          updateData.isNoise = newIsNoise === 'true' || newIsNoise === true;
        }

        if (Object.keys(updateData).length === 0) {
          skipped++;
          continue;
        }

        // DB 업데이트
        await prisma.article.update({
          where: { id },
          data: updateData,
        });

        saved++;

        if (saved % 50 === 0) {
          console.log(`  ✅ 저장: ${saved}건`);
        }
      } catch (e: any) {
        if (e.code === 'P2025') {
          // 레코드 없음 (무시)
          skipped++;
        } else {
          console.log(`  ❌ 에러 (${record.ID}): ${e.message}`);
          errors++;
        }
      }
    }

    console.log(`\n✅ 완료!\n`);
    console.log(`저장: ${saved}건`);
    console.log(`스킵: ${skipped}건`);
    console.log(`에러: ${errors}건\n`);

    await prisma.$disconnect();

  } catch (error: any) {
    console.error(`\n❌ 심각한 에러: ${error.message}`);
    await prisma.$disconnect();
    process.exit(1);
  }
}

main();
