// Inter(해외 트렌드) 탭 — 섹터 배지("긴급"/"모니터링"/"기회") 사유 한 줄 AI 요약.
//
// 결과는 DashboardInsight(kind='inter_sector_urgency')에 캐시한다. 클라이언트(InterPanel)는
// 도메인·국가·기간이 바뀔 때마다 자기 state를 비우므로, 캐시가 없으면 탭을 전환하거나
// 새로고침할 때마다 같은 입력에 대해 섹터 수만큼 LLM을 다시 호출했다 — 사용자마다, 영원히.
// 비용보다도 그때마다 사용자가 기다리는 지연이 문제였다(실측 3.2초 → 캐시 적중 시 0.08초).
//
// 캐시 키에 입력(지표·제목) 지문을 넣기 때문에, 기사가 새로 들어와 지표가 바뀌면 키가 자연히
// 달라져 새로 계산된다 — "오래된 요약이 굳어버리는" 일은 없다. 대신 지문이 계속 늘어나므로
// 오래된 행은 dashboard-insights.ts의 pruneSectorUrgencyCache()가 일일 크론에서 정리한다.
import { NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { OPEN_ACCESS } from '@/lib/flags';
import { prisma } from '@/lib/prisma';
import { summarizeSectorBadgeReason } from '@/lib/sparkscope/inter-insight';

export const runtime = 'nodejs';

const KIND = 'inter_sector_urgency';

interface SectorInput {
  id: string;
  name: string;
  badgeLabel: string;
  metricsLine: string; // 배지 판정 근거 숫자 (computeBadge의 why + 건수·매치 수)
  titles: string[];
}

/** 같은 섹터라도 지표·제목이 다르면 다른 요약이어야 하므로, 입력 전체를 키에 반영한다. */
function cacheKey(s: SectorInput): string {
  const fingerprint = createHash('sha1')
    .update(JSON.stringify([s.name, s.badgeLabel, s.metricsLine ?? '', s.titles]))
    .digest('hex')
    .slice(0, 12);
  return `${s.id}:${fingerprint}`;
}

export async function POST(req: Request) {
  const session = OPEN_ACCESS
    ? ({ user: { email: 'dev@localhost' } } as any)
    : await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const b = await req.json().catch(() => null);
  const sectors: SectorInput[] = Array.isArray(b?.sectors) ? b.sectors : [];
  if (sectors.length === 0) return NextResponse.json({ error: 'sectors는 필수입니다.' }, { status: 400 });

  const keyOf = new Map(sectors.map(s => [s.id, cacheKey(s)]));

  // 1. 캐시 조회 — 여기서 걸리면 LLM 호출 자체가 없다.
  const cachedRows = await prisma.dashboardInsight.findMany({
    where: { kind: KIND, key: { in: [...keyOf.values()] } },
    select: { key: true, value: true },
  });
  const cachedByKey = new Map<string, string>();
  for (const r of cachedRows) {
    try {
      const parsed = JSON.parse(r.value);
      if (typeof parsed?.reason === 'string' && parsed.reason.trim()) cachedByKey.set(r.key, parsed.reason);
    } catch {
      // 깨진 값은 무시 — 아래에서 미스로 처리돼 다시 계산된다
    }
  }

  // 2. 미스만 LLM 호출 후 캐시에 저장.
  const entries = await Promise.all(
    sectors.map(async s => {
      const key = keyOf.get(s.id)!;
      const hit = cachedByKey.get(key);
      if (hit) return [s.id, hit] as const;

      const reason = await summarizeSectorBadgeReason(s.name, s.badgeLabel, s.metricsLine ?? '', s.titles);
      if (reason) {
        // 저장 실패(동시 요청 경합 등)가 응답을 막지는 않게 한다 — 다음 요청에 다시 시도된다.
        await prisma.dashboardInsight
          .upsert({
            where: { kind_key: { kind: KIND, key } },
            create: { kind: KIND, key, value: JSON.stringify({ reason }) },
            update: { value: JSON.stringify({ reason }), computedAt: new Date() },
          })
          .catch(e => console.error('[sector-urgency] 캐시 저장 실패:', e?.message ?? e));
      }
      return [s.id, reason] as const;
    })
  );

  return NextResponse.json({ results: Object.fromEntries(entries) });
}
