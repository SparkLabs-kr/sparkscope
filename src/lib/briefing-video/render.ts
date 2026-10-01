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
const GAP_SECONDS = 0.6;

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
    const video = c.backgroundGif
      ? ['-stream_loop', '-1', '-i', path.resolve(c.backgroundGif), '-i', wav,
         '-filter_complex', `[0:v]scale=1280:720,fps=30,format=yuv420p[v]`, '-map', '[v]', '-map', '1:a']
      : c.overlayGif
        ? ['-loop', '1', '-framerate', '30', '-i', png, '-i', wav,
           '-stream_loop', '-1', '-i', path.resolve(c.overlayGif.file),
           '-filter_complex', `[2:v]scale=${c.overlayGif.w}:-1,fps=30[h];[0:v][h]overlay=${c.overlayGif.x}:${c.overlayGif.y}:format=auto,format=yuv420p[v]`,
           '-map', '[v]', '-map', '1:a']
        : ['-loop', '1', '-framerate', '30', '-i', png, '-i', wav];
    await ffmpeg([
      ...video,
      '-af', `apad=pad_dur=${GAP_SECONDS}`,
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
