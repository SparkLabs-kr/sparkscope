// Vercel Cron이 매주 월·수·금 08:30 KST (= 일·화·목 23:30 UTC)에 호출.
// 30분간 수집·분석을 마치고 발송이 09:00 KST에 떨어지도록 즉시 실행.
import { NextResponse } from 'next/server';
import { runDailyDigest } from '@/lib/sparkscope/runner';

// Edge가 아닌 Node 런타임 (Prisma 호환)
export const runtime = 'nodejs';
// Vercel Cron 최대 실행 시간 (Pro 플랜 기준)
export const maxDuration = 300;

export async function GET(req: Request) {
  // 인증: Vercel Cron이 보내는 Authorization 헤더 검증
  const authHeader = req.headers.get('authorization');
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (authHeader !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const baseUrl = process.env.NEXTAUTH_URL ?? new URL(req.url).origin;

  try {
    const result = await runDailyDigest({
      send: true,
      baseUrl,
    });
    return NextResponse.json(result);
  } catch (e: any) {
    console.error('[cron] daily-digest failed:', e);
    return NextResponse.json(
      { ok: false, error: String(e?.message ?? e) },
      { status: 500 },
    );
  }
}
