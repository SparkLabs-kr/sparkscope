// 포트폴리오사 화면 미리보기 켜기/끄기 (authz.ts PREVIEW_COOKIE 참고).
//   GET /api/preview-as?company=<MonitoringTarget.id> → 그 회사 계정으로 보는 화면으로
//   GET /api/preview-as?off=1                          → 원래 화면으로
// 사내 계정만 켤 수 있다. 실제 포트폴리오사 계정이 남의 회사로 바꿔 보는 길이 되면 안 된다.
import { NextRequest, NextResponse } from 'next/server';
import { getRealSessionUser, PREVIEW_COOKIE } from '@/lib/authz';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const real = await getRealSessionUser();
  if (!real) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  if (real.role === 'PORTFOLIO') return NextResponse.json({ error: '사내 계정만 미리 볼 수 있습니다.' }, { status: 403 });

  const sp = req.nextUrl.searchParams;
  if (sp.get('off') === '1') {
    const res = NextResponse.redirect(new URL('/dashboard', req.url));
    res.cookies.delete(PREVIEW_COOKIE);
    return res;
  }

  const companyId = sp.get('company') ?? '';
  const target = await prisma.monitoringTarget.findFirst({
    where: { id: companyId, category: { startsWith: 'portfolio_company' } },
    select: { id: true },
  });
  if (!target) return NextResponse.json({ error: '포트폴리오사를 찾을 수 없습니다.' }, { status: 404 });

  // 돌아갈 곳 — 같은 사이트 안의 경로만 받는다.
  const back = sp.get('next');
  const dest = back && back.startsWith('/') && !back.startsWith('//') ? back : '/dashboard?tab=portfolio';
  const res = NextResponse.redirect(new URL(dest, req.url));
  res.cookies.set(PREVIEW_COOKIE, target.id, {
    httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 8,
    secure: process.env.NODE_ENV === 'production',
  });
  return res;
}
