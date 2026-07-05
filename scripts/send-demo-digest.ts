/**
 * 시연용 다이제스트 1통 발송 — 재수집 없이 최근 DB 후보로 구성해 실제 발송.
 *   npx tsx scripts/send-demo-digest.ts <수신이메일>
 * 발신 도메인 미인증 시 DIGEST_FROM_EMAIL 환경변수로 발신주소 오버라이드 가능
 *   (예: onboarding@resend.dev — Resend 테스트 발신).
 * (tsx는 .env.local 자동 로드 안 함 — 실행 전 env 주입 필요)
 */
import { loadDigestCandidates, buildReviewDigest } from '../src/lib/sparkscope/review';
import { renderDigestHtml } from '../src/lib/sparkscope/digest';
import { sendDigestEmail, buildSubject } from '../src/lib/sparkscope/mailer';

(async () => {
  const to = process.argv[2] || process.env.DIGEST_TEST_RECIPIENT;
  if (!to) { console.error('수신 이메일을 인자로 주세요.'); process.exit(1); }

  const candidates = await loadDigestCandidates();
  const intro = '이번 주 스파크랩·포트폴리오사·AC·VC 업계 주요 보도를 정리했습니다. 아래 오늘의 핵심 TOP 3부터 확인해 주세요.';
  const data = buildReviewDigest(candidates, { editorIntro: intro });
  const baseUrl = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
  const html = renderDigestHtml(data, baseUrl);
  const subject = buildSubject(data.dateLabel, data.top3[0]?.oneLiner);

  console.log(`[send-demo] 후보 ${candidates.length}건 · 수신 ${to} · 발신 ${process.env.DIGEST_FROM_EMAIL ?? 'sparkscope@sparklabs.co.kr'}`);
  console.log(`[send-demo] 제목: ${subject}`);
  try {
    const res = await sendDigestEmail({ subject, html, to });
    console.log('[send-demo] ✅ 발송 성공:', JSON.stringify(res));
  } catch (e: any) {
    console.error('[send-demo] ❌ 발송 실패:', String(e?.message ?? e));
    process.exit(1);
  }
  process.exit(0);
})();
