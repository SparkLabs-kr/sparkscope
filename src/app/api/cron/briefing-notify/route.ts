// 월·수·금 브리핑 잔디 알림 — 09:45(영상 있으면 전송, 월=위클리·수금=데일리) · 10:15(?final=1, 영상 없어도 헤드라인이라도 전송) · ?test=1 연결 테스트.
import { NextResponse } from 'next/server';
import { notifyBriefing, sendJandiTest } from '@/lib/briefing-video/notify';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const u = new URL(req.url);
  try {
    // ?test=1 — 연결 확인용 테스트 메시지(발송 기록 안 남김)
    if (u.searchParams.get('test') === '1') {
      await sendJandiTest(process.env.NEXTAUTH_URL ?? u.origin);
      return NextResponse.json({ ok: true, status: 'test-sent' });
    }
    const result = await notifyBriefing({
      final: u.searchParams.get('final') === '1',
      baseUrl: process.env.NEXTAUTH_URL ?? u.origin,
    });
    console.log('[briefing-notify]', result);
    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    console.error('[briefing-notify] 실패:', e);
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
