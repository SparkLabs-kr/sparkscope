/**
 * Claw-e 뉴스데스크 — 매주 월요일, 지난 한 주 데일리 브리핑(월·수·금 × 5 = 최대 15개 소식) 중
 * 가장 중요한 5개를 다시 추려 Claw-e 캐릭터가 진행하는 영상으로 만든다.
 *
 * 선정 원칙(2026-10-01 소윤 결정):
 *   1순위 스파크랩·포트폴리오 소식 → 2순위 AI 트렌드 → 3순위 스타트업계 소식
 *   윗 순위부터 채우고, 같은 순위 안에서는 AI(gpt-4.1)가 중요도 순으로 고른다.
 * 재료는 이미 나간 데일리 스냅샷(DashboardInsight daily_briefing)뿐이라 새 기사를 찾지 않는다 —
 * 한 주 동안 영상으로 나간 것의 요약이다.
 *
 * 화면은 데일리와 같은 슬라이드(slides.ts)에 오른쪽 아래 Claw-e(손 흔드는 GIF)를 얹고,
 * 오프닝만 뉴스데스크 타이틀 GIF를 쓴다. 에셋: assets/newsdesk/.
 */
import path from 'path';
import OpenAI from 'openai';
import { prisma } from '@/lib/prisma';
import { kstDateKey, type BriefingHeadline, type BriefingSnapshot } from '../sparkscope/briefing';
import { titleKey } from '../sparkscope/briefing-reco';
import { writeBriefingScript, type ScriptSegment } from './script';
import { synthesizeAll, type VoiceSpec } from './tts';
import { introSlide, itemSlide, outroSlide, W, H } from './slides';
import { renderVideo, type Clip } from './render';

const KIND_WEEKLY = 'weekly_briefing';
const PICK = 5;
const ASSETS = path.join(process.cwd(), 'assets/newsdesk');
const PROGRAM = 'Claw-e 뉴스데스크';

/** 목소리 — 소윤이 샘플 6종 중 고르기 전까지 임시로 Leda(밝은 앵커). */
export const NEWSDESK_VOICE: VoiceSpec = {
  model: 'gemini-2.5-flash-tts',
  name: 'Leda',
  style: '밝고 친근한 주간 뉴스 진행자처럼, 또렷하고 경쾌하게 읽어 주세요.',
  speed: 1.12,
};

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/** 1 스파크랩·포트폴리오 · 2 AI 트렌드 · 3 스타트업계(그 밖) */
function tierOf(h: BriefingHeadline): number {
  if (/스파크랩|포트폴리오/.test(h.label)) return 1;
  if (/AI|트렌드|해외/.test(h.label) || h.kind === 'trend' || h.kind === 'inter') return 2;
  return 3;
}

/** "9월 28일부터 10월 4일까지" — 지난주 월요일~일요일 */
function weekRange(dateKey: string): { keys: string[]; label: string } {
  const [y, m, d] = dateKey.split('-').map(Number);
  const day = (n: number) => new Date(Date.UTC(y, m - 1, d - n));
  const keys = Array.from({ length: 7 }, (_, i) => day(7 - i).toISOString().slice(0, 10));
  const f = (t: Date) => `${t.getUTCMonth() + 1}월 ${t.getUTCDate()}일`;
  return { keys, label: `${f(day(7))}부터 ${f(day(1))}까지` };
}

/** 같은 순위 안 중요도 순서 — AI가 못 하면 원래 순서(날짜순) 그대로. */
async function rankWithin(items: BriefingHeadline[]): Promise<BriefingHeadline[]> {
  if (items.length <= 1) return items;
  try {
    const resp = await openai.chat.completions.create({
      model: 'gpt-4.1',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: '스파크랩(한국 액셀러레이터·VC) 임직원에게 지난 한 주 가장 중요했던 소식 순서로 번호를 정렬하세요. 투자·인수·대형 계약·정책 변화처럼 파급력이 큰 소식이 먼저입니다. JSON으로만: {"order":[번호,...]}' },
        { role: 'user', content: items.map((h, i) => `${i}. ${h.title} — ${h.summary}`).join('\n') },
      ],
    });
    const order = (JSON.parse(resp.choices[0]?.message?.content ?? '{}').order ?? []) as number[];
    const ranked = order.map(i => items[i]).filter(Boolean);
    return [...new Set([...ranked, ...items])];
  } catch (e) {
    console.warn('[newsdesk] 순위 AI 실패 — 날짜순으로 둡니다:', e);
    return items;
  }
}

