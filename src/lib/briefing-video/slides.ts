/**
 * 브리핑 슬라이드 — 1280×720 PNG. 브라우저 없이 @napi-rs/canvas로 그린다(GitHub Actions에서도 같게 나오도록).
 * 폰트는 Pretendard(OFL) — node_modules/pretendard에서 읽는다.
 * 색은 대시보드와 같은 스파크 팔레트(tailwind.config: spark.*).
 */
import { createCanvas, GlobalFonts, type Image, type SKRSContext2D } from '@napi-rs/canvas';
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

/**
 * 한자 → 한글. Pretendard에는 한자 글리프가 없어 "日증시"의 日이 네모(□)로 깨졌다(2026-10-05 위클리,
 * 소윤 지적). 신문 제목에 쓰이는 약칭 한자만 그 뜻의 한글로 바꾼다. 목록에 없는 한자는 그대로 둔다.
 */
const HANJA: Record<string, string> = {
  日: '일', 美: '미', 中: '중', 韓: '한', 北: '북', 南: '남', 英: '영', 獨: '독', 佛: '불', 露: '러', 印: '인',
  臺: '대', 台: '대', 歐: '유럽', 與: '여', 野: '야', 靑: '청', 尹: '윤', 李: '이', 文: '문', 朴: '박', 金: '김',
  故: '고', 軍: '군', 銀: '은', 前: '전', 新: '신', 株: '주', 社: '사', 外: '외', 對: '대', 反: '반', 親: '친',
  兆: '조', 億: '억', 萬: '만', 上: '상', 下: '하', 現: '현', 副: '부', 總: '총', 大: '대', 小: '소', 高: '고',
  低: '저', 號: '호', 稅: '세', 法: '법', 國: '국', 政: '정', 檢: '검', 警: '경', 核: '핵', 車: '차',
};
export function hangulize(text: string): string {
  return text.replace(/[\u3400-\u9FFF\uF900-\uFAFF]/g, ch => HANJA[ch] ?? ch);
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
/** hostImage — 오른쪽 아래에 가만히 서 있는 진행자 그림(투명 PNG). 움직이는 GIF는 정신없다는 의견으로 바꿈(2026-10-01). */
export interface SlideOpts { program?: string; hostSpace?: boolean; hostImage?: Image }

function drawHost(ctx: SKRSContext2D, img: Image) {
  const w = 300;
  const h = Math.round((img.height / img.width) * w);
  ctx.drawImage(img, W - w - 30, H - h - 24, w, h);
}
const HOST_W = 340;

/**
 * 글이 칸에 다 들어가게 — 말줄임(…)으로 자르지 않는다(2026-10-01 소윤: "…으로 끊기면 안 된다").
 * 큰 글씨부터 줄여 보고, 그래도 넘치면 문장 단위로 앞에서부터 들어가는 만큼만 쓴다.
 */
function fitText(ctx: SKRSContext2D, text: string, maxWidth: number, maxLines: number, sizes: number[], weight: string)
  : { lines: string[]; size: number } {
  const fits = (t: string, size: number) => {
    ctx.font = `${size}px "Pretendard ${weight}"`;
    const lines = wrap(ctx, t, maxWidth, maxLines + 1);
    return lines.length <= maxLines && !lines.some(l => l.endsWith('…')) ? lines : null;
  };
  for (const size of sizes) {
    const lines = fits(text, size);
    if (lines) return { lines, size };
  }
  const size = sizes[sizes.length - 1];
  const sentences = text.match(/[^.!?。]+[.!?。]?/g)?.map(s => s.trim()).filter(Boolean) ?? [text];
  for (let n = sentences.length - 1; n >= 1; n--) {
    const lines = fits(sentences.slice(0, n).join(' '), size);
    if (lines) return { lines, size };
  }
  // 첫 문장조차 넘치면 어절 단위로 줄인다(말줄임표 없이).
  const words = sentences[0].split(/\s+/);
  for (let n = words.length - 1; n >= 1; n--) {
    const lines = fits(words.slice(0, n).join(' ').replace(/[,·]$/, ''), size);
    if (lines) return { lines, size };
  }
  ctx.font = `${size}px "Pretendard ${weight}"`;
  return { lines: wrap(ctx, text, maxWidth, maxLines), size };
}

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
    ctx.fillText(wrap(ctx, hangulize(h.title), textW, 1)[0] ?? '', 124, y);
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
  const label = h.label.replace(/^[\p{Extended_Pictographic}\p{Regional_Indicator}\uFE0F\s]+/u, ''); // 🇰🇷 국기도
  const lw = ctx.measureText(label).width + 40;
  ctx.fillStyle = C.purple;
  ctx.beginPath();
  ctx.roundRect(64, 270, lw, 50, 25);
  ctx.fill();
  ctx.fillStyle = C.white;
  ctx.fillText(label, 84, 305);
  // 제목
  const title = fitText(ctx, hangulize(h.title), textW, 3, [54, 48, 42], 'ExtraBold');
  ctx.fillStyle = C.ink;
  let y = 400;
  for (const line of title.lines) {
    ctx.fillText(line, 64, y);
    y += Math.round(title.size * 1.33);
  }
  // 요약 — 출처 줄(H-48) 위까지 남은 줄 수만큼
  y += 8;
  const room = Math.max(1, Math.min(3, Math.floor((H - 90 - y + 28) / 40)));
  const sum = fitText(ctx, hangulize(h.summary), textW, room, [28, 25], 'Regular');
  ctx.fillStyle = C.inkSoft;
  for (const line of sum.lines) {
    ctx.fillText(line, 64, y);
    y += Math.round(sum.size * 1.5);
  }
  // 출처 · 진행
  ctx.font = '22px "Pretendard SemiBold"';
  ctx.fillStyle = C.muted;
  ctx.fillText(hangulize(h.source), 64, H - 48);
  ctx.textAlign = 'right';
  ctx.fillText(`${index + 1} / ${total}`, W - 64 - (o.hostSpace ? HOST_W : 0), H - 48);
  ctx.textAlign = 'left';
  // 진행 막대
  ctx.fillStyle = '#E7E3DB';
  ctx.fillRect(0, H - 8, W, 8);
  ctx.fillStyle = C.purple;
  ctx.fillRect(0, H - 8, (W * (index + 1)) / total, 8);
  if (o.hostImage) drawHost(ctx, o.hostImage);
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
