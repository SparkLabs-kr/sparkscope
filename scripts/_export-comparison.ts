import { prisma } from '../src/lib/prisma';
import * as fs from 'fs';

function normalizeCompanyName(name: string): string {
  return name
    .replace(/^㈜\s*/g, '')
    .replace(/^\(주\)\s*/g, '')
    .replace(/^주식회사\s*/g, '')
    .replace(/\s*㈜\s*/g, '')
    .replace(/\s*\(주\)\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseCSV(content: string) {
  const lines = content.split('\n').filter(l => l.trim());
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const records = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    const record: Record<string, string> = {};
    headers.forEach((h, idx) => { record[h] = values[idx] || ''; });
    records.push(record);
  }
  return records;
}

function escapeCSV(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

async function main() {
  // 1. SLAB CSV 읽기
  const csvPath = 'C:\\Users\\장이수_PC\\Desktop\\sparkscope-work\\data\\Slab_company_327.csv';
  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const slabRecords = parseCSV(csvContent) as Array<{
    company_name: string;
    company_name_eng: string;
    sector_legacy: string;
    company_investment_status: string;
  }>;

  const slabMap = new Map(
    slabRecords
      .map(r => [normalizeCompanyName(r.company_name), r])
      .filter(([norm]) => norm.length > 0)
  );

  console.log(`SLAB 로드: ${slabMap.size}개\n`);

  // 2. MonitoringTarget 읽기
  const sparkscope = await prisma.monitoringTarget.findMany({
    where: { category: 'portfolio_company' },
    select: { name: true, category: true, status: true },
  });

  const sparkscapeMap = new Map(
    sparkscope.map(s => [normalizeCompanyName(s.name), s])
  );

  console.log(`SparkScope 로드: ${sparkscapeMap.size}개\n`);

  // 3. 비교
  const slabOnly: typeof slabRecords = [];
  const overlap: Array<{ slab_name: string; sparkscope_name: string }> = [];

  for (const [norm, record] of slabMap) {
    const ss = sparkscapeMap.get(norm);
    if (ss) {
      overlap.push({ slab_name: record.company_name, sparkscope_name: ss.name });
    } else {
      slabOnly.push(record);
    }
  }

  const sparkscapeOnly = sparkscope.filter(
    s => !slabMap.has(normalizeCompanyName(s.name))
  );

  console.log(`교집합: ${overlap.length}개`);
  console.log(`SLAB만: ${slabOnly.length}개`);
  console.log(`SparkScope만: ${sparkscapeOnly.length}개\n`);

  // 4. CSV 저장
  const outputDir = 'C:\\Users\\장이수_PC\\Desktop\\sparkscope-work\\data';

  // 4-1. SLAB Only
  const slabOnlyCSV = [
    'company_name,company_name_eng,sector,company_investment_status',
    ...slabOnly.map(r =>
      `${escapeCSV(r.company_name)},${escapeCSV(r.company_name_eng || '')},${escapeCSV(r.sector_legacy || '')},${escapeCSV(r.company_investment_status || '')}`
    )
  ].join('\n');

  const slabOnlyPath = `${outputDir}\\slab-only-${slabOnly.length}.csv`;
  fs.writeFileSync(slabOnlyPath, slabOnlyCSV, 'utf-8');
  console.log(`✅ ${slabOnlyPath}`);

  // 4-2. SparkScope Only
  const sparkscapeOnlyCSV = [
    'sparkscope_name,status',
    ...sparkscapeOnly.map(s =>
      `${escapeCSV(s.name)},${escapeCSV(s.status)}`
    )
  ].join('\n');

  const sparkscapeOnlyPath = `${outputDir}\\sparkscope-only-${sparkscapeOnly.length}.csv`;
  fs.writeFileSync(sparkscapeOnlyPath, sparkscapeOnlyCSV, 'utf-8');
  console.log(`✅ ${sparkscapeOnlyPath}`);

  // 4-3. Overlap
  const overlapCSV = [
    'slab_name,sparkscope_name',
    ...overlap.map(o =>
      `${escapeCSV(o.slab_name)},${escapeCSV(o.sparkscope_name)}`
    )
  ].join('\n');

  const overlapPath = `${outputDir}\\overlap-${overlap.length}.csv`;
  fs.writeFileSync(overlapPath, overlapCSV, 'utf-8');
  console.log(`✅ ${overlapPath}`);

  console.log(`\n=== 준비 완료 ===`);
  console.log(`내용을 확인한 후 추가 여부를 결정해주세요.`);

  await prisma.$disconnect();
}

main().catch(e => { console.error('ERR:', e.message ?? e); process.exit(1); });
