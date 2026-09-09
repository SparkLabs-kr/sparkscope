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
import { readDigest, saveDigest } from '@/lib/sparkscope/digest-store';
import { requireUser } from '@/lib/authz';

export const runtime = 'nodejs';
export const preferredRegion = 'icn1';
export const revalidate = 1800;

export async function GET(req: NextRequest) {
  // 로그인 확인은 여기서 한다 — middleware는 Edge라 쿠키 유무만 본다.
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const sp = req.nextUrl.searchParams;
  const domain: NewsDomain = sp.get('domain') === 'ai' ? 'ai' : 'bio';
  const dRaw = Number(sp.get('days'));
  const days = [1, 7, 30].includes(dRaw) ? dRaw : 7;

  try {
    // 사전계산된 것이 있으면 그대로 준다. 없거나 오래됐으면 그 자리에서 만든다 —
    // 만드는 데 12초쯤 걸리므로(digest-store.ts 주석) 평소에는 크론이 채워 둔다.
    const cached = await readDigest(domain, days).catch(() => null);
    if (cached) {
      return NextResponse.json({
        domain, days, items: cached.items, feeds: cached.feeds,
        keywords: cached.keywords ?? [], computedAt: cached.computedAt,
      });
    }

    console.log(`[api/inter/digest] ${domain}/${days}일 사전계산 없음 — 즉석 계산`);
    const { items, feeds, keywords } = await collectDigest(domain, days, 12);
    // 요약이 실패해도 목록은 나가야 한다 — ensureSummaries가 안에서 삼킨다.
    await ensureSummaries(items);
    // 요약이 있어야 매칭 근거가 좋아지므로 요약 뒤에 부른다.
    await ensurePortfolioHits(items);
    // 원문 발췌는 요약을 만드는 데만 쓴다. 화면으로 내보내지 않는다 —
    // 매체 본문을 그대로 싣지 않기 위해서고, 페이로드도 불필요하게 커진다.
    const safe = items.map(({ sourceText, ...rest }) => rest);
    // 다음 사람은 기다리지 않게 저장해 둔다.
    await saveDigest(domain, days, { items: safe, feeds, keywords }).catch(
      e => console.error('[api/inter/digest] 캐시 저장 실패(무시):', e));
    return NextResponse.json({ domain, days, items: safe, feeds, keywords });
  } catch (e: any) {
    console.error('[api/inter/digest] 실패:', e);
    return NextResponse.json({ domain, days, items: [], feeds: [], keywords: [], error: String(e?.message ?? e) }, { status: 200 });
  }
}
