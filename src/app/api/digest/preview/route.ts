// 다이제스트 검수 미리보기 — 편집자 오버라이드를 반영해 실제 발송 HTML을 그대로 반환.
import { NextResponse } from 'next/server';
import { loadDigestCandidates, buildReviewDigest, type ReviewOverrides } from '@/lib/sparkscope/review';
import { renderDigestHtml } from '@/lib/sparkscope/digest';
import { buildSubject } from '@/lib/sparkscope/mailer';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as ReviewOverrides;
  const candidates = await loadDigestCandidates();
  const data = buildReviewDigest(candidates, body);
  const baseUrl = process.env.NEXTAUTH_URL ?? new URL(req.url).origin;
  const html = renderDigestHtml(data, baseUrl);
  const subject = buildSubject(data.dateLabel, data.top3[0]?.oneLiner);
  return NextResponse.json({ html, subject });
}
