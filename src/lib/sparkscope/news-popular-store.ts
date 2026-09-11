/**
 * 1면 헤드라인·인기기사 관측 기록의 저장·조회.
 *
 * 왜 DB를 거치나 — 조회할 때마다 홈페이지를 긁으면 "지금 이 순간 1면"만 알 수 있다.
 * 그래서 하루만 지나도 어제 1면을 휩쓴 사안의 신호가 0이 된다. 실제로 그랬다:
 * 노바티스 Phase 3 실패가 2026-09-08에는 Fierce·Endpoints 1면 동시 톱이었는데,
 * 하루 뒤 매체들이 다음 사안으로 넘어가자 "이번주" 탭에서도 사라졌다.
 *
 * 2시간마다(collect-social 크론) 관측해 쌓아 두고, 다이제스트는 요청한 기간 안에
 * 관측된 것을 읽는다. 그러면 "이번주 동안 1면을 차지했던 것"을 물어볼 수 있다.
 */
import { prisma } from '@/lib/prisma';
import { collectPopular, urlDate, type PopularItem } from './news-popular';

/** 한 번 headline으로 본 것은 popular로 내리지 않는다 — 더 강한 근거다. */
const strongerKind = (a: string, b: string) => (a === 'headline' || b === 'headline' ? 'headline' : 'popular');

/** 관측 결과를 저장한다. 이미 본 것은 등수를 갱신하고 bestRank를 낮춘다. */
export async function savePopular(domain: 'ai' | 'bio', items: PopularItem[]): Promise<number> {
  let saved = 0;
  for (const it of items) {
    const kind = it.headlineRank != null ? 'headline' : 'popular';
    const rank = it.headlineRank ?? it.rank;
    try {
      const prev = await prisma.newsHeadline.findUnique({
        where: { source_url: { source: it.source, url: it.url } },
        select: { bestRank: true, kind: true },
      });
      await prisma.newsHeadline.upsert({
        where: { source_url: { source: it.source, url: it.url } },
        create: {
          source: it.source, domain, kind, title: it.title, url: it.url,
          rank, bestRank: rank, views: it.views ?? null, domestic: !!it.domestic,
        },
        update: {
          rank,
          // 등수는 시간이 지나며 내려간다. 최고 등수를 남겨야 "한때 1면 톱이었다"가 보존된다.
          bestRank: prev ? Math.min(prev.bestRank, rank) : rank,
          kind: prev ? strongerKind(prev.kind, kind) : kind,
          title: it.title,
          views: it.views ?? undefined,
          lastSeenAt: new Date(),
        },
      });
      saved++;
    } catch (e) {
      console.error('[news-popular-store] 저장 실패:', it.source, e);
    }
  }
  return saved;
}

/** 관측하고 저장까지 한 번에. 크론이 부른다. */
export async function refreshPopular(domain: 'ai' | 'bio'): Promise<number> {
  const items = await collectPopular(domain);
  return savePopular(domain, items);
}

/**
 * 기간 안에 관측된 것을 읽는다. 등수는 항상 bestRank를 쓴다 —
 * 순위 판정의 질문이 "지금 몇 위인가"가 아니라 "이 기간에 얼마나 위였나"이기 때문이다.
 */
export async function readPopular(domain: 'ai' | 'bio', sinceMs: number): Promise<PopularItem[]> {
  const rows = await prisma.newsHeadline.findMany({
    where: { domain, lastSeenAt: { gte: new Date(sinceMs) } },
    orderBy: [{ bestRank: 'asc' }, { lastSeenAt: 'desc' }],
    take: 200,
  });
  return rows.map(r => ({
    title: r.title,
    url: r.url,
    source: r.source,
    // 발행일은 URL에서 뽑고, 없으면 우리가 처음 1면에서 본 시각으로 대신한다.
    // 목록 페이지가 날짜를 주지 않아서인데, 둘 다 없다고 '오늘'로 적으면
    // 9월 8일 기사가 오늘 기사로 화면에 뜬다(2026-09-11에 실제로 그랬다).
    date: urlDate(r.url) ?? r.firstSeenAt,
    rank: r.bestRank,
    views: r.views ?? undefined,
    domestic: r.domestic,
    ...(r.kind === 'headline' ? { headlineRank: r.bestRank } : {}),
  }));
}

/** 오래된 관측은 지운다 — 기간 조회의 최대치(이번 달)보다 넉넉히만 남긴다. */
export async function prunePopular(days = 45): Promise<number> {
  const { count } = await prisma.newsHeadline.deleteMany({
    where: { lastSeenAt: { lt: new Date(Date.now() - days * 86_400_000) } },
  });
  return count;
}
