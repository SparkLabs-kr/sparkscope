/**
 * Claw-e 뉴스데스크(위클리 브리핑) — 매주 월요일 09:45, 데일리 대신 나간다.
 *
 * 기사 선정은 데일리와 같은 곳(briefing-reco.ts)에서 한다 — 월요일 방송은 broadcastFor()가
 * program='weekly'로 잡고, 지난주 화 00:00 ~ 일 24:00 기사에서 스파크랩·포트폴리오 우선,
 * 데일리와 같은 8칸으로 고른다(2026-10-07~). 대신 기사당 대본을 줄여 전체 3분 30초~4분, 최대 5분에 맞춘다(10-08 소윤).
 * 그래서 검수 화면의 [바꾸기]·저장도 데일리와 똑같이 먹고, 스냅샷·영상 기록·잔디 전송도 같은 길로 간다.
 *
 * 이 파일은 화면·목소리만 다르다 — 데일리와 같은 슬라이드(slides.ts)에 오른쪽 아래 Claw-e(정지 그림),
 * 오프닝은 타이틀 GIF, 마무리는 서울 야경 GIF. 에셋: assets/newsdesk/.
 */
import path from 'path';
import { loadImage } from '@napi-rs/canvas';
import { broadcastFor, type BriefingSnapshot } from '../sparkscope/briefing';
import { writeBriefingScript, type ScriptSegment } from './script';
import { synthesizeAll, type VoiceSpec } from './tts';
import { introSlide, itemSlide, outroSlide } from './slides';
import { renderVideo, silentWav, GAP_SECONDS, type Clip } from './render';
import { NEWS_BGM, OPENING_SECONDS } from './build';

const ASSETS = path.join(process.cwd(), 'assets/newsdesk');
const PROGRAM = 'Claw-e 뉴스데스크';

/** 목소리 — 2026-10-01 소윤·이수 확정: Leda(밝은 여성 앵커), 1.12배속. Orus·Achird·앵커 톤 시안과 비교해 고름. */
export const NEWSDESK_VOICE: VoiceSpec = {
  model: 'gemini-2.5-flash-tts',
  name: 'Leda',
  style: '밝고 친근한 주간 뉴스 진행자처럼, 또렷하고 경쾌하게 읽어 주세요.',
  speed: 1.12,
};

/** 방송일(월) → "9월 29일부터 10월 4일까지" */
export function weekLabel(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  return broadcastFor(new Date(Date.UTC(y, m - 1, d, -1))).label; // 그날 08:00 KST 기준
}

export interface BuiltNewsdesk {
  snapshot: BriefingSnapshot;
  segments: ScriptSegment[];
  file: string;
  seconds: number;
}

export async function buildNewsdeskVideo(opts: { outDir: string; snapshot: BriefingSnapshot }): Promise<BuiltNewsdesk> {
  const { snapshot } = opts;
  const label = weekLabel(snapshot.dateKey);
  console.log(`[newsdesk] ${label} · ${snapshot.headlines.length}개`);

  const segments = await writeBriefingScript(snapshot, {
    intro: `안녕하세요, 클로이 뉴스데스크의 클로이입니다! ${label}, 지난 한 주 꼭 짚어야 할 소식을 모아 왔어요.`,
    // 2026-10-01 소윤 확정 문구
    // Leda 1.12배속은 1초에 약 8자 — 기사당 170~210자(≈25초) × 8 + 인사·마무리 ≈ 3분 50초.
    length: '위의 250~330자 대신, 이번엔 기사마다 약 170~210자(3문장)로 씁니다: ① 팩트+숫자 → ② 누구에게 어떤 의미인지 → ③ 지켜볼 변수. 맥락 설명은 한 구절로 줄이세요.',
    outro: '오늘의 위클리 브리핑은 여기까지입니다. 자세한 내용은 이메일로 보내드린 스파크스코프에서 확인해 주세요. 함께해 주셔서 감사합니다. 다음 브리핑에서 뵙겠습니다!',
  });
  const { speeches, voice } = await synthesizeAll(segments.map(s => s.text), NEWSDESK_VOICE);
  console.log(`[newsdesk] 음성 ${voice}`);

  // 소식 화면의 Claw-e는 가만히 서 있는 그림 — 손 흔드는 GIF는 계속 움직여 정신없었다(2026-10-01 소윤).
  const o = { program: PROGRAM, hostSpace: true, hostImage: await loadImage(path.join(ASSETS, 'claw-e.png')) };
  const total = snapshot.headlines.length;
  const clips: Clip[] = [
    // 오프닝 — 타이틀 GIF 위로 뉴스 배경음악만(OPENING_SECONDS), 인사 동안엔 낮게 깔았다가 줄인다.
    { png: introSlide(label, snapshot.headlines, o), wav: silentWav(OPENING_SECONDS), seconds: OPENING_SECONDS,
      backgroundGif: path.join(ASSETS, 'title.gif'), bgm: { file: NEWS_BGM, start: 0, volume: 0.9 } },
    ...segments.map((s, i): Clip => ({
    png: s.kind === 'intro' ? introSlide(label, snapshot.headlines, o)
      : s.kind === 'outro' ? outroSlide(label, o)
      : itemSlide(label, snapshot.headlines[s.index!], s.index!, total, o),
    wav: speeches[i].wav,
    seconds: speeches[i].seconds,
    // 오프닝은 타이틀 GIF, 마무리는 서울 야경 엔딩 GIF.
    ...(s.kind === 'intro' ? { backgroundGif: path.join(ASSETS, 'title.gif'), bgm: { file: NEWS_BGM, start: OPENING_SECONDS + GAP_SECONDS, volume: 0.15, fadeOut: true } }
      : s.kind === 'outro' ? { backgroundGif: path.join(ASSETS, 'ending.gif') }
      : {}),
  }))];

  const file = path.join(opts.outDir, `newsdesk-${snapshot.dateKey}.mp4`);
  const seconds = await renderVideo(clips, path.join(opts.outDir, 'work'), file);
  console.log(`[newsdesk] 영상 ${seconds.toFixed(1)}초 → ${file}`);
  if (seconds > 300) console.warn(`[newsdesk] 5분 초과(${Math.round(seconds)}초) — 기사당 길이 지시를 더 줄여야 함`);
  return { snapshot, segments, file, seconds };
}
