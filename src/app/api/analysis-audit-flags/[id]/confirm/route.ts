// 분석 오류 확정 — 관리자가 검토 후 실제 값을 입력해서 Article.tone/riskFlag/oneLiner를 고친다.
// 노이즈 제안과 달리 "무엇으로 고칠지"까지 AI가 자동 결정하지 않는다 — 1차 자동 검사 자체가
// 오탐이 많았던 걸 확인했기 때문에(45건 중 30건 오탐), 최종 값은 사람이 확인하고 입력한다.
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

  const body = await req.json().catch(() => ({}));
  const tone = typeof body.tone === 'string' ? body.tone : undefined;
  const riskFlag = body.riskFlag === null ? null : (typeof body.riskFlag === 'string' ? body.riskFlag : undefined);
  const oneLiner = typeof body.oneLiner === 'string' ? body.oneLiner : undefined;

  await prisma.article.update({
    where: { id: flag.articleId },
    data: {
      ...(tone !== undefined ? { tone } : {}),
      ...(riskFlag !== undefined ? { riskFlag } : {}),
      ...(oneLiner !== undefined ? { oneLiner } : {}),
    },
  });
  await prisma.analysisAuditFlag.update({
    where: { id: flag.id },
    data: { status: 'CONFIRMED', resolvedAt: new Date(), resolvedBy: email },
  });

  return NextResponse.json({ ok: true });
}
