/**
 * 소셜 시그널 API — Inter 탭 도메인별 커뮤니티 화제글.
 * GET /api/inter/social?domain=bio|ai&from=YYYY-MM-DD
 *
 * DB를 안 쓴다(“지금 뜨는 글”이라 이력이 불필요). 외부 API 부담을 줄이려 30분 캐시.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/authz';
import { collectSocialSignals, type SocialDomain } from '@/lib/sparkscope/social-collect';

export const runtime = 'nodejs';
export const preferredRegion = 'icn1';
export const revalidate = 1800; // 30분

export async function GET(req: NextRequest) {
  // 공개된 소셜 글이라 민감하지는 않지만, 로그인 없이 열어두면 외부 API를 대신
  // 호출해주는 무료 프록시가 된다(레이트 리밋도 우리 쪽에서 소모된다).
  if (!(await getSessionUser())) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const domain: SocialDomain = sp.get('domain') === 'ai' ? 'ai' : 'bio';

  // from이 없거나 이상하면 최근 90일 — Inter 탭 기본 조회 기간과 맞춘다.
  const fromRaw = sp.get('from');
  const parsed = fromRaw && /^\d{4}-\d{2}-\d{2}$/.test(fromRaw) ? Date.parse(fromRaw) : NaN;
  const sinceMs = Number.isNaN(parsed) ? Date.now() - 90 * 86400_000 : parsed;

  try {
    const sources = await collectSocialSignals(domain, sinceMs);
    return NextResponse.json({ domain, sources });
  } catch (e: any) {
    console.error('[api/inter/social] 실패:', e);
    // 이 패널 하나 때문에 Inter 탭 전체가 죽으면 안 된다 — 빈 배열로 응답한다.
    return NextResponse.json({ domain, sources: [], error: String(e?.message ?? e) }, { status: 200 });
  }
}
