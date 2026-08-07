// 사용자 노이즈 신고 요청 거절 — Article은 그대로 두고 신고 상태만 기록. 관리자 전용.
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

  const reportRequest = await prisma.noiseReportRequest.findUnique({ where: { id: params.id } });
  if (!reportRequest) return NextResponse.json({ error: '신고를 찾을 수 없습니다.' }, { status: 404 });
  if (reportRequest.status !== 'PENDING') return NextResponse.json({ error: '이미 처리된 신고입니다.' }, { status: 409 });

  await prisma.noiseReportRequest.update({
    where: { id: reportRequest.id },
    data: { status: 'REJECTED', resolvedAt: new Date(), resolvedBy: email },
  });

  return NextResponse.json({ ok: true });
}
