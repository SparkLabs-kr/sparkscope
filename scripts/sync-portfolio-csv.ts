/**
 * data/portfolio_company.csv → data/master-keywords.json 반영.
 * CSV 컬럼: 카테고리,기업명(한글),기업명(영문),primaryKeyword,helperKeywords,excludeWords,contextWords,businessContext,tier,status
 *
 * 정리 규칙:
 *  - status: Live→ACTIVE, Exit/Written-off/Written-Off→EXIT
 *  - "N/A" 문자열 → 빈 값(null) 처리 (그대로 두면 제목에 "N/A"가 있는 기사까지 걸러짐)
 *  - helperKeywords/excludeWords/contextWords: 줄바꿈 구분도 쉼표 구분으로 통일
 *  - businessContext → notes 로 매핑 (tier는 현재 매칭 로직에서 안 쓰여 반영 안 함)
 *
 * master-keywords.json의 portfolio_company 항목만 교체하고 다른 카테고리는 그대로 둠.
 * 실행 후 `npm run db:seed` 로 DB에 반영해야 실제로 적용됨.
 *
 * 실행: npx tsx scripts/sync-portfolio-csv.ts
 */
import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';

const CSV_PATH = path.join(__dirname, '../data/portfolio_company.csv');
const JSON_PATH = path.join(__dirname, '../data/master-keywords.json');

// portfolioStatus 표기 통일 (대소문자만 다른 것 정리). status(수집 on/off)는 전부 ACTIVE로 —
// Live/Exit/Written-off 구분 없이 다 수집하되, 실제 상태는 portfolioStatus에 라벨로 남긴다.
const PORTFOLIO_STATUS_MAP: Record<string, string> = {
  'Live': 'Live',
  'Exit': 'Exit',
  'Written-off': 'Written-off',
  'Written-Off': 'Written-off',
};

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
  const name = (r['기업명(한글)'] ?? '').trim();
  const statusRaw = (r['status'] ?? '').trim();
  const portfolioStatus = PORTFOLIO_STATUS_MAP[statusRaw];
  if (!portfolioStatus) skipped.push(`${name || '(이름없음)'} — 알 수 없는 status "${statusRaw}"`);

  return {
    name,
    englishName: cleanText(r['기업명(영문)']),
    category: (r['카테고리'] ?? 'portfolio_company').trim() || 'portfolio_company',
    status: 'ACTIVE',
    portfolioStatus: portfolioStatus ?? statusRaw ?? null,
    tier: cleanText(r['tier']),
    primaryKeyword: (r['primaryKeyword'] ?? '').trim() || name,
    helperKeywords: cleanList(r['helperKeywords']),
    excludeWords: cleanList(r['excludeWords']),
    contextWords: cleanList(r['mustIncludeAny']),
    notes: cleanText(r['businessContext']),
  };
}).filter(t => t.name);

const existing: any[] = JSON.parse(fs.readFileSync(JSON_PATH, 'utf-8'));
const keptOther = existing.filter(t => t.category !== 'portfolio_company');
const merged = [...keptOther, ...converted];

fs.writeFileSync(JSON_PATH, JSON.stringify(merged, null, 2) + '\n', 'utf-8');

console.log(`portfolio_company: 기존 ${existing.filter(t => t.category === 'portfolio_company').length}개 → 새 ${converted.length}개로 교체`);
console.log(`master-keywords.json 총 ${merged.length}개 (다른 카테고리 ${keptOther.length}개 유지)`);
if (skipped.length) {
  console.log(`\n⚠️ status 매핑 실패(PAUSED로 대체됨), ${skipped.length}건:`);
  skipped.slice(0, 10).forEach(s => console.log('  - ' + s));
}
