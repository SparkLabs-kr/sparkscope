/**
 * 브리핑 슬라이드 — 1280×720 PNG. 브라우저 없이 @napi-rs/canvas로 그린다(GitHub Actions에서도 같게 나오도록).
 * 폰트는 Pretendard(OFL) — node_modules/pretendard에서 읽는다.
 * 색은 대시보드와 같은 스파크 팔레트(tailwind.config: spark.*).
 */
import { createCanvas, GlobalFonts, type SKRSContext2D } from '@napi-rs/canvas';
import path from 'path';
import type { BriefingHeadline } from '../sparkscope/briefing';

export const W = 1280;
export const H = 720;

const C = {
  purple: '#5046E5',
  lightPurple: '#EEEDFC',
  ink: '#1A1A1A',
  inkSoft: '#514E5C',
  muted: '#8B8894',
  cream: '#F5F3EF',
  white: '#FFFFFF',
};

let fontsReady = false;
function ensureFonts() {
  if (fontsReady) return;
  const dir = path.join(process.cwd(), 'node_modules/pretendard/dist/public/static');
  for (const w of ['Regular', 'SemiBold', 'Bold', 'ExtraBold']) {
    GlobalFonts.registerFromPath(path.join(dir, `Pretendard-${w}.otf`), `Pretendard ${w}`);
  }
  fontsReady = true;
}

/** 글자 단위 줄바꿈(한국어는 어절보다 글자 단위가 자연스럽게 꽉 찬다). 넘치면 마지막 줄에 …. */
function wrap(ctx: SKRSContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const ch of text) {
    if (ctx.measureText(line + ch).width > maxWidth && line) {
      lines.push(line);
      line = ch.trimStart();
      if (lines.length === maxLines) break;
    } else {
      line += ch;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  const consumed = lines.join('').length;
  if (consumed < text.replace(/^\s+/, '').length && lines.length === maxLines) {
    let last = lines[maxLines - 1];
    while (ctx.measureText(last + '…').width > maxWidth && last.length) last = last.slice(0, -1);
    lines[maxLines - 1] = last + '…';
  }
  return lines;
}

/** 프로그램 — 데일리(월·수·금)와 Claw-e 뉴스데스크(월)가 같은 슬라이드를 쓴다. hostSpace면 오른쪽 아래를 캐릭터 자리로 비운다. */
export interface SlideOpts { program?: string; hostSpace?: boolean }
const HOST_W = 340;

function base(dateLabel: string, program = '데일리 브리핑') {
  ensureFonts();
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = C.cream;
  ctx.fillRect(0, 0, W, H);
  // 상단 띠
  ctx.fillStyle = C.purple;
  ctx.fillRect(0, 0, W, 8);
  ctx.font = '26px "Pretendard Bold"';
  ctx.fillStyle = C.purple;
  ctx.fillText('SparkScope', 64, 72);
  ctx.font = '22px "Pretendard SemiBold"';
  ctx.fillStyle = C.muted;
  ctx.fillText(program, 222, 72);
  ctx.textAlign = 'right';
  ctx.fillText(dateLabel, W - 64, 72);
  ctx.textAlign = 'left';
  return { canvas, ctx };
}

export function introSlide(dateLabel: string, headlines: BriefingHeadline[], o: SlideOpts = {}): Buffer {
  const { canvas, ctx } = base(dateLabel, o.program);
  const textW = W - 200 - (o.hostSpace ? HOST_W : 0);
  ctx.font = '64px "Pretendard ExtraBold"';
  ctx.fillStyle = C.ink;
  ctx.fillText(o.hostSpace ? '이번 주 헤드라인' : '오늘의 헤드라인', 64, 190);
  let y = 270;
  headlines.forEach((h, i) => {
    ctx.fillStyle = C.purple;
    ctx.beginPath();
    ctx.arc(84, y - 12, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = C.white;
    ctx.font = '22px "Pretendard Bold"';
    ctx.textAlign = 'center';
    ctx.fillText(String(i + 1), 84, y - 4);
    ctx.textAlign = 'left';
    ctx.fillStyle = C.ink;
    ctx.font = '30px "Pretendard SemiBold"';
    ctx.fillText(wrap(ctx, h.title, textW, 1)[0] ?? '', 124, y);
    y += 82;
  });
  return canvas.toBuffer('image/png');
}

export function itemSlide(dateLabel: string, h: BriefingHeadline, index: number, total: number, o: SlideOpts = {}): Buffer {
  const { canvas, ctx } = base(dateLabel, o.program);
  const textW = W - 128 - (o.hostSpace ? HOST_W : 0);
  // 순번
  ctx.font = '120px "Pretendard ExtraBold"';
  ctx.fillStyle = C.lightPurple;
  ctx.fillText(String(index + 1).padStart(2, '0'), 56, 240);
  // 라벨 칩
  ctx.font = '26px "Pretendard Bold"';
  // 라벨 앞 이모지(📈 💼)는 Pretendard에 없어 네모로 깨진다 — 슬라이드에선 뗀다.
  const label = h.label.replace(/^[\p{Extended_Pictographic}\uFE0F\s]+/u, '');
  const lw = ctx.measureText(label).width + 40;
  ctx.fillStyle = C.purple;
  ctx.beginPath();
  ctx.roundRect(64, 270, lw, 50, 25);
  ctx.fill();
  ctx.fillStyle = C.white;
  ctx.fillText(label, 84, 305);
  // 제목
  ctx.font = '54px "Pretendard ExtraBold"';
  ctx.fillStyle = C.ink;
  let y = 400;
  for (const line of wrap(ctx, h.title, textW, 3)) {
    ctx.fillText(line, 64, y);
    y += 72;
  }
  // 요약
  ctx.font = '28px "Pretendard Regular"';
  ctx.fillStyle = C.inkSoft;
  y += 8;
  for (const line of wrap(ctx, h.summary, textW, 2)) {
    ctx.fillText(line, 64, y);
    y += 42;
  }
  // 출처 · 진행
  ctx.font = '22px "Pretendard SemiBold"';
  ctx.fillStyle = C.muted;
  ctx.fillText(h.source, 64, H - 48);
  ctx.textAlign = 'right';
  ctx.fillText(`${index + 1} / ${total}`, W - 64 - (o.hostSpace ? HOST_W : 0), H - 48);
  ctx.textAlign = 'left';
  // 진행 막대
  ctx.fillStyle = '#E7E3DB';
  ctx.fillRect(0, H - 8, W, 8);
  ctx.fillStyle = C.purple;
  ctx.fillRect(0, H - 8, (W * (index + 1)) / total, 8);
  return canvas.toBuffer('image/png');
}

export function outroSlide(dateLabel: string, o: SlideOpts = {}): Buffer {
  const { canvas, ctx } = base(dateLabel, o.program);
  ctx.textAlign = 'center';
  ctx.font = '60px "Pretendard ExtraBold"';
  ctx.fillStyle = C.ink;
  ctx.fillText(o.hostSpace ? '이번 주 뉴스데스크는 여기까지' : '오늘 브리핑은 여기까지', W / 2, 340);
  ctx.font = '30px "Pretendard SemiBold"';
  ctx.fillStyle = C.purple;
  ctx.fillText('자세한 내용은 스파크스코프 대시보드에서', W / 2, 410);
  ctx.textAlign = 'left';
  return canvas.toBuffer('image/png');
}
