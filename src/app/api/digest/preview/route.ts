// 다이제스트 검수 미리보기 — 편집자 오버라이드를 반영해 실제 발송 HTML을 그대로 반환.
import { NextResponse } from 'next/server';
import { loadDigestCandidates, buildReviewDigest, type ReviewOverrides } from '@/lib/sparkscope/review';
import { renderDigestHtml } from '@/lib/sparkscope/digest';
import { attachInterDigest } from '@/lib/sparkscope/inter-digest';
import { attachAiSignals } from '@/lib/sparkscope/signal-digest';
import { buildSubject } from '@/lib/sparkscope/mailer';
import { requireAdmin } from '@/lib/authz';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  // 포트폴리오사 계정은 열람 전용이다 — 쓰기는 사내 계정만.
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;
  const body = (await req.json().catch(() => ({}))) as ReviewOverrides;
  const candidates = await loadDigestCandidates();
  const data = await attachAiSignals(await attachInterDigest(buildReviewDigest(candidates, body)));
  const baseUrl = process.env.NEXTAUTH_URL ?? new URL(req.url).origin;
  const html = renderDigestHtml(data, baseUrl);
  const subject = buildSubject(data.dateLabel, data.top3[0]?.title);
  return NextResponse.json({ html, subject });
}
