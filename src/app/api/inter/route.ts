import { NextRequest, NextResponse } from 'next/server';
import { getDomainStats, getSectorData, loadInterData, getDomainSummary, type InterCountry, type InterDomain } from '@/lib/inter-sample-data';

const PERIOD_DAYS: Record<string, number> = {
  '7d': 7,
  '1m': 30,
  '3m': 90,
  '1y': 365,
  '3y': 365 * 3,
};

export async function GET(req: NextRequest) {
  const domainParam = req.nextUrl.searchParams.get('domain');
  const domain: InterDomain = domainParam === 'ai' ? 'ai' : 'bio';

  const countryParam = req.nextUrl.searchParams.get('country') as InterCountry | null;
  const country: InterCountry = countryParam ?? 'all';

  const periodParam = req.nextUrl.searchParams.get('period') ?? '3m';
  const days = PERIOD_DAYS[periodParam] ?? PERIOD_DAYS['3m'];
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [data, summary] = await Promise.all([
    loadInterData(domain, since, country),
    getDomainSummary(domain),
  ]);
  const stats = getDomainStats(data);
  const sectors = getSectorData(domain, data);

  return NextResponse.json({ summary, stats, sectors });
}
