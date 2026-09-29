// 월·수·금 브리핑 잔디 알림 — 09:00(영상 있으면 전송) · 09:30(?final=1, 영상 없어도 헤드라인이라도 전송).
import { NextResponse } from 'next/server';
import { notifyBriefing } from '@/lib/briefing-video/notify';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const u = new URL(req.url);
  try {
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
