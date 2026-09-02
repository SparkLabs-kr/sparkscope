// 대시보드용 기사 조회 API
//
// 포트폴리오사 계정(role=PORTFOLIO)은 자기 회사 기사만 볼 수 있다. 대시보드 화면에서
// 회사 필터를 고정하는 것과 별개로 이 API도 막아야 한다 — 여기가 열려 있으면
// 화면을 거치지 않고 전사 기사·집계를 그대로 받아갈 수 있다.
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/authz';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const days = Number(searchParams.get('days') ?? '7');
  const category = searchParams.get('category');
  const search = searchParams.get('search');
  const limit = Math.min(Number(searchParams.get('limit') ?? '50'), 200);

  const since = new Date();
  since.setDate(since.getDate() - days);

  // 계정 범위 — 관리자는 전체, 포트폴리오사 계정은 자기 회사(matchedKeyword)로 한정한다.
  // 소속 회사가 아직 연결되지 않은 계정은 어떤 기사도 받지 못한다(빈 결과).
  const scope: Record<string, unknown> =
    user.role === 'ADMIN' ? {} : { matchedKeyword: user.companyName ?? '__no_company__' };

  const base = { pubDate: { gte: since }, isNoise: false, ...scope };

  const where: any = { ...base };
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

  // KPI 계산 — 집계도 같은 계정 범위 안에서만 센다.
  const total = await prisma.article.count({ where: base });
  const sparklabsCount = await prisma.article.count({
    where: { ...base, category: 'sparklabs_self' },
  });
  const portfolioCount = await prisma.article.count({
    where: { ...base, category: 'portfolio_company' },
  });
  const pitchCount = await prisma.article.count({
    where: { ...base, pitchScore: { gte: 75 } },
  });

  // 매체별 분포 (TOP 10)
  const sourceGroups = await prisma.article.groupBy({
    by: ['source'],
    where: base,
    _count: { _all: true },
    orderBy: { _count: { source: 'desc' } },
    take: 10,
  });

  // 톤 분포
  const toneGroups = await prisma.article.groupBy({
    by: ['tone'],
    where: { ...base, category: 'portfolio_company' },
    _count: { _all: true },
  });

  // 피칭 기회 (점수 ≥ 60, 트렌드별 그룹) — 내부 기획용 지표라 관리자만.
  const pitches =
    user.role === 'ADMIN'
      ? await prisma.article.findMany({
          where: { ...base, pitchScore: { gte: 60 } },
          orderBy: { pitchScore: 'desc' },
          take: 20,
        })
      : [];

  return NextResponse.json({
    kpi: { total, sparklabsCount, portfolioCount, pitchCount },
    articles,
    sources: sourceGroups.map(s => ({ source: s.source, count: s._count._all })),
    tones: toneGroups.map(t => ({ tone: t.tone, count: t._count._all })),
    pitches,
  });
}
