/**
 * data/competitor.csv → data/master-keywords.json 반영.
 * CSV 컬럼: 카테고리,기업명(한글),기업명(영문),primaryKeyword,helperKeywords,excludeWords,mustIncludeAny,businessContext,tier,status
 *
 * 정리 규칙:
 *  - status: 빈 값 → ACTIVE (경쟁사는 모두 수집)
 *  - "N/A" 문자열 → 빈 값(null) 처리
 *  - helperKeywords/excludeWords/contextWords: 줄바꿈 구분도 쉼표 구분으로 통일
 *  - businessContext → notes 로 매핑
 *
 * master-keywords.json의 competitor 항목만 교체하고 다른 카테고리는 그대로 둠.
 * 실행 후 `npm run db:seed` 로 DB에 반영해야 실제로 적용됨.
 *
 * 실행: npx tsx scripts/sync-competitor-csv.ts
 */
import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';

const CSV_PATH = path.join(__dirname, '../data/competitor.csv');
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

const converted = rows.map(r => {
  const name = (r['기업명(한글)'] ?? '').trim();
  const statusRaw = (r['status'] ?? '').trim();

  return {
    name,
    englishName: cleanText(r['기업명(영문)']),
    category: (r['카테고리'] ?? 'competitor').trim() || 'competitor',
    status: statusRaw || 'ACTIVE', // 빈 status → ACTIVE
    tier: cleanText(r['tier']),
    primaryKeyword: (r['primaryKeyword'] ?? '').trim() || name,
    helperKeywords: cleanList(r['helperKeywords']),
    excludeWords: cleanList(r['excludeWords']),
    contextWords: cleanList(r['mustIncludeAny']),
    notes: cleanText(r['businessContext']),
  };
}).filter(t => t.name);

const existing: any[] = JSON.parse(fs.readFileSync(JSON_PATH, 'utf-8'));
const keptOther = existing.filter(t => t.category !== 'competitor');
const merged = [...keptOther, ...converted];

fs.writeFileSync(JSON_PATH, JSON.stringify(merged, null, 2) + '\n', 'utf-8');

console.log(`competitor: 기존 ${existing.filter(t => t.category === 'competitor').length}개 → 새 ${converted.length}개로 교체`);
console.log(`master-keywords.json 총 ${merged.length}개 (다른 카테고리 ${keptOther.length}개 유지)`);
