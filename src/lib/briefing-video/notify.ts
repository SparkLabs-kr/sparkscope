/**
 * 브리핑 알림 — 잔디 Incoming Webhook으로 토픽에 링크를 보낸다(월·수·금 10:45 — 10:30 메일 뒤, 못 보냈으면 11:15).
 *
 * 잔디 웹훅 주소(JANDI_WEBHOOK_URL)는 토픽 관리자가 잔디 토픽 → 커넥트 → Incoming Webhook에서
 * 발급한다. 주소만 있으면 누구나 그 토픽에 글을 쓸 수 있으므로 Vercel 환경변수로만 둔다.
 * 없으면 보내지 않고 기록만 남긴다(다른 파이프라인은 그대로 돈다).
 *
 * 하루 한 번만 보낸다 — 보낸 날은 DashboardInsight(briefing_notified)에 표시한다.
 */
import { prisma } from '@/lib/prisma';
import { kstDateKey, loadBriefingSnapshot } from '../sparkscope/briefing';
import { loadBriefingVideo } from './publish';
import { spokenDate } from './script';

const KIND_NOTIFIED = 'briefing_notified';

export type NotifyResult =
  | { status: 'sent'; withVideo: boolean }
  | { status: 'already-sent' | 'waiting-for-video' | 'no-webhook' | 'nothing-to-send' };

/** final=false(10:45)면 영상이 없을 때 기다리고, final=true(11:15)면 헤드라인만이라도 보낸다. */
export async function notifyBriefing(opts: { final: boolean; baseUrl: string }): Promise<NotifyResult> {
  const dateKey = kstDateKey();
  const done = await prisma.dashboardInsight.findUnique({ where: { kind_key: { kind: KIND_NOTIFIED, key: dateKey } } });
  if (done) return { status: 'already-sent' };

  const video = await loadBriefingVideo(dateKey);
  if (!video && !opts.final) return { status: 'waiting-for-video' };
  const headlines = video?.headlines ?? (await loadBriefingSnapshot(dateKey))?.headlines ?? [];
  if (headlines.length === 0) return { status: 'nothing-to-send' };

  const url = process.env.JANDI_WEBHOOK_URL;
  if (!url) {
    console.warn('[briefing-notify] JANDI_WEBHOOK_URL 없음 — 잔디 전송 건너뜀');
    return { status: 'no-webhook' };
  }

  await postJandi(url, briefingMessage({
    dateKey,
    titles: headlines.map(h => h.title),
    videoPage: video ? `${opts.baseUrl.replace(/\/$/, '')}/briefing/${dateKey}` : null,
    baseUrl: opts.baseUrl,
  }));

  await prisma.dashboardInsight.upsert({
    where: { kind_key: { kind: KIND_NOTIFIED, key: dateKey } },
    create: { kind: KIND_NOTIFIED, key: dateKey, value: JSON.stringify({ at: new Date().toISOString(), withVideo: !!video }) },
    update: {},
  });
  return { status: 'sent', withVideo: !!video };
}

/**
 * 메시지 형식 — 2026-09-30 소윤 확정. 카드(connectInfo) 없이 본문 한 덩어리로:
 *
 *   스파크스코프 데일리 브리핑 9.30
 *   1. (기사 제목)
 *   …
 *   5. (기사 제목)
 *   ▶ 영상 보기 (링크)          ← 영상이 없는 날은 이 줄이 빠진다
 *   스파크스코프 바로가기 (링크)
 */
export function briefingMessage(m: { dateKey: string; titles: string[]; videoPage: string | null; baseUrl: string }): string {
  const [, mm, dd] = m.dateKey.split('-').map(Number);
  const base = m.baseUrl.replace(/\/$/, '');
  return [
    `스파크스코프 데일리 브리핑 ${mm}.${dd}`,
    ...m.titles.map((t, i) => `${i + 1}. ${t}`),
    ...(m.videoPage ? [`[▶ 영상 보기](${m.videoPage})`] : []),
    `[스파크스코프 바로가기](${base}/dashboard)`,
  ].join('\n');
}

async function postJandi(url: string, body: string): Promise<void> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { Accept: 'application/vnd.tosslab.jandi-v2+json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ body }),
  });
  if (!r.ok) throw new Error(`잔디 전송 실패 ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

/**
 * 연결·형식 확인용 테스트 — 오늘 추천 헤드라인으로 실제와 같은 형식을 보낸다(맨 위에 [테스트] 표시).
 * 오늘 발송 기록(briefing_notified)은 남기지 않는다.
 */
export async function sendJandiTest(baseUrl: string): Promise<void> {
  const url = process.env.JANDI_WEBHOOK_URL;
  if (!url) throw new Error('JANDI_WEBHOOK_URL 이 설정돼 있지 않습니다(Vercel 환경변수 + 재배포 확인)');
  const dateKey = kstDateKey();
  const { getBriefingRecommendation } = await import('../sparkscope/briefing-reco');
  const snapshot = await loadBriefingSnapshot(dateKey);
  const titles = snapshot?.headlines.map(h => h.title)
    ?? (await getBriefingRecommendation().catch(() => null))?.headlines.map(h => h.title)
    ?? ['(오늘 헤드라인 없음)'];
  const video = await loadBriefingVideo(dateKey);
  await postJandi(url, `[테스트] ${briefingMessage({
    dateKey,
    titles,
    videoPage: `${baseUrl.replace(/\/$/, '')}/briefing/${dateKey}`,
    baseUrl,
  })}${video ? '' : '\n(테스트라 영상 링크는 아직 열리지 않을 수 있습니다)'}`);
}
