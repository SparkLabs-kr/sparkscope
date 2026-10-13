// 공개 화면 미리보기 켜기/끄기 (authz.ts PREVIEW_COOKIE 참고).
//   GET /api/preview-as        → 외부 사용자가 보는 공개 화면으로
//   GET /api/preview-as?off=1  → 원래 화면으로
// 사내 계정만 켤 수 있다.
import { NextRequest, NextResponse } from 'next/server';
import { getRealSessionUser, PREVIEW_COOKIE } from '@/lib/authz';

export const runtime = 'nodejs';

// 미리보기 쿠키만 지운다(로그아웃 시 호출). httpOnly 라서 브라우저 스크립트로는 지울 수 없다.
// 쿠키를 지우는 것뿐이라 로그인 검사는 하지 않는다 — 로그인 상태와 무관하게 "미리보기 없음"이 되어야 한다.
export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(PREVIEW_COOKIE);
  return res;
}

export async function GET(req: NextRequest) {
  const real = await getRealSessionUser();
  if (!real) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  if (real.role === 'PORTFOLIO') return NextResponse.json({ error: '사내 계정만 미리 볼 수 있습니다.' }, { status: 403 });

  if (req.nextUrl.searchParams.get('off') === '1') {
    const res = NextResponse.redirect(new URL('/dashboard', req.url));
    res.cookies.delete(PREVIEW_COOKIE);
    return res;
  }

  const res = NextResponse.redirect(new URL('/dashboard', req.url));
  res.cookies.set(PREVIEW_COOKIE, '1', {
    httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 8,
    secure: process.env.NODE_ENV === 'production',
  });
  return res;
}
