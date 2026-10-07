/**
 * 데일리 브리핑 영상 한 편을 만든다 — 스냅샷 준비 → 대본 → 음성 → 슬라이드 → MP4.
 * GitHub Actions(daily-briefing.yml)와 로컬(scripts/build-briefing.ts)이 같은 함수를 쓴다.
 */
import path from 'path';
import { loadSendArticles, buildDigestForSend } from '../sparkscope/runner';
import { publishBriefingSnapshot, loadBriefingSnapshot, kstDateKey, type BriefingSnapshot } from '../sparkscope/briefing';
import { getBriefingRecommendation } from '../sparkscope/briefing-reco';
import type { AnalyzedArticle } from '../sparkscope/types';
import { writeBriefingScript, spokenDate, type ScriptSegment } from './script';
import { synthesizeAll } from './tts';
import { introSlide, itemSlide, outroSlide, openingSlide } from './slides';
import { renderVideo, silentWav, GAP_SECONDS, type Clip } from './render';

/** 오프닝 배경음악 — scripts/make-news-bgm.py로 만든 자체 제작 음원(저작권 걱정 없음). 다른 음원을 쓰려면 이 파일만 바꾸면 된다. */
export const NEWS_BGM = path.join(process.cwd(), 'assets/briefing/news-bgm.wav');
export const OPENING_SECONDS = 3.2;

/**
 * 오늘 헤드라인 스냅샷을 새로 만든다 — 09:30 메일과 같은 재료·같은 조립(buildDigestForSend)에서
 * 편집자 저장 → 추천 → 메일 TOP3 순으로 고른다. 영상은 이 시점의 결과로 확정된다.
 */
export async function prepareSnapshot(): Promise<BriefingSnapshot> {
  const raw = await loadSendArticles();
  const analyzed: AnalyzedArticle[] = (raw as any[]).map(a => ({
    ...a,
    relatedCompanies: typeof a.relatedCompanies === 'string' ? JSON.parse(a.relatedCompanies) : (a.relatedCompanies ?? []),
  }));
  const data = await buildDigestForSend(analyzed);
  const reco = await getBriefingRecommendation().catch(e => {
    console.error('[briefing] 추천 실패 — 메일 TOP3 기반으로 대신합니다:', e);
    return null;
  });
  return publishBriefingSnapshot(data, reco?.headlines ?? null);
}

export interface BuiltBriefing {
  snapshot: BriefingSnapshot;
  segments: ScriptSegment[];
  file: string;
  seconds: number;
}

export async function buildBriefingVideo(opts: { outDir: string; prepare?: boolean }): Promise<BuiltBriefing> {
  const snapshot = opts.prepare
    ? await prepareSnapshot()
    : (await loadBriefingSnapshot()) ?? (await prepareSnapshot());
  if (snapshot.headlines.length === 0) throw new Error('헤드라인이 없습니다 — 영상을 만들 수 없음');
  console.log(`[briefing] ${snapshot.program ?? 'daily'} 헤드라인 ${snapshot.headlines.length}건 (${snapshot.source})`);
  // 월요일은 위클리(Claw-e 뉴스데스크) — 같은 스냅샷을 다른 화면·목소리로.
  if (snapshot.program === 'weekly') {
    const { buildNewsdeskVideo } = await import('./newsdesk');
    return buildNewsdeskVideo({ outDir: opts.outDir, snapshot });
  }

  const segments = await writeBriefingScript(snapshot);
  console.log(`[briefing] 대본 ${segments.reduce((n, s) => n + s.text.length, 0)}자`);

  const dateLabel = spokenDate(snapshot.dateKey);
  const total = snapshot.headlines.length;
  // 음성은 하나씩 — 동시에 보내면 Gemini TTS 분당 한도(429)에 걸린다(tts.ts synthesizeAll).
  const { speeches, voice } = await synthesizeAll(segments.map(s => s.text));
  console.log(`[briefing] 음성 ${voice}`);
  const clips: Clip[] = [
    // 오프닝 — 말 없이 뉴스 배경음악 + 타이틀 화면(OPENING_SECONDS), 이어지는 인사 동안 음악을 낮게 깔고 끝에서 줄인다.
    { png: openingSlide(dateLabel), wav: silentWav(OPENING_SECONDS), seconds: OPENING_SECONDS, bgm: { file: NEWS_BGM, start: 0, volume: 0.9 } },
    ...segments.map((s, i): Clip => ({
      png: s.kind === 'intro' ? introSlide(dateLabel, snapshot.headlines)
        : s.kind === 'outro' ? outroSlide(dateLabel)
        : itemSlide(dateLabel, snapshot.headlines[s.index!], s.index!, total),
      wav: speeches[i].wav,
      seconds: speeches[i].seconds,
      ...(s.kind === 'intro' ? { bgm: { file: NEWS_BGM, start: OPENING_SECONDS + GAP_SECONDS, volume: 0.15, fadeOut: true } } : {}),
    })),
  ];

  const file = path.join(opts.outDir, `briefing-${snapshot.dateKey || kstDateKey()}.mp4`);
  const seconds = await renderVideo(clips, path.join(opts.outDir, 'work'), file);
  console.log(`[briefing] 영상 ${seconds.toFixed(1)}초 → ${file}`);
  return { snapshot, segments, file, seconds };
}
