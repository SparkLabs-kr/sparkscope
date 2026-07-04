// 기사 스크랩 토글 API — 커뮤니케이션 본부 지정 계정만.
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { canScrap } from '@/lib/scrap';

export const runtime = 'nodejs';

async function currentEmail(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  return session?.user?.email ?? null;
}

export async function POST(req: Request) {
  const email = await currentEmail();
  if (!canScrap(email)) return NextResponse.json({ error: '스크랩 권한이 없습니다.' }, { status: 403 });

  const b = await req.json().catch(() => null);
  if (!b?.articleId) return NextResponse.json({ error: 'articleId는 필수입니다.' }, { status: 400 });

  const cur = await prisma.article.findUnique({ where: { id: b.articleId }, select: { isScrapped: true } });
  if (!cur) return NextResponse.json({ error: '기사를 찾을 수 없습니다.' }, { status: 404 });

  const next = typeof b.isScrapped === 'boolean' ? b.isScrapped : !cur.isScrapped;
  await prisma.article.update({
    where: { id: b.articleId },
    data: { isScrapped: next, scrappedAt: next ? new Date() : null, scrappedBy: next ? (email ?? 'dev') : null },
  });
  return NextResponse.json({ isScrapped: next });
}
