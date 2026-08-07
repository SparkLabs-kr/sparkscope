// 일반 사용자의 노이즈 신고 요청 접수 — 관리자의 즉시 처리(/api/noise-report)와 달리 여기선
// Article을 건드리지 않고 NoiseReportRequest만 PENDING으로 쌓는다. 로그인만 하면(관리자 권한 불필요)
// 누구나 요청할 수 있다. 승인/거절은 /api/noise-report-requests/[id]/approve|reject(관리자 전용).
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email ?? null;
  if (!email) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const b = await req.json().catch(() => null);
  const articleId = typeof b?.articleId === 'string' ? b.articleId : null;
  const reason = typeof b?.reason === 'string' ? b.reason.trim() : '';
  if (!articleId) return NextResponse.json({ error: 'articleId는 필수입니다.' }, { status: 400 });
  if (!reason) return NextResponse.json({ error: '신고 사유를 입력해주세요.' }, { status: 400 });

  const article = await prisma.article.findUnique({ where: { id: articleId }, select: { id: true } });
  if (!article) return NextResponse.json({ error: '기사를 찾을 수 없습니다.' }, { status: 404 });

  const existing = await prisma.noiseReportRequest.findFirst({
    where: { articleId, reportedBy: email, status: 'PENDING' },
  });
  if (existing) return NextResponse.json({ error: '이미 신고 접수된 기사입니다. 관리자 검토를 기다려주세요.' }, { status: 409 });

  await prisma.noiseReportRequest.create({ data: { articleId, reportedBy: email, reason } });

  return NextResponse.json({ ok: true });
}
