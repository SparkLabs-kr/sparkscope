// 승인된 영상(verify-1013b)에서 루센트블록 문장의 "대전 스타트업 "만 뺀 영상을 만든다. 나머지 장면은 기존 음성·그림을 그대로 쓴다.
import './_env';
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { synthesizeAll, wavSeconds } from '../src/lib/briefing-video/tts';
import { renderVideo, silentWav, GAP_SECONDS, type Clip } from '../src/lib/briefing-video/render';
import { NEWS_BGM, OPENING_SECONDS } from '../src/lib/briefing-video/build';

const SRC = 'out/verify-1013b/work';
const OUT = 'out/verify-1013c';

(async () => {
  const log = readFileSync(path.join(OUT, 'approved-build.log'), 'utf8');
  const block = log.split('--- 대본 ---')[1].trim().split('\n');
  const segs = block.map(l => {
    const m = l.match(/^\[(intro|item(\d+)|outro)\] (.*)$/);
    if (!m) throw new Error('parse: ' + l.slice(0, 40));
    return { kind: m[1].startsWith('item') ? 'item' : m[1], index: m[2] !== undefined ? Number(m[2]) : undefined, text: m[3] };
  });
  // 루센트블록 문장에서 "대전 스타트업 " 제거
  const target = segs.find(s => s.kind === 'item' && s.index === 0)!;
  const before = target.text.slice(0, 40);
  target.text = target.text.replace('대전 스타트업 루센트블록', '루센트블록');
  console.log('item0 before:', before, '| after:', target.text.slice(0, 40));
  writeFileSync(path.join(OUT, 'segments.json'), JSON.stringify(segs, null, 2), 'utf8');

  // 바뀐 장면(item0)만 음성을 새로 만든다
  const { speeches } = await synthesizeAll([target.text]);
  const newWav = speeches[0].wav;
  const itemPos = segs.indexOf(target); // 0=intro, 1=item0 ... (segments 순서)

  const clips: Clip[] = [];
  clips.push({ png: readFileSync(path.join(SRC, 's0.png')), wav: silentWav(OPENING_SECONDS), seconds: OPENING_SECONDS, bgm: { file: NEWS_BGM, start: 0, volume: 0.9 } });
  segs.forEach((s, i) => {
    const png = readFileSync(path.join(SRC, `s${i + 1}.png`));
    const wav = s === target ? newWav : readFileSync(path.join(SRC, `s${i + 1}.wav`));
    clips.push({
      png, wav, seconds: wavSeconds(wav),
      ...(s.kind === 'intro' ? { bgm: { file: NEWS_BGM, start: OPENING_SECONDS + GAP_SECONDS, volume: 0.15, fadeOut: true } } : {}),
    });
  });
  console.log('clips:', clips.length, '(expect 11), item pos:', itemPos);
  const seconds = await renderVideo(clips, path.join(OUT, 'work'), path.join(OUT, 'briefing-2026-10-13.mp4'));
  console.log('rendered seconds:', seconds.toFixed(1));
  writeFileSync(path.join(OUT, 'seconds.txt'), String(seconds), 'utf8');
})().catch(e => { console.error(e); process.exit(1); });
