/**
 * 슬라이드 + 음성 → MP4. ffmpeg-static(바이너리 동봉)을 쓴다 — 로컬·GitHub Actions 어디서나 같은 ffmpeg.
 *
 * 문단마다 "정지 이미지 + 그 문단 음성" 조각을 만들고 이어 붙인다. 조각 끝에 짧은 여백을 둬서
 * 슬라이드가 말이 끝나자마자 넘어가지 않게 한다.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import ffmpegPath from 'ffmpeg-static';

const run = promisify(execFile);
export const GAP_SECONDS = 0.6;

async function ffmpeg(args: string[]) {
  if (!ffmpegPath) throw new Error('ffmpeg-static 바이너리를 찾지 못했습니다');
  await run(ffmpegPath, ['-y', '-loglevel', 'error', ...args], { maxBuffer: 64 * 1024 * 1024 });
}

export interface Clip {
  png: Buffer;
  wav: Buffer;
  seconds: number;
  /** 화면 전체를 이 GIF로(반복 재생) — 뉴스데스크 오프닝 타이틀. png 대신 쓴다. */
  backgroundGif?: string;
  /** 슬라이드 위에 반복 재생할 GIF(캐릭터) — 오른쪽 아래, 너비 w */
  overlayGif?: { file: string; w: number; x: number; y: number };
  /** 배경음악 — file의 start초부터 깔고 volume(0~1)으로 줄인다. 클립 끝 1초는 페이드아웃(fadeOut일 때). */
  bgm?: { file: string; start: number; volume: number; fadeOut?: boolean };
}

/** 무음 WAV(16bit 모노 24kHz) — 말 없이 음악만 나오는 오프닝 화면용 */
export function silentWav(seconds: number, rate = 24000): Buffer {
  const n = Math.round(seconds * rate);
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  return b;
}

export async function renderVideo(clips: Clip[], workDirIn: string, outFileIn: string): Promise<number> {
  // 절대 경로로 바꾼다 — concat 목록(list.txt) 안의 상대 경로는 ffmpeg가 목록 파일 폴더 기준으로
  // 다시 풀어서 "out/briefing/work/out/briefing/work/s0.mp4"가 됐다(2026-09-30 첫 Actions 실행 실패).
  const workDir = path.resolve(workDirIn);
  const outFile = path.resolve(outFileIn);
  await mkdir(workDir, { recursive: true });
  const parts: string[] = [];
  let total = 0;
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i];
    const png = path.join(workDir, `s${i}.png`);
    const wav = path.join(workDir, `s${i}.wav`);
    const mp4 = path.join(workDir, `s${i}.mp4`);
    await writeFile(png, c.png);
    await writeFile(wav, c.wav);
    const dur = c.seconds + GAP_SECONDS;
    // 입력: 0 화면(png 또는 GIF) · 1 목소리 · [2 캐릭터 GIF] · [다음 배경음악]
    const inputs: string[] = c.backgroundGif
      ? ['-stream_loop', '-1', '-i', path.resolve(c.backgroundGif), '-i', wav]
      : ['-loop', '1', '-framerate', '30', '-i', png, '-i', wav];
    const graph: string[] = [];
    let vOut = '0:v';
    if (c.backgroundGif) { graph.push('[0:v]scale=1280:720,fps=30,format=yuv420p[v]'); vOut = '[v]'; }
    if (c.overlayGif) {
      inputs.push('-stream_loop', '-1', '-i', path.resolve(c.overlayGif.file));
      graph.push(`[2:v]scale=${c.overlayGif.w}:-1,fps=30[h];[0:v][h]overlay=${c.overlayGif.x}:${c.overlayGif.y}:format=auto,format=yuv420p[v]`);
      vOut = '[v]';
    }
    // 목소리 끝에 여백을 붙이고, 배경음악이 있으면 섞는다.
    graph.push(`[1:a]aresample=44100,apad=pad_dur=${GAP_SECONDS}[voice]`);
    let aOut = '[voice]';
    if (c.bgm) {
      const idx = c.overlayGif ? 3 : 2;
      inputs.push('-i', path.resolve(c.bgm.file));
      const fade = c.bgm.fadeOut ? `,afade=t=out:st=${Math.max(0, dur - 1).toFixed(2)}:d=1` : '';
      graph.push(`[${idx}:a]aresample=44100,atrim=start=${c.bgm.start},asetpts=PTS-STARTPTS,volume=${c.bgm.volume}${fade}[m]`);
      graph.push(`[voice][m]amix=inputs=2:duration=first:normalize=0[a]`);
      aOut = '[a]';
    }
    await ffmpeg([
      ...inputs,
      '-filter_complex', graph.join(';'),
      '-map', vOut, '-map', aOut,
      '-t', dur.toFixed(2),
      '-c:v', 'libx264', ...(c.backgroundGif || c.overlayGif ? [] : ['-tune', 'stillimage']), '-pix_fmt', 'yuv420p', '-r', '30',
      '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '1',
      mp4,
    ]);
    parts.push(mp4);
    total += dur;
  }
  const list = path.join(workDir, 'list.txt');
  await writeFile(list, parts.map(p => `file '${p}'`).join('\n'));
  await ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', outFile]);
  return total;
}
