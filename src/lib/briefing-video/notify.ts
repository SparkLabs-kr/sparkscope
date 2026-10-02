/**
 * 브리핑 알림 — 잔디 Incoming Webhook으로 토픽에 링크를 보낸다(월·수·금 09:45 — 09:30 메일 뒤, 못 보냈으면 10:15). 월요일은 위클리, 수·금은 데일리.
 *
 * 잔디 웹훅 주소 — 데일리는 JANDI_WEBHOOK_URL, 위클리(월)는 JANDI_WEBHOOK_URL_WEEKLY(2026-10-02, 방을 따로 쓰려고).
 * 위클리 주소가 비어 있으면 데일리 주소로 보낸다(안 나가는 것보다 낫다). 주소는 토픽 관리자가 잔디 토픽 → 커넥트 → Incoming Webhook에서
 * 발급한다. 주소만 있으면 누구나 그 토픽에 글을 쓸 수 있으므로 Vercel 환경변수로만 둔다.
 * 없으면 보내지 않고 기록만 남긴다(다른 파이프라인은 그대로 돈다).
 *
 * 하루 한 번만 보낸다 — 보낸 날은 DashboardInsight(briefing_notified)에 표시한다.
 */
import { prisma } from '@/lib/prisma';
import { broadcastFor, kstDateKey, loadBriefingSnapshot } from '../sparkscope/briefing';
import { loadBriefingVideo } from './publish';
import { spokenDate } from './script';

const KIND_NOTIFIED = 'briefing_notified';

export type NotifyResult =
  | { status: 'sent'; withVideo: boolean }
  | { status: 'already-sent' | 'waiting-for-video' | 'no-webhook' | 'nothing-to-send' };

/** final=false(09:45)면 영상이 없을 때 기다리고, final=true(10:15)면 헤드라인만이라도 보낸다. */
export async function notifyBriefing(opts: { final: boolean; baseUrl: string }): Promise<NotifyResult> {
  const dateKey = kstDateKey();
  const done = await prisma.dashboardInsight.findUnique({ where: { kind_key: { kind: KIND_NOTIFIED, key: dateKey } } });
  if (done) return { status: 'already-sent' };

  const video = await loadBriefingVideo(dateKey);
  if (!video && !opts.final) return { status: 'waiting-for-video' };
  const snap = video ? null : await loadBriefingSnapshot(dateKey);
  const headlines = video?.headlines ?? snap?.headlines ?? [];
  const weekly = (video?.program ?? snap?.program) === 'weekly';
  if (headlines.length === 0) return { status: 'nothing-to-send' };

  const url = webhookFor(weekly);
  if (!url) {
    console.warn('[briefing-notify] 잔디 웹훅 주소 없음 — 잔디 전송 건너뜀');
    return { status: 'no-webhook' };
  }

  await postJandi(url, briefingMessage({
    dateKey,
    weekly,
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
 * 메시지 형식 — 2026-10-02 소윤 확정. 대제목(본문) + 내용 카드(connectInfo):
 *
 *   📰SparkScope 데일리 브리핑            ← 월요일은 "위클리 브리핑"
 *   ┃ 10월 2일 SparkScope 데일리브리핑
 *   ┃ 1. (기사 제목)
 *   ┃ …
 *   ┃ 📹 영상 보기 (링크)                 ← 영상이 없는 날은 이 줄이 빠진다
 *   ┃ 🔗SparkScope 대시보드 바로가기 (링크)
 */
export interface JandiMessage { body: string; connectColor: string; connectInfo: { title: string; description: string }[] }

export function briefingMessage(m: { dateKey: string; weekly?: boolean; titles: string[]; videoPage: string | null; baseUrl: string }): JandiMessage {
  const [, mm, dd] = m.dateKey.split('-').map(Number);
  const base = m.baseUrl.replace(/\/$/, '');
  const kind = m.weekly ? '위클리' : '데일리';
  return {
    body: `📰SparkScope ${kind} 브리핑`,
    connectColor: '#5046E5',
    connectInfo: [{
      title: `${mm}월 ${dd}일 SparkScope ${kind}브리핑`,
      description: [
        ...m.titles.map((t, i) => `${i + 1}. ${t}`),
        '',
        ...(m.videoPage ? [`[📹 영상 보기](${m.videoPage})`] : []),
        `[🔗SparkScope 대시보드 바로가기](${base}/dashboard)`,
      ].join('\n'),
    }],
  };
}

function webhookFor(weekly: boolean): string | undefined {
  return (weekly && process.env.JANDI_WEBHOOK_URL_WEEKLY) || process.env.JANDI_WEBHOOK_URL;
}

async function postJandi(url: string, msg: JandiMessage): Promise<void> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { Accept: 'application/vnd.tosslab.jandi-v2+json', 'Content-Type': 'application/json' },
    body: JSON.stringify(msg),
  });
  if (!r.ok) throw new Error(`잔디 전송 실패 ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

/**
 * 연결·형식 확인용 테스트 — 오늘 추천 헤드라인으로 실제와 같은 형식을 보낸다(맨 위에 [테스트] 표시).
 * 오늘 발송 기록(briefing_notified)은 남기지 않는다.
 */
export async function sendJandiTest(baseUrl: string): Promise<void> {
  const next = broadcastFor(); // 다음 방송(월=위클리, 수·금=데일리)의 방·형식으로
  const url = webhookFor(next.program === 'weekly');
  if (!url) throw new Error('JANDI_WEBHOOK_URL 이 설정돼 있지 않습니다(Vercel 환경변수 + 재배포 확인)');
  const dateKey = next.dateKey;
  const { getBriefingRecommendation } = await import('../sparkscope/briefing-reco');
  const snapshot = await loadBriefingSnapshot(dateKey);
  const titles = snapshot?.headlines.map(h => h.title)
    ?? (await getBriefingRecommendation().catch(() => null))?.headlines.map(h => h.title)
    ?? ['(오늘 헤드라인 없음)'];
  const video = await loadBriefingVideo(dateKey);
  const msg = briefingMessage({
    dateKey,
    weekly: next.program === 'weekly',
    titles,
    videoPage: `${baseUrl.replace(/\/$/, '')}/briefing/${dateKey}`,
    baseUrl,
  });
  msg.body = `[테스트] ${msg.body}${video ? '' : ' (테스트라 영상 링크는 아직 열리지 않을 수 있습니다)'}`;
  await postJandi(url, msg);
}
