// 감시대상(MonitoringTarget) CRUD API — 키워드 셀프 관리용.
// 삭제는 소프트 삭제(status='DELETED')로 처리해 자동 백업(복구 가능).
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { OPEN_ACCESS } from '@/lib/flags';

export const runtime = 'nodejs';

const CATEGORIES = ['sparklabs_self', 'portfolio_company', 'competitor', 'industry_trend'];

async function authorized(): Promise<boolean> {
  if (OPEN_ACCESS) return true;
  const session = await getServerSession(authOptions);
  return !!session?.user?.email;
}

function bad(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status });
}

export async function GET(req: Request) {
  if (!(await authorized())) return bad('Unauthorized', 401);
  const category = new URL(req.url).searchParams.get('category');
  const where: any = { status: { not: 'DELETED' } };
  if (category && CATEGORIES.includes(category)) where.category = category;

  const targets = await prisma.monitoringTarget.findMany({ where, orderBy: [{ category: 'asc' }, { name: 'asc' }] });
  const counts = await prisma.monitoringTarget.groupBy({
    by: ['category'],
    where: { status: { not: 'DELETED' } },
    _count: true,
  });
  return NextResponse.json({
    targets,
    counts: Object.fromEntries(counts.map(c => [c.category, (c as any)._count])),
  });
}

export async function POST(req: Request) {
  if (!(await authorized())) return bad('Unauthorized', 401);
  const b = await req.json().catch(() => null);
  if (!b) return bad('Invalid body');
  const name = (b.name ?? '').trim();
  if (!name) return bad('기업/키워드명(name)은 필수입니다.');
  if (!CATEGORIES.includes(b.category)) return bad('유효하지 않은 카테고리입니다.');

  const exists = await prisma.monitoringTarget.findUnique({ where: { name } });
  if (exists && exists.status !== 'DELETED') return bad('이미 존재하는 이름입니다.', 409);

  const data = {
    name,
    englishName: b.englishName?.trim() || null,
    category: b.category,
    status: 'ACTIVE',
    primaryKeyword: (b.primaryKeyword?.trim() || name),
    helperKeywords: b.helperKeywords?.trim() || null,
    excludeWords: b.excludeWords?.trim() || null,
    notes: b.notes?.trim() || null,
  };
  // 소프트 삭제됐던 이름이면 되살리며 갱신
  const target = exists
    ? await prisma.monitoringTarget.update({ where: { name }, data })
    : await prisma.monitoringTarget.create({ data });
  return NextResponse.json({ target });
}

export async function PATCH(req: Request) {
  if (!(await authorized())) return bad('Unauthorized', 401);
  const b = await req.json().catch(() => null);
  if (!b?.id) return bad('id는 필수입니다.');
  if (b.category && !CATEGORIES.includes(b.category)) return bad('유효하지 않은 카테고리입니다.');

  const data: any = {};
  for (const f of ['englishName', 'primaryKeyword', 'helperKeywords', 'excludeWords', 'notes'] as const) {
    if (f in b) data[f] = b[f]?.trim() || null;
  }
  if (b.name?.trim()) data.name = b.name.trim();
  if (b.category) data.category = b.category;
  if (b.status && ['ACTIVE', 'PAUSED', 'EXIT'].includes(b.status)) data.status = b.status;

  const target = await prisma.monitoringTarget.update({ where: { id: b.id }, data });
  return NextResponse.json({ target });
}

export async function DELETE(req: Request) {
  if (!(await authorized())) return bad('Unauthorized', 401);
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return bad('id는 필수입니다.');
  // 소프트 삭제 (복구 가능) — 수집 대상에서 자동 제외됨
  await prisma.monitoringTarget.update({ where: { id }, data: { status: 'DELETED' } });
  return NextResponse.json({ ok: true });
}
