/**
 * 포트폴리오 CSV → data/master-keywords.json 반영.
 * CSV 컬럼: 카테고리,기업명(한글|중문),기업명(영문),primaryKeyword,helperKeywords,excludeWords,mustIncludeAny,businessContext,tier,status
 *
 * 정리 규칙:
 *  - status(수집 on/off): Written-off만 PAUSED, Live/Exit는 둘 다 ACTIVE — exit했다고 수집을 멈추지 않는다.
 *  - "N/A" 문자열 → 빈 값(null) 처리 (그대로 두면 제목에 "N/A"가 있는 기사까지 걸러짐)
 *  - helperKeywords/excludeWords/contextWords: 줄바꿈 구분도 쉼표 구분으로 통일
 *  - businessContext → notes 로 매핑 (tier는 현재 매칭 로직에서 안 쓰여 반영 안 함)
 *
 * master-keywords.json에서 "이 CSV의 카테고리" 항목만 교체하고 다른 카테고리는 그대로 둔다.
 * 실행 후 `npm run db:seed` 로 DB에 반영해야 실제로 적용됨.
 *
 * 실행:
 *   npx tsx scripts/sync-portfolio-csv.ts                                   # 한국 (기본값)
 *   npx tsx scripts/sync-portfolio-csv.ts data/portfolio_company_taiwan.csv portfolio_company_tw
 *
 * 대만 CSV는 2번째 컬럼이 "기업명(중문)"이다 — 대만 법인엔 공식 한글명이 없어 중문 상호를 쓴다.
 * 두 헤더를 모두 받아들이되, 어느 쪽도 없으면 그 행은 건너뛴다(이름 없는 대상은 매칭 불가).
 */
import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';

const DEFAULT_CSV = 'data/portfolio_company.csv';
const DEFAULT_CATEGORY = 'portfolio_company';

const csvArg = process.argv[2] ?? DEFAULT_CSV;
const categoryArg = process.argv[3] ?? DEFAULT_CATEGORY;

const CSV_PATH = path.isAbsolute(csvArg) ? csvArg : path.join(__dirname, '..', csvArg);
const JSON_PATH = path.join(__dirname, '../data/master-keywords.json');

// portfolioStatus 표기 통일 (대소문자만 다른 것 정리). 실제 상태는 portfolioStatus에 라벨로 남긴다.
const PORTFOLIO_STATUS_MAP: Record<string, string> = {
  'Live': 'Live',
  'Exit': 'Exit',
  'Written-off': 'Written-off',
  'Written-Off': 'Written-off',
};

/**
 * MonitoringTarget.name — DB의 고유키이자 seedKeywords()의 upsert 기준이다.
 *
 * 한국은 "기업명(한글)"을 그대로 쓴다. 대만은 이미 시드된 69개 행이 영문명을 name으로
 * 쓰고 있어(2026-08-26 확인) 여기서 중문명을 name으로 쓰면 upsert가 매칭되지 않고
 * 45개 행이 통째로 새로 생겨 중복된다. 중문 상호는 primaryKeyword에 들어간다.
 */
function readName(r: Record<string, string>): string {
  const ko = (r['기업명(한글)'] ?? '').trim();
  if (ko) return ko;
  return (r['기업명(영문)'] ?? '').trim();
}

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

if (!fs.existsSync(CSV_PATH)) {
  console.error(`CSV를 찾을 수 없습니다: ${CSV_PATH}`);
  process.exit(1);
}

const csvText = fs.readFileSync(CSV_PATH, 'utf-8');
const rows: Record<string, string>[] = parse(csvText, { columns: true, skip_empty_lines: true });

const skipped: string[] = [];
const nameless: number[] = [];
const converted = rows.map((r, i) => {
  const name = readName(r);
  if (!name) nameless.push(i + 2); // 헤더 1줄 + 0-index 보정 → 스프레드시트 행번호
  // 중문 상호는 표시·검색용이므로 primaryKeyword로 간다(name이 아니라).
  const statusRaw = (r['status'] ?? '').trim();
  const portfolioStatus = PORTFOLIO_STATUS_MAP[statusRaw];
  if (!portfolioStatus) skipped.push(`${name || '(이름없음)'} — 알 수 없는 status "${statusRaw}"`);

  const englishName = cleanText(r['기업명(영문)']);
  const resolvedName = name;

  return {
    name: resolvedName,
    englishName,
    // 카테고리는 인자로 받은 값을 우선한다 — 대만 CSV의 카테고리 칸이 portfolio_company로
    // 남아 있어도 한국 포트폴리오와 섞이지 않게 한다.
    category: categoryArg,
    status: portfolioStatus === 'Written-off' ? 'PAUSED' : 'ACTIVE',
    portfolioStatus: portfolioStatus ?? statusRaw ?? null,
    tier: cleanText(r['tier']),
    // 표시용 사명이 없으면(대만 24개사) 영문명이라도 검색어로 쓴다.
    primaryKeyword: (r['primaryKeyword'] ?? '').trim() || resolvedName,
    helperKeywords: cleanList(r['helperKeywords']),
    excludeWords: cleanList(r['excludeWords']),
    contextWords: cleanList(r['mustIncludeAny']),
    notes: cleanText(r['businessContext']),
  };
}).filter(t => t.primaryKeyword);

const existing: any[] = JSON.parse(fs.readFileSync(JSON_PATH, 'utf-8'));
const before = existing.filter(t => t.category === categoryArg).length;
const keptOther = existing.filter(t => t.category !== categoryArg);
const merged = [...keptOther, ...converted];

fs.writeFileSync(JSON_PATH, JSON.stringify(merged, null, 2) + '\n', 'utf-8');

console.log(`${categoryArg}: 기존 ${before}개 → 새 ${converted.length}개로 교체  (${csvArg})`);
console.log(`master-keywords.json 총 ${merged.length}개 (다른 카테고리 ${keptOther.length}개 유지)`);
if (nameless.length) {
  console.log(`\n표시용 사명이 비어 영문명(englishName)으로 대체한 행 ${nameless.length}건: ${nameless.slice(0, 10).join(', ')}${nameless.length > 10 ? ' …' : ''}`);
}
if (skipped.length) {
  console.log(`\n⚠️ status 매핑 실패(PAUSED로 대체됨), ${skipped.length}건:`);
  skipped.slice(0, 10).forEach(s => console.log('  - ' + s));
}
