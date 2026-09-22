/**
 * 글로벌벤처스 포트폴리오사 수집 크론 — 주 1회.
 *
 * 왜 별도 엔드포인트인가:
 *   daily-collect는 네이버 뉴스 API를 쓴다. GV 포트폴리오 54개사는 대부분 미국·영국·
 *   싱가포르 기업이라 보도가 영문이고, 네이버로는 대만과 같은 이유로 거의 0건이다.
 *   GV는 구글 뉴스 RSS(en-US)를 별도로 태운다.
 *
 * 왜 매일이 아닌가:
 *   대만과 같은 이유다 — 회사당 질의 1건씩 쌓이는 구조라 매일 돌리면 구글 뉴스에
 *   불필요한 요청만 늘어난다. 주 1회(10일 창)면 겹치면서도 누락이 없다.
 *   GV는 OpenSea·Animoca Brands처럼 보도량이 많은 곳이 있어 대만보다 수집량이 많을
 *   것으로 보이는데, 실제 분포를 몇 주 보고 나서 주기를 다시 판단한다.
 *
 * 시각 — 월요일 00:20 UTC(09:20 KST). vercel.json은 주석을 못 달아서 여기 남긴다:
 *   00:20 GV 수집 → 01:00 대만 수집 → 01:30 다이제스트 발송 → 02:00 시너지 재구축.
 *   해외 수집 두 개를 발송(01:30) 앞에 몰아두되 서로 40분 벌려 둔다. 같은 시각에
 *   돌리면 구글 뉴스에 54+70개 질의가 한꺼번에 나가 레이트리밋 위험이 있다.
 */
import { NextRequest, NextResponse } from 'next/server';
import { collectGvArticles, GV_SELF_NAME, GV_CATEGORY } from '@/lib/sparkscope/gv-collect';
import { analyzeArticles } from '@/lib/sparkscope/analyzer';
import { ensureArticleKo, ensureArticleEn } from '@/lib/sparkscope/translate-content';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const token = request.headers.get('authorization')?.replace('Bearer ', '');
  if (!token || token !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const raw = await collectGvArticles(10);
    if (raw.length === 0) {
      // 0건 자체는 정상일 수 있다. 다만 몇 주 연속 0이면 구글 뉴스 포맷이 바뀌었을
      // 수 있으니 로그로 남긴다 — 조용히 죽는 게 가장 위험하다.
      console.warn('[cron:gv-collect] 수집 0건 — 연속되면 RSS 포맷 변경 여부 확인 필요');
      return NextResponse.json({ ok: true, collected: 0, saved: 0 });
    }

    // analyzeArticles(raw, portfolioUniverse, trendingTopics) — 3번째까지 필수.
    // GV 대상 이름을 universe로 넘겨 분류 시 회사 맥락을 준다. trendingTopics는 국내 이슈
    // 기준이라 GV엔 의미가 없어 빈 배열로 둔다.
    // 자사 대상도 함께 수집하므로 universe에 넣어준다 — 안 넣으면 분석기가 자사 기사를
    // 아는 회사 없는 기사로 취급한다.
    const universe = await prisma.monitoringTarget.findMany({
      where: { OR: [{ category: GV_CATEGORY }, { name: GV_SELF_NAME }] },
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
            // 대만 라우트는 여기서 normalizeSource(한국 매체 정규화)를 한 번 더 태우는데,
            // 수집기가 이미 로케일 팩으로 정규화한 뒤라 GV에서는 그대로 쓴다.
            // 한국 정규화기를 영문 매체명에 태우면 얻는 게 없다.
            source: a.source,
            pubDate: a.pubDate,
            matchedKeyword: a.matchedKeyword,
            category: a.category,
            importance: a.importance,
            tone: a.tone,
            oneLiner: a.oneLiner,
            ourTake: a.ourTake,
            priorityScore: a.basePriority,
            pitchScore: a.pitchScore,
            pitchTopic: a.pitchTopic ?? null,
            relatedCompanies: a.relatedCompanies?.length ? JSON.stringify(a.relatedCompanies) : null,
            riskFlag: a.riskFlag ?? null,
            // analyzedAt이 없으면 백필 스크립트가 매번 같은 행을 다시 집어온다.
            analyzedAt: new Date(),
          },
          // 이미 있는 기사는 건드리지 않는다 — 사람이 스크랩·노이즈 표시한 걸 덮어쓰면 안 된다.
          update: {},
        });
        saved++;
      } catch (e) {
        console.error('[cron:gv-collect] 저장 실패:', a.link, e);
      }
    }

    // 제목 번역 캐시 — title이 영문 원문이라 이걸 안 채우면 한국어 화면에 영문 제목이
    // 그대로 나간다(대만이 중문 제목을 노출했던 것과 같은 문제).
    // titleEn 쪽은 원문이 이미 영어라 translate-content가 원문을 복사만 하고 끝낸다.
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
      console.error('[cron:gv-collect] 제목 번역 실패(수집은 성공):', e);
    }

    console.log(`[cron:gv-collect] 수집 ${raw.length}건 → 저장 ${saved}건 · 제목 번역 ${translated}건`);
    return NextResponse.json({ ok: true, collected: raw.length, saved, translated });
  } catch (e: any) {
    console.error('[cron:gv-collect] 실패:', e);
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
