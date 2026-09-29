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

function base(dateLabel: string) {
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
  ctx.fillText('데일리 브리핑', 222, 72);
  ctx.textAlign = 'right';
  ctx.fillText(dateLabel, W - 64, 72);
  ctx.textAlign = 'left';
  return { canvas, ctx };
}

export function introSlide(dateLabel: string, headlines: BriefingHeadline[]): Buffer {
  const { canvas, ctx } = base(dateLabel);
  ctx.font = '64px "Pretendard ExtraBold"';
  ctx.fillStyle = C.ink;
  ctx.fillText('오늘의 헤드라인', 64, 190);
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
    ctx.fillText(wrap(ctx, h.title, W - 200, 1)[0] ?? '', 124, y);
    y += 82;
  });
  return canvas.toBuffer('image/png');
}

export function itemSlide(dateLabel: string, h: BriefingHeadline, index: number, total: number): Buffer {
  const { canvas, ctx } = base(dateLabel);
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
  for (const line of wrap(ctx, h.title, W - 128, 3)) {
    ctx.fillText(line, 64, y);
    y += 72;
  }
  // 요약
  ctx.font = '28px "Pretendard Regular"';
  ctx.fillStyle = C.inkSoft;
  y += 8;
  for (const line of wrap(ctx, h.summary, W - 128, 2)) {
    ctx.fillText(line, 64, y);
    y += 42;
  }
  // 출처 · 진행
  ctx.font = '22px "Pretendard SemiBold"';
  ctx.fillStyle = C.muted;
  ctx.fillText(h.source, 64, H - 48);
  ctx.textAlign = 'right';
  ctx.fillText(`${index + 1} / ${total}`, W - 64, H - 48);
  ctx.textAlign = 'left';
  // 진행 막대
  ctx.fillStyle = '#E7E3DB';
  ctx.fillRect(0, H - 8, W, 8);
  ctx.fillStyle = C.purple;
  ctx.fillRect(0, H - 8, (W * (index + 1)) / total, 8);
  return canvas.toBuffer('image/png');
}

export function outroSlide(dateLabel: string): Buffer {
  const { canvas, ctx } = base(dateLabel);
  ctx.textAlign = 'center';
  ctx.font = '60px "Pretendard ExtraBold"';
  ctx.fillStyle = C.ink;
  ctx.fillText('좋은 하루 보내세요', W / 2, 340);
  ctx.font = '30px "Pretendard SemiBold"';
  ctx.fillStyle = C.purple;
  ctx.fillText('자세한 내용은 SparkScope에서', W / 2, 410);
  ctx.textAlign = 'left';
  return canvas.toBuffer('image/png');
}
