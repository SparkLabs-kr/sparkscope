// Inter(해외 트렌드) 기사 스크랩 토글 API — /api/scrap(국내 Article)과 같은 권한·응답 형태.
// 스크랩 단위는 InterNewsVerdict(판정 결과)다. 화면에 보이는 게 판정 결과(한국어 제목·섹터)이고
// 스크랩함에서도 그 정보를 그대로 보여줘야 하기 때문.
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { scrapperOrNull } from '@/lib/authz';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const actor = await scrapperOrNull();
  const email = actor?.email ?? null;
  if (!actor) return NextResponse.json({ error: '스크랩 권한이 없습니다.' }, { status: 403 });

  const b = await req.json().catch(() => null);
  if (!b?.verdictId) return NextResponse.json({ error: 'verdictId는 필수입니다.' }, { status: 400 });

  const cur = await prisma.interNewsVerdict.findUnique({
    where: { id: b.verdictId },
    select: { isScrapped: true },
  });
  if (!cur) return NextResponse.json({ error: '기사를 찾을 수 없습니다.' }, { status: 404 });

  const next = typeof b.isScrapped === 'boolean' ? b.isScrapped : !cur.isScrapped;
  await prisma.interNewsVerdict.update({
    where: { id: b.verdictId },
    data: { isScrapped: next, scrappedAt: next ? new Date() : null, scrappedBy: next ? (email ?? 'dev') : null },
  });
  return NextResponse.json({ isScrapped: next });
}
