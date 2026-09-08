/**
 * 접근 요청 승인·거절 — 관리자 전용.
 *
 * 메일에 실린 토큰은 "어느 요청인가"만 가리킨다. 권한은 토큰이 아니라 로그인이 준다 —
 * 메일이 전달되거나 새면 토큰도 함께 새기 때문에, 토큰만으로 계정을 만들 수 있게 두면
 * 그 메일을 본 사람 누구나 승인할 수 있다.
 *
 * 승인하면 여기서 계정을 만든다(role=PORTFOLIO, companyId 연결, active=true).
 * 비밀번호는 없다 — 이 행이 생기는 것이 곧 "이 주소로 로그인 링크를 받을 수 있다"는 뜻이다.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/authz';
import { getRequest, markDecided, canApproveAccess } from '@/lib/sparkscope/access-request';
import { sendNotice } from '@/lib/sparkscope/mailer';

export const runtime = 'nodejs';

const Body = z.object({
  token: z.string().trim().min(8).max(120),
  decision: z.enum(['approve', 'deny']),
});

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  // 승인은 지정된 사람만 — 사내 메일이면 전원 ADMIN 이기 때문이다(authz.ts).
  if (!canApproveAccess(auth.user.email)) {
    return NextResponse.json({ error: 'not_approver' }, { status: 403 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  const { token, decision } = parsed.data;

  const request = await getRequest(token);
  if (!request) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (request.status !== 'pending') {
    return NextResponse.json({ error: 'already_decided', status: request.status }, { status: 409 });
  }

  if (decision === 'deny') {
    await markDecided(token, 'denied', auth.user.email);
    return NextResponse.json({ ok: true, status: 'denied' });
  }

  // 승인 — 회사가 아직 존재하는지 다시 확인한다(요청 후 지워졌을 수 있다).
  const company = await prisma.monitoringTarget.findFirst({
    where: { id: request.companyId, category: { startsWith: 'portfolio_company' } },
    select: { id: true, name: true },
  });
  if (!company) return NextResponse.json({ error: 'unknown_company' }, { status: 400 });

  const existing = await prisma.user.findUnique({
    where: { email: request.email },
    select: { id: true, role: true },
  });
  // 사내 계정으로 이미 있는 주소를 포트폴리오사로 덮어쓰지 않는다.
  if (existing?.role === 'ADMIN') {
    return NextResponse.json({ error: 'already_staff' }, { status: 409 });
  }

  await prisma.user.upsert({
    where: { email: request.email },
    create: {
      email: request.email,
      name: request.name,
      role: 'PORTFOLIO',
      companyId: company.id,
      active: true,
      invitedBy: auth.user.email,
      invitedAt: new Date(),
    },
    update: {
      role: 'PORTFOLIO',
      companyId: company.id,
      active: true,
      invitedBy: auth.user.email,
      invitedAt: new Date(),
    },
  });

  await markDecided(token, 'approved', auth.user.email);

  // 신청자에게 알린다 — 승인됐고 이제 로그인 링크를 받을 수 있다는 것.
  const base = process.env.NEXTAUTH_URL ?? 'https://sparkscope.vercel.app';
  await sendNotice(
    request.email,
    '[SparkScope] 접근이 승인되었습니다',
    [
      `${request.name} 님, SparkScope 접근이 승인되었습니다.`,
      '',
      `아래에서 이 메일 주소(${request.email})를 입력하면 로그인 링크를 보내드립니다.`,
      `${base}/login`,
      '',
      `${company.name} 관련 자료를 보실 수 있습니다.`,
    ].join('\n'),
  ).catch(e => console.error('[access-request] 승인 알림 실패:', e));

  return NextResponse.json({ ok: true, status: 'approved', company: company.name });
}
