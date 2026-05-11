// 대시보드용 기사 조회 API
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const days = Number(searchParams.get('days') ?? '7');
  const category = searchParams.get('category');
  const search = searchParams.get('search');
  const limit = Math.min(Number(searchParams.get('limit') ?? '50'), 200);

  const since = new Date();
  since.setDate(since.getDate() - days);

  const where: any = { pubDate: { gte: since }, isNoise: false };
  if (category) where.category = category;
  if (search) {
    where.OR = [
      { title: { contains: search } },
      { matchedKeyword: { contains: search } },
      { source: { contains: search } },
    ];
  }

  const articles = await prisma.article.findMany({
    where,
    orderBy: [{ priorityScore: 'desc' }, { pubDate: 'desc' }],
    take: limit,
  });

  // KPI 계산
  const total = await prisma.article.count({ where: { pubDate: { gte: since }, isNoise: false } });
  const sparklabsCount = await prisma.article.count({
    where: { pubDate: { gte: since }, isNoise: false, category: { in: ['sparklabs_self', 'sparklabs_executive'] } },
  });
  const portfolioCount = await prisma.article.count({
    where: { pubDate: { gte: since }, isNoise: false, category: 'portfolio_company' },
  });
  const pitchCount = await prisma.article.count({
    where: { pubDate: { gte: since }, isNoise: false, pitchScore: { gte: 75 } },
  });

  // 매체별 분포 (TOP 10)
  const sourceGroups = await prisma.article.groupBy({
    by: ['source'],
    where: { pubDate: { gte: since }, isNoise: false },
    _count: { _all: true },
    orderBy: { _count: { source: 'desc' } },
    take: 10,
  });

  // 톤 분포
  const toneGroups = await prisma.article.groupBy({
    by: ['tone'],
    where: { pubDate: { gte: since }, isNoise: false, category: 'portfolio_company' },
    _count: { _all: true },
  });

  // 피칭 기회 (점수 ≥ 60, 트렌드별 그룹)
  const pitches = await prisma.article.findMany({
    where: { pubDate: { gte: since }, isNoise: false, pitchScore: { gte: 60 } },
    orderBy: { pitchScore: 'desc' },
    take: 20,
  });

  return NextResponse.json({
    kpi: { total, sparklabsCount, portfolioCount, pitchCount },
    articles,
    sources: sourceGroups.map(s => ({ source: s.source, count: s._count._all })),
    tones: toneGroups.map(t => ({ tone: t.tone, count: t._count._all })),
    pitches,
  });
}
