/**
 * 데일리 브리핑 영상 만들기.
 *
 *   npx tsx --env-file=.env.local scripts/build-briefing.ts [--out DIR] [--prepare] [--publish]
 *
 *   --prepare  오늘 스냅샷을 새로 만든다(없으면 어차피 만든다)
 *   --publish  스토리지에 올리고 DB에 영상 주소를 기록한다(GitHub Actions에서 쓴다)
 */
import { buildBriefingVideo } from '../src/lib/briefing-video/build';

function argOf(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

(async () => {
  const outDir = argOf('--out') ?? 'out/briefing';
  const built = await buildBriefingVideo({ outDir, prepare: process.argv.includes('--prepare') });
  console.log('\n--- 대본 ---');
  for (const s of built.segments) console.log(`[${s.kind}${s.index ?? ''}] ${s.text}`);
  if (process.argv.includes('--publish')) {
    const { publishBriefingVideo } = await import('../src/lib/briefing-video/publish');
    const url = await publishBriefingVideo(built);
    console.log(`\n게시: ${url}`);
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
