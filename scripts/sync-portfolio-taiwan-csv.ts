/**
 * data/portfolio_company_taiwan.csv → data/master-keywords.json 반영.
 * SparkLabs Taiwan 포트폴리오사 — 한국 portfolio_company와 섞이지 않도록
 * category를 'portfolio_company_tw'로 분리한다 (2026-08-26 추가).
 *
 * CSV 컬럼: 카테고리,기업명(중문),기업명(영문),primaryKeyword,helperKeywords,excludeWords,mustIncludeAny,businessContext,tier,status
 *
 * 정리 규칙:
 *  - name(unique key)은 기업명(영문) — 중문명이 없는 회사가 24곳이라 영문명만 항상 채워져 있음.
 *    englishName 필드에도 동일하게 영문명을 넣고, 중문명은 있으면 notes 맨 앞에 "[중문: X] "로 붙인다.
 *  - status: 이번 시트는 전 행 Live → status ACTIVE, portfolioStatus "Live".
 *    (한국 sync-portfolio-csv.ts의 Written-off→PAUSED 매핑과 동일한 규칙, 이번엔 해당 없음)
 *  - "N/A" 문자열 → 빈 값(null) 처리
 *  - helperKeywords/excludeWords/mustIncludeAny: 줄바꿈 구분도 쉼표 구분으로 통일
 *  - mustIncludeAny → contextWords, businessContext → notes 로 매핑 (한국 스크립트와 동일)
 *
 * master-keywords.json의 portfolio_company_tw 항목만 교체/추가하고 다른 카테고리는 그대로 둠.
 * 실행 후 `npm run db:seed` 로 DB에 반영해야 실제로 적용됨.
 *
 * 실행: npx tsx scripts/sync-portfolio-taiwan-csv.ts
 */
import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';

const CSV_PATH = path.join(__dirname, '../data/portfolio_company_taiwan.csv');
const JSON_PATH = path.join(__dirname, '../data/master-keywords.json');

function cleanList(raw: string | undefined): string | null {
  if (!raw) return null;
  const v = raw.trim();
  if (!v || v.toUpperCase() === 'N/A') return null;
  const parts = v
    .split(/[\n,]/)
    .map(s => s.trim())
    .filter(s => s && s.toUpperCase() !== 'N/A');
  return parts.length > 0 ? parts.join(', ') : null;
}

function cleanText(raw: string | undefined): string | null {
  if (!raw) return null;
  const v = raw.trim();
  if (!v || v.toUpperCase() === 'N/A') return null;
  return v;
}

const csvText = fs.readFileSync(CSV_PATH, 'utf-8');
const rows: Record<string, string>[] = parse(csvText, { columns: true, skip_empty_lines: true });

const skipped: string[] = [];
const converted = rows.map(r => {
  const en = (r['기업명(영문)'] ?? '').trim();
  const zh = cleanText(r['기업명(중문)']);
  const statusRaw = (r['status'] ?? '').trim();
  if (statusRaw !== 'Live') skipped.push(`${en || '(이름없음)'} — 알 수 없는 status "${statusRaw}"`);

  const businessContext = cleanText(r['businessContext']);
  const notes = zh ? `[중문: ${zh}]${businessContext ? ' ' + businessContext : ''}` : businessContext;

  return {
    name: en,
    englishName: en || null,
    category: 'portfolio_company_tw',
    status: 'ACTIVE',
    portfolioStatus: statusRaw || null,
    tier: cleanText(r['tier']),
    primaryKeyword: (r['primaryKeyword'] ?? '').trim() || en,
    helperKeywords: cleanList(r['helperKeywords']),
    excludeWords: cleanList(r['excludeWords']),
    contextWords: cleanList(r['mustIncludeAny']),
    notes,
  };
}).filter(t => t.name);

const existing: any[] = JSON.parse(fs.readFileSync(JSON_PATH, 'utf-8'));
const keptOther = existing.filter(t => t.category !== 'portfolio_company_tw');
const merged = [...keptOther, ...converted];

fs.writeFileSync(JSON_PATH, JSON.stringify(merged, null, 2) + '\n', 'utf-8');

console.log(`portfolio_company_tw: 기존 ${existing.filter(t => t.category === 'portfolio_company_tw').length}개 → 새 ${converted.length}개로 교체`);
console.log(`master-keywords.json 총 ${merged.length}개 (다른 카테고리 ${keptOther.length}개 유지)`);
if (skipped.length) {
  console.log(`\n⚠️ status 매핑 확인 필요, ${skipped.length}건:`);
  skipped.slice(0, 10).forEach(s => console.log('  - ' + s));
}
