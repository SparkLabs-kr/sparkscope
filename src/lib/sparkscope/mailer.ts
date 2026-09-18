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

/**
 * 사람마다 다른 본문을 한 번의 API 호출로 여러 통 보낸다(Resend batch).
 *
 * 구독제로 바뀌면서 수신자마다 본문이 달라졌는데, 한 통씩 보내면 호출이 사람 수만큼 늘고
 * to에 전원을 넣으면 서로의 주소가 노출된다. batch는 "각자에게 각자의 본문"을 한 호출로
 * 처리해서 둘 다 피한다. 한 번에 100통이 상한이라 그 단위로 끊어 보낸다.
 *
 * 한 통이 실패해도 나머지는 계속 보낸다 — 주소 하나가 잘못됐다고 전원이 못 받으면 안 된다.
 * 실패한 주소는 그대로 돌려줘서 호출부가 기록한다.
 */
const BATCH_LIMIT = 100;

export interface BatchMail {
  to: string;
  subject: string;
  html: string;
}

export async function sendDigestBatch(
  mails: BatchMail[],
): Promise<{ sent: number; failed: { email: string; error: string }[] }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY is not set');
  if (mails.length === 0) return { sent: 0, failed: [] };

  const from = process.env.DIGEST_FROM_EMAIL ?? 'sparkscope@sparklabs.co.kr';
  const resend = new Resend(apiKey);

  let sent = 0;
  const failed: { email: string; error: string }[] = [];

  for (let i = 0; i < mails.length; i += BATCH_LIMIT) {
    const chunk = mails.slice(i, i + BATCH_LIMIT);
    try {
      const { error } = await resend.batch.send(
        chunk.map(m => ({ from: `SparkScope <${from}>`, to: [m.to], subject: m.subject, html: m.html })),
      );
      if (error) {
        // 묶음 단위 실패 — 어느 주소가 문제인지 Resend가 알려주지 않으므로 묶음 전체를 실패로 기록한다.
        chunk.forEach(m => failed.push({ email: m.to, error: String(error.message ?? error).slice(0, 200) }));
        console.error(`[mailer] batch ${i / BATCH_LIMIT + 1} 실패:`, error);
      } else {
        sent += chunk.length;
      }
    } catch (e: any) {
      chunk.forEach(m => failed.push({ email: m.to, error: String(e?.message ?? e).slice(0, 200) }));
      console.error(`[mailer] batch ${i / BATCH_LIMIT + 1} 예외:`, e?.message ?? e);
    }
  }

  console.log(`[mailer] batch 발송 완료 — 성공 ${sent}통, 실패 ${failed.length}통`);
  return { sent, failed };
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

/**
 * 지정한 주소로 알림 메일을 보낸다. 발신은 인증된 도메인(DIGEST_FROM_EMAIL)을 쓴다.
 *
 * sendOwnerAlert 를 쓰면 안 되는 이유: 그쪽 발신은 onboarding@resend.dev 로,
 * 도메인 미인증일 때를 위한 최선노력 경로다. Resend 의 그 발신 주소는 계정
 * 소유자 본인 주소로만 배달되므로 marketing@ 같은 곳으로는 조용히 실패한다.
 * sparklabs.co.kr 은 이미 verified 이므로 정식 발신을 쓴다.
 *
 * 실패하면 false 를 돌려주고, 부르는 쪽이 그 사실을 기록한다.
 */
export async function sendNotice(
  to: string | string[],
  subject: string,
  text: string,
): Promise<{ ok: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const toList = (Array.isArray(to) ? to : to.split(',')).map(s => s.trim()).filter(Boolean);
  if (!apiKey) return { ok: false, error: 'RESEND_API_KEY 미설정' };
  if (toList.length === 0) return { ok: false, error: '수신자 없음' };
  const from = process.env.DIGEST_FROM_EMAIL ?? 'sparkscope@sparklabs.co.kr';
  try {
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from: `SparkScope <${from}>`,
      to: toList,
      subject,
      html: `<pre style="font-family:sans-serif;white-space:pre-wrap;font-size:14px;line-height:1.6">${text}</pre>`,
    });
    if (error) return { ok: false, error: String(error.message ?? error).slice(0, 300) };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) };
  }
}

/** 정식 발송이 막힐 때(도메인 미인증 등) 담당자에게 onboarding 발신으로 최선노력 알림. 콤마로 여러 명 지정 가능. */
export async function sendOwnerAlert(to: string | string[], subject: string, text: string): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const toList = (Array.isArray(to) ? to : to.split(',')).map(s => s.trim()).filter(Boolean);
  if (!apiKey || toList.length === 0) return false;
  try {
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from: 'SparkScope <onboarding@resend.dev>',
      to: toList,
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
