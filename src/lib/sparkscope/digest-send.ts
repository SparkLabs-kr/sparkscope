/**
 * 구독자별 다이제스트 발송.
 *
 * 예전엔 전사 구글 그룹 한 곳으로 같은 메일이 1통 나갔다. 지금은 사람마다 고른 섹션이 달라서
 * 본문이 갈리는데, 그렇다고 사람 수만큼 본문을 만들 필요는 없다 — 같은 조합을 고른 사람끼리는
 * 본문이 완전히 같기 때문이다. 그래서
 *   ① 구독 조합(prefsKey)별로 본문을 한 번씩만 만들고
 *   ② 배달은 Resend batch로 1인 1통씩 한다(서로의 주소가 안 보이고, 푸터 설정 링크도 각자 것).
 * 30명이 구독해도 조합이 4가지면 렌더는 4번, 배달은 30통이다.
 *
 * 구독자가 한 명도 없으면 null을 돌려준다 — 부르는 쪽(runner.ts)은 그때 예전처럼 그룹으로
 * 보낸다. 시드 전에 배포되더라도 메일이 멈추지 않게 하려는 장치다.
 *
 * DIGEST_BCC는 이 경로에서 쓰지 않는다. 사람마다 다른 메일이 N통 나가는데 전부 BCC를 걸면
 * 담당자 메일함이 N배로 쌓인다. 담당자도 보고 싶으면 구독자로 넣으면 된다.
 */
import { prisma } from '@/lib/prisma';
import type { DigestData } from './types';
import { renderDigestHtml } from './digest';
import { sendDigestBatch, type BatchMail } from './mailer';
import {
  applySubscription,
  isEmptyPrefs,
  prefsKey,
  toPrefs,
  type SectionPrefs,
} from './subscription';

/**
 * 조합별로 한 번 그린 본문에서 사람마다 달라지는 유일한 부분이 푸터의 구독 설정 토큰이다.
 * 렌더할 때 이 자리표시자를 넣어 두고, 배달 직전에 각자의 토큰으로 바꿔 끼운다.
 */
export const SUBSCRIBER_TOKEN_PLACEHOLDER = '__SPARKSCOPE_SUB_TOKEN__';

export interface SubscriberSendResult {
  /** 실제로 만든 본문 가짓수 */
  variants: number;
  /** 배달 성공 통수 */
  sent: number;
  /** 고른 섹션이 하나도 없어 보낼 내용이 없던 사람 수 */
  skippedEmpty: number;
  failed: { email: string; error: string }[];
}

/**
 * 활성 구독자 전원에게 각자의 구독 설정에 맞춘 메일을 보낸다.
 * 구독자가 아무도 없으면 null (호출부가 그룹 발송으로 폴백한다).
 */
export async function sendDigestToSubscribers(params: {
  data: DigestData;
  subject: string;
  baseUrl?: string;
  /** true면 실제로 보내지 않고 몇 통이 어떻게 나갈지만 계산한다. */
  dryRun?: boolean;
}): Promise<SubscriberSendResult | null> {
  const { data, subject, baseUrl, dryRun } = params;

  const subscribers = await prisma.digestSubscriber.findMany({
    where: { active: true },
    select: {
      email: true, token: true,
      sparklabs: true, portfolio: true, inter: true,
      aiSignals: true, competitor: true, industry: true,
    },
  });
  if (subscribers.length === 0) return null;

  // 같은 조합끼리 묶는다 — 본문을 만드는 횟수를 조합 수로 줄이기 위한 것.
  const groups = new Map<string, { prefs: SectionPrefs; people: { email: string; token: string }[] }>();
  let skippedEmpty = 0;
  for (const s of subscribers) {
    const prefs = toPrefs(s);
    if (isEmptyPrefs(prefs)) { skippedEmpty++; continue; }
    const key = prefsKey(prefs);
    const g = groups.get(key) ?? { prefs, people: [] };
    g.people.push({ email: s.email, token: s.token });
    groups.set(key, g);
  }

  const mails: BatchMail[] = [];
  for (const { prefs, people } of groups.values()) {
    const scoped = applySubscription(data, prefs);
    const html = renderDigestHtml(scoped, baseUrl, {
      prefs,
      subscriberToken: SUBSCRIBER_TOKEN_PLACEHOLDER,
    });
    for (const p of people) {
      mails.push({
        to: p.email,
        subject,
        // 토큰은 cuid라 HTML 이스케이프가 필요 없는 문자만 나온다.
        html: html.split(SUBSCRIBER_TOKEN_PLACEHOLDER).join(p.token),
      });
    }
  }

  console.log(
    `[digest-send] 구독자 ${subscribers.length}명 → 본문 ${groups.size}종 · 배달 ${mails.length}통` +
    (skippedEmpty ? ` · 전체 해제 ${skippedEmpty}명 제외` : '') +
    (dryRun ? ' (dry-run)' : ''),
  );

  if (dryRun) {
    return { variants: groups.size, sent: 0, skippedEmpty, failed: [] };
  }

  const { sent, failed } = await sendDigestBatch(mails);
  return { variants: groups.size, sent, skippedEmpty, failed };
}
