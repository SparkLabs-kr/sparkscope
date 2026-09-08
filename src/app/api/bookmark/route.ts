// 개인 북마크 토글 API — 로그인한 사용자면 누구나, 본인 것만.
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { requireAdmin } from '@/lib/authz';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  // 포트폴리오사 계정은 열람 전용이다 — 쓰기는 사내 계정만.
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  if (!userId) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const b = await req.json().catch(() => null);
  if (!b?.articleId) return NextResponse.json({ error: 'articleId는 필수입니다.' }, { status: 400 });

  const existing = await prisma.bookmark.findUnique({ where: { userId_articleId: { userId, articleId: b.articleId } } });
  if (existing) {
    await prisma.bookmark.delete({ where: { id: existing.id } });
    return NextResponse.json({ isBookmarked: false });
  }
  await prisma.bookmark.create({ data: { userId, articleId: b.articleId } });
  return NextResponse.json({ isBookmarked: true });
}
