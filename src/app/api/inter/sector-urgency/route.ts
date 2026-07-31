// Inter(해외 트렌드) 탭 — 섹터 배지("긴급"/"모니터링"/"기회") 사유 한 줄 AI 요약.
// 요청 시점에 바로 호출한다(섹터 개수가 적어 비용/지연 부담이 작음). 트래픽이 늘면
// dashboard-insights.ts의 사전계산 패턴으로 옮길 것 — CLAUDE.md 참고.
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { OPEN_ACCESS } from '@/lib/flags';
import { summarizeSectorBadgeReason } from '@/lib/sparkscope/inter-insight';

export const runtime = 'nodejs';

interface SectorInput {
  id: string;
  name: string;
  badgeLabel: string;
  titles: string[];
}

export async function POST(req: Request) {
  const session = OPEN_ACCESS
    ? ({ user: { email: 'dev@localhost' } } as any)
    : await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const b = await req.json().catch(() => null);
  const sectors: SectorInput[] = Array.isArray(b?.sectors) ? b.sectors : [];
  if (sectors.length === 0) return NextResponse.json({ error: 'sectors는 필수입니다.' }, { status: 400 });

  const entries = await Promise.all(
    sectors.map(async s => {
      const reason = await summarizeSectorBadgeReason(s.name, s.badgeLabel, s.titles);
      return [s.id, reason] as const;
    })
  );

  return NextResponse.json({ results: Object.fromEntries(entries) });
}
