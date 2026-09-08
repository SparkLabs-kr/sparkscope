/**
 * 파트너용 AI 시그널 API — 블루사이트가 자기 홈페이지 배너에 띄우려고 가져간다.
 * GET /api/partner/signals
 *   Authorization: Bearer <PARTNER_API_KEY>
 *
 * 블루사이트 에이전트가 월·수·금 다이제스트 발송 시간대에 호출한다. 그날 아침 크론이
 * 모아 둔 것을 DB에서 읽어 내보내는 구조라, 호출 시점에 외부 API를 다시 때리지 않는다.
 *
 * 선정 로직은 signal-feed.ts 한 곳에 있다 — 다이제스트 메일의 AI 트렌드 섹션과 같은
 * 목록이어야 한다. 규칙이 갈라지면 메일과 파트너 배너에 서로 다른 TOP 5가 뜬다.
 *
 * ⚠️ 포트폴리오사 매칭은 내보내지 않는다(signal-feed.ts 주석 참고).
 *    나가는 것은 기사 제목·링크·매체·요약과 커뮤니티 글뿐이다.
 *
 * 인증: 미들웨어의 세션 검사에서 빠져 있고(PUBLIC_API), 대신 여기서 API 키를 직접 본다.
 * 크론 라우트가 CRON_SECRET을 자기가 검사하는 것과 같은 구조.
 */
import { NextRequest, NextResponse } from 'next/server';
import { buildSignalFeed } from '@/lib/sparkscope/signal-feed';

export const runtime = 'nodejs';
export const preferredRegion = 'icn1';
export const dynamic = 'force-dynamic';

const PARTNER_API_KEY = process.env.PARTNER_API_KEY || '';

/**
 * 길이가 다르면 바로, 같으면 전체를 끝까지 비교한다 — 앞자리부터 빨리 실패하는
 * 단순 비교(===)는 응답 시간 차이로 키를 한 글자씩 알아낼 여지를 준다.
 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function GET(req: NextRequest) {
  // 키가 아예 설정돼 있지 않으면 열지 않는다 — 빈 문자열끼리 맞아떨어져
  // 인증 없이 열리는 사고를 막는다.
  if (!PARTNER_API_KEY) {
    console.error('[api/partner/signals] PARTNER_API_KEY 미설정 — 요청 거부');
    return NextResponse.json({ error: 'not configured' }, { status: 503 });
  }

  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!safeEqual(token, PARTNER_API_KEY)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const feed = await buildSignalFeed();
    return NextResponse.json(feed, {
      headers: {
        // 파트너가 짧은 간격으로 여러 번 불러도 DB를 반복해서 때리지 않게.
        'Cache-Control': 'public, max-age=600, s-maxage=600',
      },
    });
  } catch (e: any) {
    console.error('[api/partner/signals] 실패:', e);
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
