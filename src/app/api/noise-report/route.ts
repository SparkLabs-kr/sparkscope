// 기사 노이즈 신고 토글 API — 스크랩과 동일하게 지정 계정만.
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { scrapperOrNull } from '@/lib/authz';
import { suggestNoiseFilterFix } from '@/lib/sparkscope/noise-suggestion';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const actor = await scrapperOrNull();
  const email = actor?.email ?? null;
  if (!actor) return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });

  const b = await req.json().catch(() => null);
  if (!b?.articleId) return NextResponse.json({ error: 'articleId는 필수입니다.' }, { status: 400 });

  const cur = await prisma.article.findUnique({ where: { id: b.articleId }, select: { isNoise: true } });
  if (!cur) return NextResponse.json({ error: '기사를 찾을 수 없습니다.' }, { status: 404 });

  const next = !cur.isNoise;
  await prisma.article.update({
    where: { id: b.articleId },
    data: { isNoise: next, noiseReason: next ? 'manual_report' : null },
  });

  // 새로 신고된 경우(취소가 아닌 경우)에만 재발방지 제안 생성 — 응답은 기다리지 않게 하지 않고
  // 바로 await한다(실패해도 throw 안 함, 신고 자체는 이미 위에서 끝난 동작이라 안전).
  // suggestionCreated를 응답에 실어 보내야, 신고 버튼이 그 자리에서 "AI 제안이 생겼어요"를
  // 안내할 수 있다 — 안 그러면 별도 승인 페이지에 조용히 쌓이기만 해서 신고자가 모른다
  // (2026-08-06: "신고했는데 아무것도 안 뜬다"는 문의로 발견).
  const suggestionCreated = next ? await suggestNoiseFilterFix(b.articleId) : false;

  return NextResponse.json({ isNoise: next, suggestionCreated });
}
