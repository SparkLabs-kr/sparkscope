// 발송 전용 엔드포인트 (이미 분류된 데이터를 빠르게 발송)
// 시간: 자동 발송(월·수·금 09:00 KST) 또는 수동 트리거
// 특징: 수집/분석 생략 → 초고속(5초), 타임아웃 불가
import { NextResponse } from 'next/server';
import { runDailyDigest } from '@/lib/sparkscope/runner';

export const runtime = 'nodejs';
// 발송만 하므로 원래 60초였는데, AI 시그널 섹션이 사전계산을 못 찾으면 그 자리에서
// 목록을 만든다(signal-feed.ts). 그게 최악의 경우 2분 넘게 걸려서 60초로는 발송
// 전체가 타임아웃될 수 있다. 넉넉히 잡는다 — 평소에는 사전계산을 읽어 1초도 안 걸린다.
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
    console.log('[cron:daily-send-only] 발송 전용 모드 실행');
    const result = await runDailyDigest({
      send: true,
      skipCollect: true, // 🔑 핵심: 수집 건너뛰고 기존 데이터만 사용
      baseUrl,
    });

    console.log('[cron:daily-send-only] 발송 완료:', result);
    return NextResponse.json({
      ok: true,
      message: 'Digest sent successfully (send-only mode)',
      result,
    });
  } catch (e: any) {
    console.error('[cron:daily-send-only] 실패:', e);
    return NextResponse.json(
      { ok: false, error: String(e?.message ?? e) },
      { status: 500 },
    );
  }
}
