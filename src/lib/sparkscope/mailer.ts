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

/**
 * 포트폴리오사 계정 발급 안내 메일.
 *
 * sendDigestEmail을 쓰지 않는 이유: 그 함수는 to가 비면 DIGEST_TEST_RECIPIENT →
 * DIGEST_TO_GROUP 으로 폴백한다. 초대장이 실수로 전체 그룹에 나가면 안 되므로
 * 수신자를 필수 인자로 받는 별도 함수를 둔다.
 *
 * 포트폴리오사는 한국·대만이 섞여 있어 한 통에 한국어와 영어를 함께 담는다.
 * 본문에 발급된 주소를 그대로 박아두는 게 중요하다 — 가장 흔한 실패가
 * "회사 도메인은 맞지만 발급받은 주소가 아닌 주소로 로그인 시도"이기 때문이다.
 */
export async function sendPortfolioInvite(params: {
  to: string;
  companyName: string;
  loginUrl: string;
  invitedBy?: string;
}): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY is not set');
  if (!params.to) throw new Error('sendPortfolioInvite: 수신자가 없습니다');

  const from = process.env.DIGEST_FROM_EMAIL ?? 'sparkscope@sparklabs.co.kr';
  const { to, companyName, loginUrl, invitedBy } = params;
  const esc = (v: string) =>
    v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const subject = `[SparkScope] ${companyName} 언론 보도 현황 · Your SparkScope access`;

  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#F5F3EF;font-family:-apple-system,BlinkMacSystemFont,'Malgun Gothic','Apple SD Gothic Neo',sans-serif;color:#1A1A1A;line-height:1.6">
  <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #E7E3DB;border-radius:12px;padding:28px">
    <div style="font-size:11px;font-weight:700;letter-spacing:.16em;color:#5046E5">SPARKSCOPE</div>

    <h1 style="font-size:20px;margin:10px 0 6px">${esc(companyName)} 언론 보도 현황</h1>
    <p style="font-size:14px;color:#514E5C;margin:0 0 18px">
      스파크랩스가 ${esc(companyName)}의 언론 보도를 모아 보여드립니다.
      아래 주소로 접속해 이 메일 주소를 입력하면 로그인 링크가 발송됩니다.
    </p>

    <a href="${esc(loginUrl)}" style="display:block;background:#5046E5;color:#fff;text-decoration:none;font-weight:700;font-size:14px;text-align:center;border-radius:9px;padding:12px">
      SparkScope 열기 · Open SparkScope
    </a>

    <div style="margin-top:18px;background:#FAF8F4;border:1px solid #E7E3DB;border-radius:9px;padding:13px 15px">
      <div style="font-size:12px;font-weight:700;margin-bottom:4px">로그인에 사용할 주소 · Use this address</div>
      <div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;color:#5046E5">${esc(to)}</div>
      <div style="font-size:11.5px;color:#8B8894;margin-top:6px">
        비밀번호는 없습니다. 이 주소로만 로그인되며, 같은 회사 도메인의 다른 주소로는 되지 않습니다.<br>
        No password. Only this exact address works — another address at the same company domain will not.
      </div>
    </div>

    <hr style="border:0;border-top:1px solid #E7E3DB;margin:20px 0">
    <p style="font-size:12px;color:#8B8894;margin:0">
      계정은 스파크랩스에서 발급합니다. 문의는${invitedBy ? ` ${esc(invitedBy)} 로` : ' 담당 매니저에게'} 주세요.<br>
      Accounts are issued by SparkLabs. Reply to this email with any questions.
    </p>
  </div>
</body></html>`;

  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from: `SparkScope <${from}>`,
    to: [to],
    subject,
    html,
  });
  if (error) {
    console.error('[mailer] 발급 안내 메일 실패:', error);
    return false;
  }
  return true;
}
