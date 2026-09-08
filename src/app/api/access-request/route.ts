/**
 * 포트폴리오사 접근 요청 접수 — 로그인 없이 부를 수 있는 유일한 쓰기 API.
 *
 * 대표는 아직 계정이 없으므로 로그인시킬 수 없다. 대신 받는 값을 좁게 검증한다:
 *  · companyId 는 실제 포트폴리오사 행이어야 한다(자유 입력을 신뢰하지 않는다)
 *  · 같은 메일로 대기 중인 요청이 있으면 새로 만들지 않는다(중복 메일 방지)
 *  · 이미 계정이 있으면 요청을 만들지 않고 그렇다고 알려준다
 *
 * 접수 자체는 아무 권한도 주지 않는다. 계정은 마케팅팀이 승인할 때 만들어진다.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { createRequest } from '@/lib/sparkscope/access-request';
import { sendOwnerAlert } from '@/lib/sparkscope/mailer';
import { isStaffEmail } from '@/lib/auth';

export const runtime = 'nodejs';

const Body = z.object({
  email: z.string().trim().email().max(200),
  name: z.string().trim().min(1).max(80),
  title: z.string().trim().max(80).default(''),
  companyId: z.string().trim().min(1).max(80),
  referrer: z.string().trim().max(120).default(''),
});

/** 승인 요청을 받을 사람. 없으면 사내 도메인 대표 주소로 보낸다. */
function reviewers(): string[] {
  const raw = process.env.ACCESS_REQUEST_REVIEWERS ?? 'marketing@sparklabs.co.kr';
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400 });
  }
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid', detail: parsed.error.flatten() }, { status: 400 });
  }
  const { email, name, title, companyId, referrer } = parsed.data;
  const addr = email.toLowerCase();

  // 사내 메일은 요청이 필요 없다 — 그냥 로그인하면 된다.
  if (isStaffEmail(addr)) {
    return NextResponse.json({ ok: true, staff: true }, { status: 200 });
  }

  // 이미 계정이 있으면 새 요청을 만들지 않는다.
  const existingUser = await prisma.user.findUnique({
    where: { email: addr },
    select: { active: true },
  });
  if (existingUser) {
    return NextResponse.json({ ok: true, alreadyHasAccount: existingUser.active }, { status: 200 });
  }

  // companyId 를 실제 행으로 확인한다. 여기서 막지 않으면 승인 시점에
  // 존재하지 않는 회사에 계정을 묶으려다 실패한다.
  const company = await prisma.monitoringTarget.findFirst({
    where: { id: companyId, category: { startsWith: 'portfolio_company' } },
    select: { id: true, name: true },
  });
  if (!company) {
    return NextResponse.json({ error: 'unknown_company' }, { status: 400 });
  }

  const { created, request } = await createRequest({
    email: addr, name, title, companyId: company.id, companyName: company.name, referrer,
  });

  if (created) {
    const base = process.env.NEXTAUTH_URL ?? 'https://sparkscope.vercel.app';
    const lines = [
      `${company.name} — ${name}${title ? ` (${title})` : ''} 님이 SparkScope 접근을 요청했습니다.`,
      '',
      `메일:     ${addr}`,
      `회사:     ${company.name}`,
      `소개자:   ${referrer || '(없음)'}`,
      `요청시각: ${request.requestedAt}`,
      '',
      '아래에서 승인 또는 거절하세요 (관리자 로그인이 필요합니다):',
      `${base}/dashboard/accounts?request=${request.token}`,
      '',
      '승인하면 이 주소로 로그인 링크를 받을 수 있게 되고, 그 계정은',
      `${company.name} 자료만 볼 수 있습니다.`,
    ].join('\n');
    // 메일이 실패해도 요청은 남는다 — 승인 화면에서 볼 수 있다.
    await sendOwnerAlert(reviewers(), `[SparkScope] 접근 요청 — ${company.name}`, lines)
      .catch(e => console.error('[access-request] 알림 메일 실패:', e));
  }

  return NextResponse.json({ ok: true, created }, { status: 200 });
}
