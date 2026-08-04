import { NextRequest, NextResponse } from 'next/server';
import {
  buildMatrix,
  buildOverview,
  getDomainStats,
  getSectorData,
  loadInterData,
  getDomainSummary,
  type InterCountry,
  type InterDomain,
} from '@/lib/inter-sample-data';

export const runtime = 'nodejs';
// DB(Supabase)와 같은 리전에서 돌게 — 대시보드(page.tsx)와 동일한 이유.
export const preferredRegion = 'icn1';

const COUNTRIES: InterCountry[] = ['us', 'cn', 'jp', 'sa', 'other', 'all'];

function isValidYmd(s: string | null): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
}

// 프리셋(period) 하위호환 — from/to가 없을 때만 쓴다.
const PERIOD_DAYS: Record<string, number> = { '7d': 7, '1m': 30, '3m': 90, '1y': 365, '3y': 365 * 3 };

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const domain: InterDomain = sp.get('domain') === 'ai' ? 'ai' : 'bio';
  const countryParam = sp.get('country') as InterCountry | null;
  const country: InterCountry = countryParam && COUNTRIES.includes(countryParam) ? countryParam : 'all';

  const fromParam = sp.get('from');
  const toParam = sp.get('to');
  let since: Date;
  let until: Date;
  if (isValidYmd(fromParam) && isValidYmd(toParam)) {
    const [a, b] = fromParam <= toParam ? [fromParam, toParam] : [toParam, fromParam];
    since = new Date(`${a}T00:00:00`);
    until = new Date(`${b}T23:59:59`);
  } else {
    const days = PERIOD_DAYS[sp.get('period') ?? '3m'] ?? PERIOD_DAYS['3m'];
    until = new Date();
    since = new Date(until.getTime() - days * 86400000);
  }

  const [data, summary] = await Promise.all([
    loadInterData(domain, since, until, country),
    getDomainSummary(domain),
  ]);
  const stats = getDomainStats(data);
  const sectors = getSectorData(domain, data);
  const overview = buildOverview(domain, data, sectors);
  const matrix = buildMatrix(domain, data);

  return NextResponse.json({ summary, overview, stats, sectors, matrix });
}
