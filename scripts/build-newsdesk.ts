/**
 * Claw-e 뉴스데스크 영상 만들기(매주 월).
 *
 *   npx tsx --env-file=.env.local scripts/build-newsdesk.ts [--out DIR] [--date YYYY-MM-DD] [--save]
 *
 *   --date  방송일(기본 오늘). 그 전주 월~일 데일리 브리핑에서 고른다
 *   --save  고른 5개를 DB(weekly_briefing)에 기록한다
 */
import { buildNewsdeskVideo, saveWeekly } from '../src/lib/briefing-video/newsdesk';

function argOf(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

(async () => {
  const built = await buildNewsdeskVideo({ outDir: argOf('--out') ?? 'out/newsdesk', dateKey: argOf('--date') });
  console.log('\n--- 대본 ---');
  for (const s of built.segments) console.log(`[${s.kind}${s.index ?? ''}] ${s.text}`);
  if (process.argv.includes('--save')) await saveWeekly(built.snapshot);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