/** 지난주 데일리 스냅샷에서 5개를 추린다. */
export async function selectWeekly(dateKey = kstDateKey()): Promise<BriefingSnapshot & { weekLabel: string; pool: number }> {
  const { keys, label } = weekRange(dateKey);
  const rows = await prisma.dashboardInsight.findMany({
    where: { kind: 'daily_briefing', key: { in: keys } },
    orderBy: { key: 'asc' },
    select: { value: true },
  });
  // 같은 기사(스파크랩 기사는 여러 날 다시 나갈 수 있다)는 한 번만.
  const seen = new Set<string>();
  const pool: BriefingHeadline[] = [];
  for (const r of rows) {
    try {
      for (const h of (JSON.parse(r.value) as BriefingSnapshot).headlines) {
        const k = titleKey(h.title);
        if (!seen.has(k) && !seen.has(h.url)) { seen.add(k); seen.add(h.url); pool.push(h); }
      }
    } catch { /* 깨진 행은 무시 */ }
  }
  const picked: BriefingHeadline[] = [];
  for (const tier of [1, 2, 3]) {
    if (picked.length >= PICK) break;
    const ranked = await rankWithin(pool.filter(h => tierOf(h) === tier));
    picked.push(...ranked.slice(0, PICK - picked.length));
  }
  return {
    dateKey,
    dateLabel: label,
    headlines: picked,
    source: 'auto',
    computedAt: new Date().toISOString(),
    weekLabel: label,
    pool: pool.length,
  };
}

export async function saveWeekly(s: BriefingSnapshot): Promise<void> {
  const value = JSON.stringify(s);
  await prisma.dashboardInsight.upsert({
    where: { kind_key: { kind: KIND_WEEKLY, key: s.dateKey } },
    create: { kind: KIND_WEEKLY, key: s.dateKey, value },
    update: { value },
  });
}

export interface BuiltNewsdesk {
  snapshot: BriefingSnapshot;
  segments: ScriptSegment[];
  file: string;
  seconds: number;
}

export async function buildNewsdeskVideo(opts: { outDir: string; dateKey?: string }): Promise<BuiltNewsdesk> {
  const snapshot = await selectWeekly(opts.dateKey);
  if (snapshot.headlines.length === 0) throw new Error('지난주 데일리 브리핑 기록이 없습니다 — 뉴스데스크를 만들 수 없음');
  console.log(`[newsdesk] ${snapshot.weekLabel} · 후보 ${snapshot.pool}개 중 ${snapshot.headlines.length}개`);

  const segments = await writeBriefingScript(snapshot, {
    intro: `안녕하세요, 클로이 뉴스데스크의 클로이입니다! ${snapshot.weekLabel}, 지난 한 주 꼭 짚어야 할 소식을 모아 왔어요.`,
    // 2026-10-01 소윤 확정 문구
    outro: '오늘의 위클리 브리핑은 여기까지입니다. 자세한 내용은 이메일로 보내드린 스파크스코프에서 확인해 주세요. 함께해 주셔서 감사합니다. 다음 브리핑에서 뵙겠습니다!',
  });
  const { speeches, voice } = await synthesizeAll(segments.map(s => s.text), NEWSDESK_VOICE);
  console.log(`[newsdesk] 음성 ${voice}`);

  const o = { program: PROGRAM, hostSpace: true };
  const host = { file: path.join(ASSETS, 'claw-e-wave.gif'), w: 320, x: W - 330, y: H - 340 };
  const total = snapshot.headlines.length;
  const clips: Clip[] = segments.map((s, i) => ({
    png: s.kind === 'intro' ? introSlide(snapshot.weekLabel, snapshot.headlines, o)
      : s.kind === 'outro' ? outroSlide(snapshot.weekLabel, o)
      : itemSlide(snapshot.weekLabel, snapshot.headlines[s.index!], s.index!, total, o),
    wav: speeches[i].wav,
    seconds: speeches[i].seconds,
    // 오프닝은 타이틀 GIF, 마무리는 서울 야경 엔딩 GIF, 소식 화면엔 손 흔드는 Claw-e.
    ...(s.kind === 'intro' ? { backgroundGif: path.join(ASSETS, 'title.gif') }
      : s.kind === 'outro' ? { backgroundGif: path.join(ASSETS, 'ending.gif') }
      : { overlayGif: host }),
  }));

  const file = path.join(opts.outDir, `newsdesk-${snapshot.dateKey}.mp4`);
  const seconds = await renderVideo(clips, path.join(opts.outDir, 'work'), file);
  console.log(`[newsdesk] 영상 ${seconds.toFixed(1)}초 → ${file}`);
  return { snapshot, segments, file, seconds };
}
