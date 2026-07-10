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

async function main() {
  // 1. SLAB CSV 읽기
  const csvPath = 'C:\\Users\\장이수_PC\\Desktop\\sparkscope-work\\data\\Slab_company_327.csv';
  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const slabRecords = parseCSV(csvContent) as Array<{ company_name: string }>;

  const slabNormalized = new Map(
    slabRecords.map(r => {
      const norm = normalizeCompanyName(r.company_name);
      return [norm, r.company_name];
    }).filter(([norm]) => norm.length > 0)
  );

  console.log(`SLAB 로드: ${slabNormalized.size}개\n`);

  // 2. 기존 MonitoringTarget 읽기
  const existing = await prisma.monitoringTarget.findMany({
    where: { category: 'portfolio_company' },
    select: { name: true },
  });

  const existingNormalized = new Set(
    existing.map(m => normalizeCompanyName(m.name)).filter(n => n.length > 0)
  );

  console.log(`기존 MonitoringTarget: ${existingNormalized.size}개\n`);

  // 3. 추가할 회사 필터링
  const toAdd = Array.from(slabNormalized.entries())
    .filter(([norm]) => !existingNormalized.has(norm))
    .map(([, original]) => ({
      name: original,
      primaryKeyword: original,
      category: 'portfolio_company' as const,
      status: 'ACTIVE' as const,
    }));

  console.log(`추가할 회사: ${toAdd.length}개\n`);

  if (toAdd.length === 0) {
    console.log('추가할 회사가 없습니다.');
    await prisma.$disconnect();
    return;
  }

  // 4. 실제 추가 (upsert)
  console.log('=== 추가 시작 ===\n');
  let added = 0;
  for (const company of toAdd) {
    try {
      await prisma.monitoringTarget.upsert({
        where: { name: company.name },
        update: { status: 'ACTIVE' },
        create: company,
      });
      added++;
      if (added % 50 === 0) {
        console.log(`${added}개 추가 완료...`);
      }
    } catch (e) {
      console.error(`❌ ${company.name}:`, (e as Error).message);
    }
  }

  console.log(`\n✅ 총 ${added}개 회사 추가 완료!`);

  // 5. 최종 통계
  const final = await prisma.monitoringTarget.findMany({
    where: { category: 'portfolio_company' },
    select: { name: true },
  });

  console.log(`\n=== 최종 통계 ===`);
  console.log(`기존: ${existing.length}개`);
  console.log(`추가: ${added}개`);
  console.log(`현재: ${final.length}개`);

  await prisma.$disconnect();
}

main().catch(e => { console.error('ERR:', e.message ?? e); process.exit(1); });
