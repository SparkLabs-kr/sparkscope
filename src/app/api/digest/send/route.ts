// 다이제스트 검수 발송 — 편집자 오버라이드 반영 HTML을 실제 발송. SCRAP_ALLOWED_EMAILS만.
import { NextResponse } from 'next/server';
import { scrapperOrNull } from '@/lib/authz';
import { prisma } from '@/lib/prisma';
import { loadDigestCandidates, buildReviewDigest, type ReviewOverrides } from '@/lib/sparkscope/review';
import { renderDigestHtml } from '@/lib/sparkscope/digest';
import { attachInterDigest } from '@/lib/sparkscope/inter-digest';
import { sendDigestEmail, buildSubject } from '@/lib/sparkscope/mailer';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const actor = await scrapperOrNull();
  const email = actor?.email ?? null;
  if (!actor) {
    return NextResponse.json({ error: '발송 권한이 없습니다. (SCRAP_ALLOWED_EMAILS 지정 계정만 가능)' }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as ReviewOverrides & { testRecipient?: string };
  const candidates = await loadDigestCandidates();
  const data = await attachInterDigest(buildReviewDigest(candidates, body));
  const baseUrl = process.env.NEXTAUTH_URL ?? new URL(req.url).origin;
  const html = renderDigestHtml(data, baseUrl);
  const subject = buildSubject(data.dateLabel, data.top3[0]?.title);

  try {
    const result = await sendDigestEmail({ subject, html, to: body.testRecipient });
    // 발송 기록 (오늘 날짜 기준 upsert)
    const today = new Date(new Date().setHours(0, 0, 0, 0));
    await prisma.digest.upsert({
      where: { date: today },
      create: { date: today, subject, htmlBody: html, sentAt: new Date(), recipients: 1 },
      update: { subject, htmlBody: html, sentAt: new Date(), errorMsg: null },
    });
    return NextResponse.json({ ok: true, subject, recipient: result.recipient });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
