// 분석 오류 의심 기각 — Article은 그대로 두고 큐 상태만 기록.
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { canScrap } from '@/lib/scrap';

export const runtime = 'nodejs';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email ?? null;
  if (!canScrap(email)) return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });

  const flag = await prisma.analysisAuditFlag.findUnique({ where: { id: params.id } });
  if (!flag) return NextResponse.json({ error: '항목을 찾을 수 없습니다.' }, { status: 404 });
  if (flag.status !== 'PENDING') return NextResponse.json({ error: '이미 처리된 항목입니다.' }, { status: 409 });

  await prisma.analysisAuditFlag.update({
    where: { id: flag.id },
    data: { status: 'DISMISSED', resolvedAt: new Date(), resolvedBy: email },
  });

  return NextResponse.json({ ok: true });
}
