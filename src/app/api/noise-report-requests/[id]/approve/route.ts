// 사용자 노이즈 신고 요청 승인 — 관리자가 직접 노이즈 신고(/api/noise-report)한 것과 동일하게
// Article.isNoise=true 처리 + AI 재발방지 제안 생성까지 이어서 수행한다. 스크랩과 동일 권한(관리자 전용).
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { canScrap } from '@/lib/scrap';
import { suggestNoiseFilterFix } from '@/lib/sparkscope/noise-suggestion';

export const runtime = 'nodejs';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email ?? null;
  if (!canScrap(email)) return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });

  const reportRequest = await prisma.noiseReportRequest.findUnique({ where: { id: params.id } });
  if (!reportRequest) return NextResponse.json({ error: '신고를 찾을 수 없습니다.' }, { status: 404 });
  if (reportRequest.status !== 'PENDING') return NextResponse.json({ error: '이미 처리된 신고입니다.' }, { status: 409 });

  await prisma.article.update({
    where: { id: reportRequest.articleId },
    data: { isNoise: true, noiseReason: 'user_report' },
  });
  await prisma.noiseReportRequest.update({
    where: { id: reportRequest.id },
    data: { status: 'APPROVED', resolvedAt: new Date(), resolvedBy: email },
  });

  const suggestionCreated = await suggestNoiseFilterFix(reportRequest.articleId);

  return NextResponse.json({ ok: true, suggestionCreated });
}
