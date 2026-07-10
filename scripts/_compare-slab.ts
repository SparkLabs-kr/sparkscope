import { prisma } from '../src/lib/prisma';
import * as fs from 'fs';
import * as path from 'path';

function normalizeCompanyName(name: string): string {
  return name
    .replace(/^㈜\s*/g, '')      // ㈜ 제거
    .replace(/^\(주\)\s*/g, '')  // (주) 제거
    .replace(/^주식회사\s*/g, '') // 주식회사 제거
    .replace(/\s*㈜\s*/g, '')    // 중간 ㈜ 제거
    .replace(/\s*\(주\)\s*/g, '') // 중간 (주) 제거
    .replace(/\s+/g, ' ')         // 다중 공백 정리
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
  const records = parseCSV(csvContent) as Array<{ company_name: string; company_investment_status: string; onboarding_status: string }>;

  const slabNormalized = records.map(r => normalizeCompanyName(r.company_name)).filter(n => n.length > 0);
  const slabNames = new Set(slabNormalized);
  console.log(`SLAB CSV 로드: ${records.length}개`);
  console.log(`SLAB 고유 회사명 (정규화): ${slabNames.size}개\n`);

  // 2. SparkScope MonitoringTarget 읽기 (portfolio_company)
  const monitoringTargets = await prisma.monitoringTarget.findMany({
    where: { category: 'portfolio_company' },
    select: { name: true, status: true },
  });

  const sparkscapeNormalized = monitoringTargets.map(m => normalizeCompanyName(m.name)).filter(n => n.length > 0);
  const sparkscapeNames = new Set(sparkscapeNormalized);
  console.log(`SparkScope MonitoringTarget (portfolio): ${monitoringTargets.length}개`);
  console.log(`고유 회사명: ${sparkscapeNames.size}개\n`);

  // 3. 비교 분석
  const intersection = new Set([...slabNames].filter(name => sparkscapeNames.has(name)));
  const slabOnly = new Set([...slabNames].filter(name => !sparkscapeNames.has(name)));
  const sparkscapeOnly = new Set([...sparkscapeNames].filter(name => !slabNames.has(name)));

  console.log('=== 📊 비교 결과 ===\n');
  console.log(`✓ 교집합 (양쪽 다 있음): ${intersection.size}개`);
  console.log(`  └─ SparkScope 기준: ${(100 * intersection.size / sparkscapeNames.size).toFixed(1)}% 일치`);
  console.log(`\n🆕 SLAB에만 있음: ${slabOnly.size}개`);
  console.log(`  └─ SparkScope에 추가 필요\n`);
  console.log(`❌ MonitoringTarget에만 있음: ${sparkscapeOnly.size}개`);
  console.log(`  └─ 기존 DB에 있지만 SLAB엔 없음\n`);

  // 4. SLAB 상태 분포
  console.log('=== 🔍 SLAB 상태 분포 ===\n');

  const investmentStatus: Record<string, number> = {};
  const onboardingStatus: Record<string, number> = {};
  records.forEach(r => {
    const inv = r.company_investment_status || 'null';
    const onb = r.onboarding_status || 'null';
    investmentStatus[inv] = (investmentStatus[inv] || 0) + 1;
    onboardingStatus[onb] = (onboardingStatus[onb] || 0) + 1;
  });

  console.log('company_investment_status 분포:');
  Object.entries(investmentStatus).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
    console.log(`  ${k}: ${v}개`);
  });

  console.log('\nonboarding_status 분포:');
  Object.entries(onboardingStatus).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
    console.log(`  ${k}: ${v}개`);
  });

  // 5. MonitoringTarget 상태 분포
  console.log('\n=== 🔍 MonitoringTarget 상태 분포 ===\n');
  const sparkscapeStatus: Record<string, number> = {};
  monitoringTargets.forEach(m => {
    sparkscapeStatus[m.status] = (sparkscapeStatus[m.status] || 0) + 1;
  });

  Object.entries(sparkscapeStatus).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
    console.log(`  ${k}: ${v}개`);
  });

  // 6. SLAB에만 있는 회사 샘플
  console.log('\n=== 🆕 SLAB에만 있는 회사 (상위 30개) ===\n');
  const slabOnlyArray = Array.from(slabOnly).slice(0, 30);
  slabOnlyArray.forEach(name => {
    const record = records.find(r => normalizeCompanyName(r.company_name) === name);
    const inv = record?.company_investment_status || 'null';
    const onb = record?.onboarding_status || 'null';
    console.log(`  • ${name}`);
  });
  if (slabOnly.size > 30) console.log(`  ... 외 ${slabOnly.size - 30}개`);

  // 7. MonitoringTarget에만 있는 회사 샘플
  console.log('\n=== ❌ MonitoringTarget에만 있는 회사 (상위 30개) ===\n');
  const sparkscapeOnlyArray = Array.from(sparkscapeOnly).slice(0, 30);
  sparkscapeOnlyArray.forEach(name => {
    console.log(`  • ${name}`);
  });
  if (sparkscapeOnly.size > 30) console.log(`  ... 외 ${sparkscapeOnly.size - 30}개`);

  // 최종 요약
  console.log('\n=== 📋 최종 요약 ===');
  console.log(`SLAB 회사: ${slabNames.size}개`);
  console.log(`SparkScope 포트폴리오: ${sparkscapeNames.size}개`);
  console.log(`교집합: ${intersection.size}개 (${(100 * intersection.size / Math.max(slabNames.size, sparkscapeNames.size)).toFixed(1)}%)`);
  console.log(`추가 필요: ${slabOnly.size}개`);
  console.log(`DB 클린업 대상: ${sparkscapeOnly.size}개`);

  await prisma.$disconnect();
}

main().catch(e => { console.error('ERR:', e.message ?? e); process.exit(1); });
