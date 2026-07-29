import { NextRequest, NextResponse } from 'next/server';
import { importMediaSheet } from '@/lib/sparkscope/sheet-import';

const CRON_SECRET = process.env.CRON_SECRET || '';
const GOOGLE_SHEETS_API_KEY = process.env.GOOGLE_SHEETS_API_KEY || '';

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

  if (!GOOGLE_SHEETS_API_KEY) {
    return NextResponse.json(
      { error: 'GOOGLE_SHEETS_API_KEY not set' },
      { status: 500 }
    );
  }

  try {
    const result = await importMediaSheet(GOOGLE_SHEETS_API_KEY);

    return NextResponse.json(
      { message: 'Media sheet sync completed successfully', ...result },
      { status: 200 }
    );
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);

    console.error('❌ Media sheet sync failed:', errorMsg);

    return NextResponse.json(
      { error: 'Media sheet sync failed', details: errorMsg },
      { status: 500 }
    );
  }
}
