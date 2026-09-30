/**
 * 브리핑 알림 — 잔디 Incoming Webhook으로 토픽에 링크를 보낸다(월·수·금 09:00, 못 보냈으면 09:30).
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

/** final=false(09:00)면 영상이 없을 때 기다리고, final=true(09:30)면 헤드라인만이라도 보낸다. */
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

  const page = `${opts.baseUrl.replace(/\/$/, '')}/briefing/${dateKey}`;
  const minutes = video ? `${Math.floor(video.seconds / 60)}분 ${video.seconds % 60}초` : '';
  const body = {
    body: video
      ? `🎬 [${spokenDate(dateKey)} 스파크스코프 데일리 브리핑](${page}) · ${minutes}`
      : `📰 [${spokenDate(dateKey)} 스파크스코프 데일리 브리핑](${page}) (오늘은 영상 없이 헤드라인만 보내 드립니다)`,
    connectColor: '#5046E5',
    connectInfo: headlines.map((h, i) => ({
      title: `${i + 1}. ${h.title}`,
      description: `${h.label.replace(/^[\p{Extended_Pictographic}️\s]+/u, '')} · ${h.source}`,
    })),
  };
  const r = await fetch(url, {
    method: 'POST',
    headers: { Accept: 'application/vnd.tosslab.jandi-v2+json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`잔디 전송 실패 ${r.status}: ${(await r.text()).slice(0, 200)}`);

  await prisma.dashboardInsight.upsert({
    where: { kind_key: { kind: KIND_NOTIFIED, key: dateKey } },
    create: { kind: KIND_NOTIFIED, key: dateKey, value: JSON.stringify({ at: new Date().toISOString(), withVideo: !!video }) },
    update: {},
  });
  return { status: 'sent', withVideo: !!video };
}

/**
 * 연결 확인용 테스트 메시지 — 오늘 발송 기록(briefing_notified)을 남기지 않는다.
 * 잔디 웹훅을 새로 넣거나 토픽을 바꿨을 때 /api/cron/briefing-notify?test=1 로 호출한다.
 */
export async function sendJandiTest(baseUrl: string): Promise<void> {
  const url = process.env.JANDI_WEBHOOK_URL;
  if (!url) throw new Error('JANDI_WEBHOOK_URL 이 설정돼 있지 않습니다(Vercel 환경변수 + 재배포 확인)');
  const r = await fetch(url, {
    method: 'POST',
    headers: { Accept: 'application/vnd.tosslab.jandi-v2+json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      body: `✅ [스파크스코프 데일리 브리핑 연결 테스트](${baseUrl.replace(/\/$/, '')}/digest/review)`,
      connectColor: '#5046E5',
      connectInfo: [
        { title: '연결 확인', description: '이 메시지가 보이면 잔디 연동이 정상입니다. 월·수·금 09:00에 브리핑 링크가 이 토픽으로 옵니다.' },
      ],
    }),
  });
  if (!r.ok) throw new Error(`잔디 전송 실패 ${r.status}: ${(await r.text()).slice(0, 200)}`);
}
