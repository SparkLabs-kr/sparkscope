/**
 * 이미 만들어 둔 영상(publish-prebuilt/<날짜>/)을 스토리지·DB에 올린다. 영상을 새로 만들지 않는다.
 *   npx tsx --env-file=.env.local scripts/publish-prebuilt.ts 2026-10-13
 * 대본은 segments.json(영상에 실제로 들어간 문장)을 그대로 기록한다.
 */
import './_env';
import { readFileSync } from 'fs';
import path from 'path';
import { loadBriefingSnapshot } from '../src/lib/sparkscope/briefing';
import { publishBriefingVideo } from '../src/lib/briefing-video/publish';
import type { BuiltBriefing } from '../src/lib/briefing-video/build';

(async () => {
  const dateKey = process.argv[2];
  if (!dateKey) throw new Error('날짜를 넣으세요. 예: 2026-10-13');
  const dir = path.join('publish-prebuilt', dateKey);
  const snapshot = await loadBriefingSnapshot();
  if (!snapshot || snapshot.dateKey !== dateKey) throw new Error(`스냅샷이 ${dateKey}가 아닙니다: ${snapshot?.dateKey}`);
  const segments = JSON.parse(readFileSync(path.join(dir, 'segments.json'), 'utf8'));
  const seconds = Number(readFileSync(path.join(dir, 'seconds.txt'), 'utf8'));
  const built = { snapshot, segments, file: path.join(dir, 'briefing.mp4'), seconds } as unknown as BuiltBriefing;
  const url = await publishBriefingVideo(built);
  console.log(`게시: ${url}`);
})().catch(e => { console.error(e); process.exit(1); });
