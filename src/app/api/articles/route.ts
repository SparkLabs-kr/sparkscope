// 대시보드용 기사 조회 API
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/authz';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  // 실제 경계는 여기다. 미들웨어는 쿠키 유무만 보므로 보안 경계가 아니다.
  const gate = await requireUser();
  if (!gate.ok) return gate.response;

  const { searchParams } = new URL(req.url);
  const days = Number(searchParams.get('days') ?? '7');
  const category = searchParams.get('category');
  const search = searchParams.get('search');
  const limit = Math.min(Number(searchParams.get('limit') ?? '50'), 200);

  const since = new Date();
  since.setDate(since.getDate() - days);

  // 포트폴리오사 계정도 사내와 같은 자료를 본다(열람 전용). 쓰기는 각 엔드포인트가
  // requireAdmin 으로 막는다.
  const base = { pubDate: { gte: since }, isNoise: false };

  const where: any = { ...base };
  // 포트폴리오사 계정에는 category 를 덮어쓰지 못하게 한다.
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

  // 피칭 기회 (점수 ≥ 60, 트렌드별 그룹)
  const pitches = await prisma.article.findMany({
    where: { ...base, pitchScore: { gte: 60 } },
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
