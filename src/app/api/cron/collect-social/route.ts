/**
 * 소셜 시그널 수집 크론 — 커뮤니티·모델 허브·논문 원본을 긁어 DB에 쌓는다.
 * GET /api/cron/collect-social            주기가 된 소스만
 * GET /api/cron/collect-social?force=1    주기 무시하고 전부 (첫 채움·수동 실행)
 *
 * 2시간마다 돈다. 매번 전부 긁는 게 아니라, 소스마다 정해진 주기
 * (COLLECT_INTERVAL_SEC: 커뮤니티 2시간 · HF/Lobsters 6시간 · 논문·임상 24시간)가
 * 됐는지 확인하고 그 소스만 긁는다. 하루 1회 갱신되는 원본을 2시간마다 때리는 건
 * 남의 서버만 축내는 일이다.
 *
 * 매체 1면 헤드라인·인기기사도 같은 주기로 함께 관측한다(NewsHeadline). 홈페이지는
 * "지금 이 순간"만 보여주므로, 쌓아 두지 않으면 "이번주에 1면을 차지했던 것"을
 * 물어볼 수 없다. 같은 2시간 주기라 크론을 따로 만들지 않고 여기에 붙였다.
 */
import { NextRequest, NextResponse } from 'next/server';
import { refreshAllSocialSignals } from '@/lib/sparkscope/social-refresh';
import { refreshPopular, prunePopular } from '@/lib/sparkscope/news-popular-store';

export const runtime = 'nodejs';
export const preferredRegion = 'icn1';
export const dynamic = 'force-dynamic';
// 소스 11곳 × 외부 왕복이라 기본 제한으로는 부족하다.
export const maxDuration = 300;

const CRON_SECRET = process.env.CRON_SECRET || '';

export async function GET(request: NextRequest) {
  // 다른 크론과 같은 방식으로 시크릿을 검사한다.
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.replace('Bearer ', '');
  if (!token || token !== CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startedAt = Date.now();
  try {
    const force = request.nextUrl.searchParams.get('force') === '1';
    const { results, pruned } = await refreshAllSocialSignals({ force });
    const saved = results.reduce((n, r) => n + r.saved, 0);

    // 1면 헤드라인 관측 — 실패해도 소셜 수집 결과는 그대로 보고한다.
    let headlines = 0;
    let headlinesPruned = 0;
    try {
      for (const d of ['ai', 'bio'] as const) headlines += await refreshPopular(d);
      headlinesPruned = await prunePopular();
    } catch (e) {
      console.error('[cron/collect-social] 헤드라인 관측 실패:', e);
    }

    console.log(`[cron/collect-social] 저장 ${saved}건, 헤드라인 ${headlines}건, 샘플 정리 ${pruned}건, ${Date.now() - startedAt}ms`);
    return NextResponse.json({ ok: true, results, pruned, headlines, headlinesPruned, ms: Date.now() - startedAt });
  } catch (e: any) {
    console.error('[cron/collect-social] 실패:', e);
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
