/**
 * Resend 기반 메일 발송기.
 * 시범 운영 중 DIGEST_TEST_RECIPIENT만 설정되어 있으면 그쪽으로,
 * 정식 운영 시 DIGEST_TO_GROUP으로 전환.
 */
import { Resend } from 'resend';

export interface SendDigestParams {
  subject: string;
  html: string;
  to?: string | string[];
}

export async function sendDigestEmail({ subject, html, to }: SendDigestParams) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY is not set');

  const from = process.env.DIGEST_FROM_EMAIL ?? 'sparkscope@sparklabs.co.kr';
  // 시범 운영 우선순위: 명시적 to > TEST_RECIPIENT > GROUP
  const recipient =
    to ?? process.env.DIGEST_TEST_RECIPIENT ?? process.env.DIGEST_TO_GROUP ?? '';

  if (!recipient) throw new Error('No recipient configured (DIGEST_TEST_RECIPIENT or DIGEST_TO_GROUP)');

  const resend = new Resend(apiKey);
  const { data, error } = await resend.emails.send({
    from: `SparkScope <${from}>`,
    to: Array.isArray(recipient) ? recipient : [recipient],
    subject,
    html,
  });

  if (error) {
    console.error('[mailer] Resend error:', error);
    throw new Error(`Resend failed: ${error.message}`);
  }

  console.log(`[mailer] sent to ${Array.isArray(recipient) ? recipient.join(', ') : recipient}, id=${data?.id}`);
  return { id: data?.id, recipient };
}

export function buildSubject(dateLabel: string, top1Title?: string): string {
  const short = top1Title ? top1Title.slice(0, 30) : '오늘의 미디어 다이제스트';
  return `[SparkScope] ${dateLabel.replace('년 ', '/').replace('월 ', '/').replace('일', '')} — ${short}`;
}
