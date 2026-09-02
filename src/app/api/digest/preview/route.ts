// 다이제스트 검수 미리보기 — 편집자 오버라이드를 반영해 실제 발송 HTML을 그대로 반환.
import { NextResponse } from 'next/server';
import { adminOrNull } from '@/lib/authz';
import { loadDigestCandidates, buildReviewDigest, type ReviewOverrides } from '@/lib/sparkscope/review';
import { renderDigestHtml } from '@/lib/sparkscope/digest';
import { attachInterDigest } from '@/lib/sparkscope/inter-digest';
import { buildSubject } from '@/lib/sparkscope/mailer';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  // ⚠️ 렌더된 다이제스트 본문(그날의 큐레이션된 내부 뉴스)이 그대로 나온다.
  //    가드가 없던 동안 미인증 POST로 누구나 받아갈 수 있었다.
  //    검수 화면(/digest/review)이 관리자 전용이므로 여기도 같은 기준으로 막는다.
  if (!(await adminOrNull())) {
    return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as ReviewOverrides;
  const candidates = await loadDigestCandidates();
  const data = await attachInterDigest(buildReviewDigest(candidates, body));
  const baseUrl = process.env.NEXTAUTH_URL ?? new URL(req.url).origin;
  const html = renderDigestHtml(data, baseUrl);
  const subject = buildSubject(data.dateLabel, data.top3[0]?.title);
  return NextResponse.json({ html, subject });
}
