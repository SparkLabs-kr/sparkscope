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
import { ensureArticleKo, ensureArticleEn } from '@/lib/sparkscope/translate-content';
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
            // 아래 네 개가 빠져 있어서 트라이얼 120건이 "분석 안 된 기사"로 남았다.
            // analyzedAt이 없으면 백필 스크립트가 매번 같은 행을 다시 집어온다.
            pitchScore: a.pitchScore,
            pitchTopic: a.pitchTopic ?? null,
            relatedCompanies: a.relatedCompanies?.length ? JSON.stringify(a.relatedCompanies) : null,
            riskFlag: a.riskFlag ?? null,
            analyzedAt: new Date(),
          },
          // 이미 있는 기사는 건드리지 않는다 — 사람이 스크랩·노이즈 표시한 걸 덮어쓰면 안 된다.
          update: {},
        });
        saved++;
      } catch (e) {
        console.error('[cron:taiwan-collect] 저장 실패:', a.link, e);
      }
    }

    // 제목 번역 캐시 — title은 원문(번체 중문)이라 이걸 안 채우면 한국어 화면에
    // 중문 제목이 그대로 나간다. oneLiner는 분석기가 이미 한국어로 쓴다.
    // 실패해도 수집 자체는 성공으로 둔다 — 다음 실행이나 백필이 이어서 채운다.
    let translated = 0;
    try {
      const fresh = await prisma.article.findMany({
        where: { link: { in: analyzed.map(a => a.link) }, OR: [{ titleKo: null }, { titleEn: null }] },
        select: { id: true, title: true, titleKo: true, titleEn: true, oneLiner: true, oneLinerEn: true, pitchTopic: true, pitchTopicEn: true },
      });
      if (fresh.length > 0) {
        await ensureArticleKo(fresh);
        await ensureArticleEn(fresh);
        translated = fresh.filter(f => f.titleKo || f.titleEn).length;
      }
    } catch (e) {
      console.error('[cron:taiwan-collect] 제목 번역 실패(수집은 성공):', e);
    }

    console.log(`[cron:taiwan-collect] 수집 ${raw.length}건 → 저장 ${saved}건 · 제목 번역 ${translated}건`);
    return NextResponse.json({ ok: true, collected: raw.length, saved, translated });
  } catch (e: any) {
    console.error('[cron:taiwan-collect] 실패:', e);
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
