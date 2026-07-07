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
  bcc?: string | string[];
}

export async function sendDigestEmail({ subject, html, to, bcc }: SendDigestParams) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY is not set');

  const from = process.env.DIGEST_FROM_EMAIL ?? 'sparkscope@sparklabs.co.kr';
  // 시범 운영 우선순위: 명시적 to > TEST_RECIPIENT > GROUP
  const recipient =
    to ?? process.env.DIGEST_TEST_RECIPIENT ?? process.env.DIGEST_TO_GROUP ?? '';

  if (!recipient) throw new Error('No recipient configured (DIGEST_TEST_RECIPIENT or DIGEST_TO_GROUP)');

  const bccList = bcc ? (Array.isArray(bcc) ? bcc : [bcc]).filter(Boolean) : undefined;

  const resend = new Resend(apiKey);
  const { data, error } = await resend.emails.send({
    from: `SparkScope <${from}>`,
    to: Array.isArray(recipient) ? recipient : [recipient],
    ...(bccList && bccList.length ? { bcc: bccList } : {}),
    subject,
    html,
  });

  if (error) {
    console.error('[mailer] Resend error:', error);
    throw new Error(`Resend failed: ${error.message}`);
  }

  console.log(`[mailer] sent to ${Array.isArray(recipient) ? recipient.join(', ') : recipient}${bccList?.length ? ` (bcc: ${bccList.join(', ')})` : ''}, id=${data?.id}`);
  return { id: data?.id, recipient, bcc: bccList };
}

/** 발신 도메인(DIGEST_FROM_EMAIL의 도메인)의 Resend 인증 상태 확인. */
export function digestFromDomain(): string {
  const from = process.env.DIGEST_FROM_EMAIL ?? 'sparkscope@sparklabs.co.kr';
  return from.split('@')[1] ?? '';
}

export async function isSendDomainVerified(): Promise<{ verified: boolean; status: string; domain: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const domain = digestFromDomain();
  if (!apiKey) return { verified: false, status: 'no_api_key', domain };
  try {
    const res = await fetch('https://api.resend.com/domains', { headers: { Authorization: `Bearer ${apiKey}` } });
    const json: any = await res.json();
    const d = (json?.data ?? []).find((x: any) => x.name === domain);
    return { verified: d?.status === 'verified', status: d?.status ?? 'not_found', domain };
  } catch (e: any) {
    return { verified: false, status: `error:${String(e?.message ?? e)}`, domain };
  }
}

/** 정식 발송이 막힐 때(도메인 미인증 등) 담당자에게 onboarding 발신으로 최선노력 알림. */
export async function sendOwnerAlert(to: string, subject: string, text: string): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || !to) return false;
  try {
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from: 'SparkScope <onboarding@resend.dev>',
      to: [to],
      subject,
      html: `<pre style="font-family:sans-serif;white-space:pre-wrap">${text}</pre>`,
    });
    return !error;
  } catch {
    return false;
  }
}

export function buildSubject(dateLabel: string, top1Title?: string): string {
  const short = top1Title ? top1Title.slice(0, 30) : '오늘의 미디어 다이제스트';
  return `[SparkScope] ${dateLabel.replace('년 ', '/').replace('월 ', '/').replace('일', '')} — ${short}`;
}
