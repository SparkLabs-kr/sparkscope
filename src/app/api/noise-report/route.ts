// 기사 노이즈 신고 토글 API — 스크랩과 동일하게 지정 계정만.
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { canScrap } from '@/lib/scrap';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email ?? null;
  if (!canScrap(email)) return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });

  const b = await req.json().catch(() => null);
  if (!b?.articleId) return NextResponse.json({ error: 'articleId는 필수입니다.' }, { status: 400 });

  const cur = await prisma.article.findUnique({ where: { id: b.articleId }, select: { isNoise: true } });
  if (!cur) return NextResponse.json({ error: '기사를 찾을 수 없습니다.' }, { status: 404 });

  const next = !cur.isNoise;
  await prisma.article.update({
    where: { id: b.articleId },
    data: { isNoise: next, noiseReason: next ? 'manual_report' : null },
  });
  return NextResponse.json({ isNoise: next });
}
