// Vercel Cron이 매주 월·수·금 09:00 KST (= 00:00 UTC)에 호출.
// 수집·분석 후 다이제스트를 전사 그룹(DIGEST_TO_GROUP)에 발송, 담당자는 BCC.
// 발송 직전 발신 도메인 인증 여부를 확인해 미인증이면 전원 발송을 스킵한다(runner 내부).
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
