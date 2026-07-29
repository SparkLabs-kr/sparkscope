/**
 * SparkLabs_Media Coverage Tracker 구글 시트 → Article 테이블 수동 동기화(로컬 테스트/1회성 실행용).
 * 실행: npx tsx scripts/import-media-sheet.ts [--dry-run]
 * .env.local에 GOOGLE_SHEETS_API_KEY가 있어야 함.
 */
import fs from 'fs';
import path from 'path';

const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  // .env.local이 CRLF일 수 있음 — 줄 끝 \r을 먼저 제거해야 값이 제대로 파싱됨.
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n').map(l => l.replace(/\r$/, ''));
  for (const line of lines) {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      let value = match[2].trim();
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      process.env[key] = value;
    }
  }
}

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const apiKey = process.env.GOOGLE_SHEETS_API_KEY;
  if (!apiKey) {
    console.error('❌ GOOGLE_SHEETS_API_KEY가 없습니다 (.env.local 확인).');
    process.exit(1);
  }

  const { importMediaSheet } = await import('../src/lib/sparkscope/sheet-import');
  console.log(DRY_RUN ? '[DRY RUN] 미디어 시트 동기화 시작...' : '미디어 시트 동기화 시작...');
  const result = await importMediaSheet(apiKey, { dryRun: DRY_RUN });

  console.log('\n=== 결과 ===');
  console.log(`처리한 탭: ${result.tabsProcessed}개`);
  if (result.skippedTabs.length) console.log(`건너뛴 탭: ${result.skippedTabs.join(', ')}`);
  console.log(`전체 행: ${result.rowsSeen}건`);
  console.log(`${DRY_RUN ? '삽입될' : '삽입됨'}: ${result.inserted}건`);
  console.log(`링크 없어서 건너뜀: ${result.skippedNoLink}건`);
  console.log(`날짜 파싱 실패로 건너뜀: ${result.skippedNoDate}건`);
  console.log(`이미 있어서 건너뜀(중복): ${result.skippedDuplicate}건`);
}

main().catch(e => { console.error(e); process.exit(1); });
