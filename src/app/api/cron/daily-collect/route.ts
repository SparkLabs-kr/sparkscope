import { NextRequest, NextResponse } from 'next/server';
import { runDailyDigest } from '@/lib/sparkscope/runner';

const CRON_SECRET = process.env.CRON_SECRET || '';

export const maxDuration = 300; // Pro 플랜: 5분

export async function GET(request: NextRequest) {
  // CRON_SECRET 검증
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.replace('Bearer ', '');

  if (!token || token !== CRON_SECRET) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  try {
    // 수집 + 분석 + DB 저장 (발송 안 함)
    await runDailyDigest({
      send: false,        // 발송 안 함
      skipCollect: false, // 수집 수행
      dryRun: false,
    });

    return NextResponse.json(
      { message: 'Daily collection completed successfully' },
      { status: 200 }
    );
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);

    console.error('❌ Daily collection failed:', errorMsg);

    return NextResponse.json(
      { error: 'Daily collection failed', details: errorMsg },
      { status: 500 }
    );
  }
}
