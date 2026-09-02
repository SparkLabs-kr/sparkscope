// 노이즈 제안 거부 — DB 설정은 그대로 두고 상태만 기록. 스크랩과 동일 권한(관리자 전용).
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { scrapperOrNull } from '@/lib/authz';

export const runtime = 'nodejs';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const actor = await scrapperOrNull();
  const email = actor?.email ?? null;
  if (!actor) return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });

  const suggestion = await prisma.noiseSuggestion.findUnique({ where: { id: params.id } });
  if (!suggestion) return NextResponse.json({ error: '제안을 찾을 수 없습니다.' }, { status: 404 });
  if (suggestion.status !== 'PENDING') return NextResponse.json({ error: '이미 처리된 제안입니다.' }, { status: 409 });

  await prisma.noiseSuggestion.update({
    where: { id: suggestion.id },
    data: { status: 'REJECTED', resolvedAt: new Date(), resolvedBy: email },
  });

  return NextResponse.json({ ok: true });
}
