/**
 * GV 키워드 오탐률 실측 (일회성 검증용, DB 불필요).
 * 구글 뉴스 en-US에서 실제 후보를 받아 isRelevant()가 몇 건을 통과시키는지 본다.
 *
 * npx tsx --env-file=.env.local scripts/_test-gv-keywords.ts [회사명 ...]
 */
import { readFileSync } from 'fs';
import { isRelevant } from '../src/lib/sparkscope/relevance';
import { buildQueryUrl, parseGoogleNewsItems, stripSourceSuffix } from '../src/lib/sparkscope/taiwan-collect';
import { GV_NEWS_LOCALE } from '../src/lib/sparkscope/gv-collect';

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows;
  return body.filter(r => r.some(v => v)).map(r => Object.fromEntries(head!.map((h, i) => [h, r[i] ?? ''])));
}

const RISKY = ['WOO Sports', '42 Technologies', 'Castle', 'Origin Markets', 'Flow State Media',
  'Iodine.com', 'Stitch app', 'Sutro', 'OpenSea', 'Squirrel.me', 'HUD Inc', 'Aire'];

async function main() {
  const rows = parseCsv(readFileSync('data/portfolio_company_gv.csv', 'utf-8'));
  const want = process.argv.slice(2);
  const targets = rows.filter(r => want.length ? want.includes(r['기업명(영문)']!) : RISKY.includes(r.primaryKeyword!));

  console.log(`대상 ${targets.length}개사\n`);
  let totalCand = 0, totalPass = 0;

  for (const t of targets) {
    const names = [t['기업명(영문)']!, t.primaryKeyword!].filter(Boolean);
    const url = buildQueryUrl([...new Set(names)], GV_NEWS_LOCALE);
    let items;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SparkScope/1.0)' } });
      if (!res.ok) { console.log(`${t['기업명(영문)']}: HTTP ${res.status}\n`); continue; }
      items = parseGoogleNewsItems(await res.text());
    } catch (e: any) { console.log(`${t['기업명(영문)']}: 실패 ${e?.message}\n`); continue; }

    const passed: string[] = [], rejected: string[] = [];
    for (const it of items) {
      const title = stripSourceSuffix(it.title, it.source);
      const ok = isRelevant({
        title, body: '',
        primaryKeyword: t.primaryKeyword!,
        name: t['기업명(영문)']!,
        englishName: t['기업명(영문)']!,
        helperKeywords: t.helperKeywords || null,
        excludeWords: t.excludeWords || null,
        contextWords: t.mustIncludeAny || null,
        category: 'portfolio_company_gv',
        link: it.link, source: it.source,
      });
      (ok ? passed : rejected).push(`${title}  [${it.source}]`);
    }
    totalCand += items.length; totalPass += passed.length;
    console.log(`── ${t['기업명(영문)']} (primary="${t.primaryKeyword}")`);
    console.log(`   후보 ${items.length} → 통과 ${passed.length}`);
    passed.slice(0, 4).forEach(s => console.log(`   ✅ ${s}`));
    rejected.slice(0, 3).forEach(s => console.log(`   ❌ ${s}`));
    console.log();
  }
  console.log(`합계: 후보 ${totalCand} → 통과 ${totalPass} (통과율 ${totalCand ? (totalPass / totalCand * 100).toFixed(1) : 0}%)`);
}
main();
