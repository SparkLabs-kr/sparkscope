// 대시보드용 기사 조회 API
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/authz';
import { getCompanyScope } from '@/lib/sparkscope/company-scope';

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

  // 포트폴리오사 계정은 자기 회사 보도만. 기준 조건(base)을 한 번 만들고
  // 이 파일의 모든 조회가 이것을 펼쳐 쓴다 — 조회마다 조건을 따로 쓰면
  // 한 곳을 놓쳤을 때 그대로 남의 회사 자료가 나간다.
  let scoped: Record<string, unknown> = {};
  if (gate.user.role !== 'ADMIN') {
    if (!gate.user.companyId) {
      return NextResponse.json({ error: 'no_company' }, { status: 403 });
    }
    const scope = await getCompanyScope(gate.user.companyId);
    if (!scope) return NextResponse.json({ error: 'no_company' }, { status: 403 });
    scoped = scope.where as Record<string, unknown>;
  }
  const base = { pubDate: { gte: since }, isNoise: false, ...scoped };

  const where: any = { ...base };
  // 포트폴리오사 계정에는 category 를 덮어쓰지 못하게 한다.
  if (category && gate.user.role === 'ADMIN') where.category = category;
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
    where: { ...base, ...(scoped.category ? {} : { category: 'sparklabs_self' }) },
  });
  const portfolioCount = await prisma.article.count({
    where: { ...base, ...(scoped.category ? {} : { category: 'portfolio_company' }) },
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
    where: { ...base, ...(scoped.category ? {} : { category: 'portfolio_company' }) },
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
