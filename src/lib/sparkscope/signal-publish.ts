/**
 * AI 시그널 TOP 5를 파트너가 읽을 수 있게 DB에 물질화한다.
 *
 * 블루사이트는 우리 API를 부르는 대신 Supabase anon key로 DB를 직접 조회한다.
 * 그래서 "무엇이 나가는가"를 테이블과 뷰로 못박아 둔다 —
 * 원본 테이블(AiSignalFeed)은 RLS를 켜고 anon 권한을 회수했고,
 * 파트너는 컬럼을 하나씩 골라 만든 ai_signal_feed_public 뷰로만 본다.
 *
 * 발송 경로(runner)에서 다이제스트에 넣은 것과 같은 객체를 그대로 저장한다.
 * 따로 계산하면 메일과 배너에 다른 TOP 5가 뜬다.
 */
import { prisma } from '@/lib/prisma';
import type { SignalFeed } from './signal-feed';

/** 남겨 둘 회차 수. 파트너는 최신 것만 보지만, 며칠치는 남겨야 문제가 생겼을 때 되짚을 수 있다. */
const KEEP_BATCHES = 12;

export async function publishSignalFeed(feed: SignalFeed | null | undefined): Promise<number> {
  if (!feed || feed.items.length === 0) {
    console.warn('[signal-publish] 내보낼 항목이 없어 발행을 건너뜁니다.');
    return 0;
  }

  const publishedAt = new Date();
  await prisma.aiSignalFeed.createMany({
    data: feed.items.map(it => ({
      publishedAt,
      rank: it.rank,
      kind: it.kind,
      domain: feed.domain,
      title: it.title,
      titleKo: it.titleKo,
      url: it.url,
      source: it.source,
      sourceId: it.sourceId,
      author: it.author,
      points: it.points,
      pointsLabel: it.pointsLabel,
      comments: it.comments,
      alsoInCount: it.alsoInCount,
      // 뉴스는 요약, 나머지는 한 줄 설명 — 파트너 배너에서 같은 자리를 채운다.
      summary: it.blurb ?? it.summaryKo,
      summaryEn: it.summaryEn,
      itemDate: it.publishedAt,
    })),
  });

  // 오래된 회차 정리. 뷰는 최신 회차만 보여주므로 남겨 두면 쌓이기만 한다.
  const keep = await prisma.aiSignalFeed.findMany({
    distinct: ['publishedAt'],
    orderBy: { publishedAt: 'desc' },
    take: KEEP_BATCHES,
    select: { publishedAt: true },
  });
  const oldest = keep.at(-1)?.publishedAt;
  if (oldest) {
    await prisma.aiSignalFeed.deleteMany({ where: { publishedAt: { lt: oldest } } });
  }

  console.log(`[signal-publish] ${feed.items.length}건 발행 (${publishedAt.toISOString()})`);
  return feed.items.length;
}
