import { NextRequest, NextResponse } from 'next/server';
import { seedKeywords } from '@/lib/sparkscope/seed-keywords';

const CRON_SECRET = process.env.CRON_SECRET || '';

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.replace('Bearer ', '');

  if (!token || token !== CRON_SECRET) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  try {
    const result = await seedKeywords();

    return NextResponse.json(
      { message: 'Keyword sync completed successfully', ...result },
      { status: 200 }
    );
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);

    console.error('❌ Keyword sync failed:', errorMsg);

    return NextResponse.json(
      { error: 'Keyword sync failed', details: errorMsg },
      { status: 500 }
    );
  }
}
