/**
 * 10월 13일 다이제스트 재발송 (1회용).
 *
 *   테스트(이수님 주소 한 통): npx tsx --env-file=.env.local scripts/resend-digest-1013.ts --test 주소
 *   전체 발송(구독자 전원):     npx tsx --env-file=.env.local scripts/resend-digest-1013.ts --send
 *
 * 기사 범위는 10/13 09:30 메일의 원래 범위(10/12 09:30 ~ 10/13 09:30)다. 평소 발송 경로는
 * "지난 메일 이후"만 보므로 지금은 후보가 0건이라 이 스크립트가 범위를 직접 지정한다.
 * 주가 기사는 buildDigestData(digest.ts)에서 빠진다. DB에는 쓰지 않는다(Digest 행도 건드리지 않음).
 * 제목: [SparkScope 재발송 안내] 2026/10/13 (화) — 포트폴리오 TOP1 제목
 */
import './_env';
import { prisma } from '../src/lib/prisma';
import { buildDigestForSend } from '../src/lib/sparkscope/runner';
import { renderDigestHtml } from '../src/lib/sparkscope/digest';
import { sendDigestEmail } from '../src/lib/sparkscope/mailer';
import { sendDigestToSubscribers } from '../src/lib/sparkscope/digest-send';
import type { AnalyzedArticle } from '../src/lib/sparkscope/types';

const BASE = 'https://sparkscope.vercel.app';
// 10/12 09:30 KST ~ 10/13 09:30 KST (UTC는 9시간 빼서 00:30Z)
const FROM = new Date('2026-10-12T00:30:00Z');
const TO = new Date('2026-10-13T00:30:00Z');

async function loadWindowArticles(): Promise<AnalyzedArticle[]> {
  const rows = await prisma.article.findMany({
    where: {
      pubDate: { gte: FROM, lt: TO },
      isNoise: false,
      category: { not: 'unrelated' },
      analyzedAt: { not: null },
    },
    select: {
      id: true, title: true, link: true, source: true, pubDate: true, matchedKeyword: true,
      category: true, importance: true, tone: true, oneLiner: true, ourTake: true,
      relatedCompanies: true, pitchScore: true, pitchTopic: true, riskFlag: true,
      isNoise: true, noiseReason: true, priorityScore: true,
    },
    orderBy: { priorityScore: 'desc' },
    take: 500,
  });
  return rows.map((a: any) => ({
    ...a,
    relatedCompanies: typeof a.relatedCompanies === 'string' ? JSON.parse(a.relatedCompanies) : (a.relatedCompanies ?? []),
  })) as AnalyzedArticle[];
}

async function main() {
  const testIdx = process.argv.indexOf('--test');
  const testTo = testIdx >= 0 ? process.argv[testIdx + 1] : undefined;
  const send = process.argv.includes('--send');
  if (!testTo && !send) {
    console.error('--test 주소 또는 --send 중 하나를 지정하세요.');
    process.exit(1);
  }

  const analyzed = await loadWindowArticles();
  console.log(`[resend] 기사 후보 ${analyzed.length}건 (10/12 09:30 ~ 10/13 09:30)`);
  const data = await buildDigestForSend(analyzed);

  const top1 = data.portfolioArticles[0]?.title ?? data.top3[0]?.title ?? '';
  const subject = `[SparkScope 재발송 안내] 2026/10/13 (화) — ${top1.slice(0, 30)}`;
  console.log(`[resend] 제목: ${subject}`);
  console.log(`[resend] TOP3: ${data.top3.map(a => a.title.slice(0, 25)).join(' | ')}`);
  console.log(`[resend] 포트폴리오 ${data.portfolioArticles.length}건 · 스파크랩 ${data.sparklabsArticles?.length ?? '-'}건`);

  if (testTo) {
    const html = renderDigestHtml(data, BASE, { subscriberToken: 'TEST' });
    const r = await sendDigestEmail({ subject, html, to: testTo });
    console.log(`[resend] 테스트 발송 → ${testTo}`, JSON.stringify(r).slice(0, 200));
    return;
  }

  const result = await sendDigestToSubscribers({ data, subject, baseUrl: BASE });
  console.log('[resend] 전체 발송 결과:', result ? `발송 ${result.sent}통 · 실패 ${result.failed.length}건 · 전체 해제 제외 ${result.skippedEmpty}명` : '구독자 없음');
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
