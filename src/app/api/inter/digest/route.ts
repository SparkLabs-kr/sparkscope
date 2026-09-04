/**
 * 뉴스 다이제스트 API — 신뢰할 수 있는 매체가 지금 다루는 것 + 쉬운 말 요약.
 * GET /api/inter/digest?domain=bio|ai&days=1|7|30
 *
 * 피드 조회와 LLM 요약이 둘 다 걸리므로 30분 캐시. 요약은 기사 URL 단위로 DB에
 * 캐시되므로(DashboardInsight) 캐시가 만료돼도 같은 기사에 다시 비용이 들지 않는다.
 */
import { NextRequest, NextResponse } from 'next/server';
import { collectDigest, type NewsDomain } from '@/lib/sparkscope/news-digest';
import { ensureSummaries } from '@/lib/sparkscope/news-summary';
import { ensurePortfolioHits } from '@/lib/sparkscope/news-portfolio';

export const runtime = 'nodejs';
export const preferredRegion = 'icn1';
export const revalidate = 1800;

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const domain: NewsDomain = sp.get('domain') === 'ai' ? 'ai' : 'bio';
  const dRaw = Number(sp.get('days'));
  const days = [1, 7, 30].includes(dRaw) ? dRaw : 7;

  try {
    const { items, feeds } = await collectDigest(domain, days, 12);
    // 요약이 실패해도 목록은 나가야 한다 — ensureSummaries가 안에서 삼킨다.
    await ensureSummaries(items);
    // 요약이 있어야 매칭 근거가 좋아지므로 요약 뒤에 부른다.
    // 실패해도 목록은 나가야 한다 — ensurePortfolioHits가 안에서 삼킨다.
    await ensurePortfolioHits(items);
    // 원문 발췌는 요약을 만드는 데만 쓴다. 화면으로 내보내지 않는다 —
    // 매체 본문을 그대로 싣지 않기 위해서고, 페이로드도 불필요하게 커진다.
    const safe = items.map(({ sourceText, ...rest }) => rest);
    return NextResponse.json({ domain, days, items: safe, feeds });
  } catch (e: any) {
    console.error('[api/inter/digest] 실패:', e);
    return NextResponse.json({ domain, days, items: [], feeds: [], error: String(e?.message ?? e) }, { status: 200 });
  }
}
