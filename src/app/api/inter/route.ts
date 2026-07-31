import { NextRequest, NextResponse } from 'next/server';
import { getDomainStats, getSectorData, DOMAIN_SUMMARY, type InterDomain } from '@/lib/inter-sample-data';

export async function GET(req: NextRequest) {
  const domainParam = req.nextUrl.searchParams.get('domain');
  const domain: InterDomain = domainParam === 'ai' ? 'ai' : 'bio';

  const [stats, sectors] = await Promise.all([
    getDomainStats(domain),
    getSectorData(domain),
  ]);

  return NextResponse.json({
    summary: DOMAIN_SUMMARY[domain],
    stats,
    sectors,
  });
}
