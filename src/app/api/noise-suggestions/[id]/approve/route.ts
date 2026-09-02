// 노이즈 제안 승인 — MonitoringTarget에 실제 반영. 스크랩과 동일 권한(관리자 전용).
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

  const target = await prisma.monitoringTarget.findFirst({ where: { name: suggestion.targetName } });
  if (!target) return NextResponse.json({ error: '감시대상을 찾을 수 없습니다.' }, { status: 404 });

  // 제안 시점 값이 아니라 지금 살아있는 값 기준으로 이어붙인다 — 그 사이 다른 경로로 값이
  // 바뀌었을 수 있어서(예: 다른 신고가 먼저 승인됨), 승인 시점의 실제 최신 값을 존중한다.
  const field = suggestion.field as 'excludeWords' | 'contextWords';
  const liveValue = (target as any)[field] as string | null;
  const merged = liveValue ? `${liveValue}, ${suggestion.addition}` : suggestion.addition;

  await prisma.monitoringTarget.update({
    where: { id: target.id },
    data: { [field]: merged },
  });
  await prisma.noiseSuggestion.update({
    where: { id: suggestion.id },
    data: { status: 'APPROVED', resolvedAt: new Date(), resolvedBy: email },
  });

  return NextResponse.json({ ok: true, field, value: merged });
}
