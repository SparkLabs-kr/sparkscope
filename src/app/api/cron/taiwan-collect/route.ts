/**
 * 대만 포트폴리오사 수집 크론 — 주 1회.
 *
 * 왜 별도 엔드포인트인가:
 *   daily-collect는 네이버 뉴스 API를 쓴다. 네이버는 대만 매체를 거의 색인하지 않아
 *   대만 69개사를 아무리 조회해도 0건이다(2026-08 트라이얼로 확인).
 *   대만은 구글 뉴스 RSS(zh-TW)를 별도로 태운다.
 *
 * 왜 매일이 아닌가:
 *   3개월 트라이얼 실측 142건 / 15개사 — 하루 평균 1.5건이다. 매일 돌리면 대부분 0건이고
 *   구글 뉴스에 불필요한 요청만 쌓인다. 주 1회(10일 창)면 겹치면서도 누락이 없다.
 */
import { NextRequest, NextResponse } from 'next/server';
import { collectTaiwanArticles } from '@/lib/sparkscope/taiwan-collect';
import { analyzeArticles } from '@/lib/sparkscope/analyzer';
import { prisma } from '@/lib/prisma';
import { normalizeSource } from '@/lib/sparkscope/media';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const token = request.headers.get('authorization')?.replace('Bearer ', '');
  if (!token || token !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const raw = await collectTaiwanArticles(10);
    if (raw.length === 0) {
      // 0건 자체는 정상이다(대만은 원래 얇다). 다만 몇 주 연속 0이면 구글 뉴스 포맷이
      // 바뀌었을 수 있으니 로그로 남긴다 — 조용히 죽는 게 가장 위험하다.
      console.warn('[cron:taiwan-collect] 수집 0건 — 연속되면 RSS 포맷 변경 여부 확인 필요');
      return NextResponse.json({ ok: true, collected: 0, saved: 0 });
    }

    // analyzeArticles(raw, portfolioUniverse, trendingTopics) — 3번째까지 필수.
    // 대만 대상 이름을 universe로 넘겨 분류 시 회사 맥락을 준다. trendingTopics는 국내 이슈
    // 기준이라 대만엔 의미가 없어 빈 배열로 둔다.
    const universe = await prisma.monitoringTarget.findMany({
      where: { category: 'portfolio_company_tw' },
      select: { name: true },
    });
    const analyzed = await analyzeArticles(raw, universe.map(u => u.name), []);

    let saved = 0;
    for (const a of analyzed) {
      try {
        await prisma.article.upsert({
          where: { link: a.link },
          create: {
            title: a.title,
            link: a.link,
            source: normalizeSource(a.source),
            pubDate: a.pubDate,
            matchedKeyword: a.matchedKeyword,
            category: a.category,
            importance: a.importance,
            tone: a.tone,
            oneLiner: a.oneLiner,
            ourTake: a.ourTake,
            priorityScore: a.basePriority,
          },
          // 이미 있는 기사는 건드리지 않는다 — 사람이 스크랩·노이즈 표시한 걸 덮어쓰면 안 된다.
          update: {},
        });
        saved++;
      } catch (e) {
        console.error('[cron:taiwan-collect] 저장 실패:', a.link, e);
      }
    }

    console.log(`[cron:taiwan-collect] 수집 ${raw.length}건 → 저장 ${saved}건`);
    return NextResponse.json({ ok: true, collected: raw.length, saved });
  } catch (e: any) {
    console.error('[cron:taiwan-collect] 실패:', e);
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
