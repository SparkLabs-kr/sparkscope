/**
 * 시너지 조합 피드백 — 👍/👎.
 *
 * 왜 필요한가: 추천 정확도를 사람이 고쳐줄 통로가 없으면, 틀린 조합이 계속 같은 자리에 뜬다.
 * build-synergy-pairs 배치는 feedback이 달린 쌍을 --recompute에도 덮어쓰지 않는다.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { OPEN_ACCESS } from '@/lib/flags';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/authz';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  // 포트폴리오사 계정은 열람 전용이다 — 쓰기는 사내 계정만.
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;
  // 누가 눌렀는지 남긴다 — 익명 피드백은 나중에 되짚을 수 없다.
  // OPEN_ACCESS(협업 개발 단계)에서는 세션이 없어도 통과시킨다. 대시보드 자체가 이미
  // 로그인 없이 열리는 상태인데 이 API만 401을 주면 버튼이 조용히 안 먹는다.
  const session = await getServerSession(authOptions);
  const email = session?.user?.email ?? null;
  if (!email && !OPEN_ACCESS) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const actor = email ?? 'dev';

  let body: { pairId?: string; feedback?: string | null };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }); }

  const { pairId, feedback } = body;
  if (!pairId || typeof pairId !== 'string') {
    return NextResponse.json({ error: 'pairId required' }, { status: 400 });
  }
  if (feedback !== 'up' && feedback !== 'down' && feedback !== null) {
    return NextResponse.json({ error: "feedback must be 'up' | 'down' | null" }, { status: 400 });
  }

  try {
    await prisma.synergyPair.update({
      where: { id: pairId },
      data: {
        feedback,
        feedbackBy: feedback ? actor : null,
        feedbackAt: feedback ? new Date() : null,
      },
    });
  } catch {
    return NextResponse.json({ error: 'pair not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true, feedback });
}
