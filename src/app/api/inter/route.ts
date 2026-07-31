import { NextRequest, NextResponse } from 'next/server';
import { getDomainStats, getSectorData, DOMAIN_SUMMARY, type InterDomain } from '@/lib/inter-sample-data';

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

  const periodParam = req.nextUrl.searchParams.get('period') ?? '3m';
  const days = PERIOD_DAYS[periodParam] ?? PERIOD_DAYS['3m'];
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [stats, sectors] = await Promise.all([
    getDomainStats(domain, since),
    getSectorData(domain, since),
  ]);

  return NextResponse.json({
    summary: DOMAIN_SUMMARY[domain],
    stats,
    sectors,
  });
}
