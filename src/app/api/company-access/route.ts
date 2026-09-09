/**
 * 포트폴리오사 계정 접근 해제·복구 — 승인과 같은 사람만 할 수 있다.
 *
 * 권한은 로그인이 준다. 승인(access-request/decide)과 같은 게이트를 쓴다:
 * 사내 메일이면 누구나 ADMIN 이 되므로 role 검사만으로는 전 직원이 남의
 * 회사 접근을 끊을 수 있게 된다.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/authz';
import { canApproveAccess } from '@/lib/sparkscope/access-request';
import {
  deactivateCompanyAccount,
  reactivateCompanyAccount,
} from '@/lib/sparkscope/company-accounts';

export const runtime = 'nodejs';

const Body = z.object({
  userId: z.string().trim().min(1).max(120),
  action: z.enum(['deactivate', 'reactivate']),
});

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  if (!canApproveAccess(auth.user.email)) {
    return NextResponse.json({ error: 'not_approver' }, { status: 403 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  const { userId, action } = parsed.data;

  const result =
    action === 'deactivate'
      ? await deactivateCompanyAccount(userId)
      : await reactivateCompanyAccount(userId);

  if (!result.ok) {
    const status = result.reason === 'not_found' ? 404 : 409;
    return NextResponse.json({ error: result.reason }, { status });
  }

  console.log(
    `[company-access] ${action} ${result.email} by ${auth.user.email}`,
  );
  return NextResponse.json({ ok: true, action, email: result.email });
}
