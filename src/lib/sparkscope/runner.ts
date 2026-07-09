/**
 * 일일 다이제스트 전체 실행 — 수집 → 분석 → 저장 → 메일 발송.
 * /api/cron/daily-digest 와 /scripts/run-digest.ts 양쪽에서 호출.
 */
import { prisma } from '@/lib/prisma';
import { collectAllArticles } from './collector';
import { analyzeArticles, generateEditorIntro } from './analyzer';
import { buildDigestData, renderDigestHtml } from './digest';
import { sendDigestEmail, buildSubject, isSendDomainVerified, sendOwnerAlert } from './mailer';

export interface RunOptions {
  send?: boolean;            // 실제 메일 발송 여부 (false면 DB 저장까지만)
  testRecipient?: string;    // 명시 수신자 (미지정 시 전사 그룹 DIGEST_TO_GROUP)
  bcc?: string | string[];   // 숨은참조 (미지정 시 DIGEST_BCC → DIGEST_TEST_RECIPIENT)
  baseUrl?: string;          // 대시보드 링크 도메인
  dryRun?: boolean;          // 외부 호출 없이 시뮬레이션
}

export async function runDailyDigest(opts: RunOptions = {}) {
  const log = await prisma.runLog.create({
    data: { runType: 'daily', status: 'RUNNING' },
  });

  try {
    // 1. 수집 (환경변수로 상한·기간 조절 가능 — 미설정 시 기존 기본값)
    const maxPerCat = process.env.COLLECT_MAX_PER_CATEGORY ? Number(process.env.COLLECT_MAX_PER_CATEGORY) : 30;
    const daysBack = process.env.COLLECT_DAYS_BACK ? Number(process.env.COLLECT_DAYS_BACK) : undefined;
    const raw = await collectAllArticles({ maxKeywordsPerCategory: maxPerCat, daysBack });

    // 2. 분석에 필요한 컨텍스트
    const portfolioTargets = await prisma.monitoringTarget.findMany({
      where: { category: 'portfolio_company', status: 'ACTIVE' },
      select: { name: true },
    });
    const portfolioUniverse = portfolioTargets.map(t => t.name);

    const trendTargets = await prisma.monitoringTarget.findMany({
      where: { category: 'industry_trend', status: 'ACTIVE' },
      select: { name: true },
    });
    const trendingTopics = trendTargets.map(t => t.name);

    // 3. 분석 (Claude)
    const analyzed = await analyzeArticles(raw, portfolioUniverse, trendingTopics);
    console.log(`[runner] analyzed ${analyzed.length} articles`);

    // 4. DB 저장 (upsert by link)
    for (const a of analyzed) {
      await prisma.article.upsert({
        where: { link: a.link },
        create: {
          title: a.title,
          link: a.link,
          source: a.source,
          pubDate: a.pubDate,
          matchedKeyword: a.matchedKeyword,
          category: a.category,
          importance: a.importance,
          tone: a.tone,
          oneLiner: a.oneLiner,
          ourTake: a.ourTake,
          relatedCompanies: JSON.stringify(a.relatedCompanies),
          pitchScore: a.pitchScore,
          pitchTopic: a.pitchTopic,
          riskFlag: a.riskFlag,
          isNoise: a.isNoise,
          noiseReason: a.noiseReason,
          priorityScore: a.priorityScore,
          analyzedAt: new Date(),
        },
        update: {
          importance: a.importance,
          tone: a.tone,
          oneLiner: a.oneLiner,
          ourTake: a.ourTake,
          relatedCompanies: JSON.stringify(a.relatedCompanies),
          pitchScore: a.pitchScore,
          pitchTopic: a.pitchTopic,
          riskFlag: a.riskFlag,
          priorityScore: a.priorityScore,
          analyzedAt: new Date(),
        },
      });
    }

    // 5. 편집자 인사
    const sortedTop3 = [...analyzed].sort((a, b) => b.priorityScore - a.priorityScore).slice(0, 3);
    const editorIntro = await generateEditorIntro(sortedTop3);

    // 6. 다이제스트 데이터 + HTML (본부 스크랩 기사 TOP3 우선 반영)
    const scrapped = await prisma.article.findMany({ where: { isScrapped: true }, select: { link: true } });
    const scrappedLinks = new Set(scrapped.map(s => s.link));
    const data = buildDigestData(analyzed, editorIntro, undefined, scrappedLinks);
    const html = renderDigestHtml(data, opts.baseUrl);
    const subject = buildSubject(data.dateLabel, data.top3[0]?.title);

    // 7. DB에 다이제스트 저장 — KST 기준 오늘
    const kstNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
    const today = new Date(kstNow.getFullYear(), kstNow.getMonth(), kstNow.getDate(), 0, 0, 0, 0);
    const digestRecord = await prisma.digest.upsert({
      where: { date: today },
      create: { date: today, subject, htmlBody: html },
      update: { subject, htmlBody: html, sentAt: null, errorMsg: null },
    });

    // 8. 메일 발송 — 발송 직전 발신 도메인 인증 여부 확인(미인증이면 전원 발송 스킵, 담당자 알림)
    let mailResult: any = null;
    let skipped: string | undefined;
    // BCC는 DIGEST_BCC가 명시적으로 설정된 경우에만. (TEST_RECIPIENT로 폴백하면 중복 수신 위험)
    const bcc = opts.bcc ?? process.env.DIGEST_BCC ?? undefined;
    if (opts.send && !opts.dryRun) {
      const domain = await isSendDomainVerified();
      if (!domain.verified) {
        // 미인증: 전원 발송 스킵 + 담당자(BCC/테스트 수신자)에게 최선노력 알림
        skipped = `domain_unverified(${domain.status})`;
        const alertTo = (Array.isArray(bcc) ? bcc[0] : bcc) ?? process.env.DIGEST_TEST_RECIPIENT ?? '';
        const notified = await sendOwnerAlert(
          alertTo,
          '[SparkScope] 다이제스트 발송 스킵 — 발신 도메인 미인증',
          `발신 도메인(${domain.domain}) Resend 인증 상태: ${domain.status}\n\n전원 발송 실패를 막기 위해 이번 발송을 건너뛰었습니다.\nResend에서 도메인이 verified 되면 다음 스케줄에 정상 발송됩니다.`,
        );
        await prisma.digest.update({ where: { id: digestRecord.id }, data: { errorMsg: `발송 스킵: 도메인 미인증(${domain.status}) / 알림 ${notified ? '성공' : '실패'}` } });
        console.warn(`[runner] 발신 도메인 미인증(${domain.status}) — 전원 발송 스킵, 알림 ${notified ? 'OK' : 'FAIL'}`);
      } else {
        const to = opts.testRecipient ?? process.env.DIGEST_TO_GROUP; // cron: 전사 그룹
        try {
          mailResult = await sendDigestEmail({ subject, html, to, bcc });
          await prisma.digest.update({ where: { id: digestRecord.id }, data: { sentAt: new Date(), recipients: 1 } });
        } catch (e: any) {
          await prisma.digest.update({ where: { id: digestRecord.id }, data: { errorMsg: String(e?.message ?? e) } });
          throw e;
        }
      }
    }

    await prisma.runLog.update({
      where: { id: log.id },
      data: {
        finishedAt: new Date(),
        status: skipped ? 'SKIPPED' : 'SUCCESS',
        collected: raw.length,
        analyzed: analyzed.length,
        errors: skipped ? `발송 스킵: ${skipped}` : undefined,
      },
    });

    return {
      ok: true,
      collected: raw.length,
      analyzed: analyzed.length,
      digestId: digestRecord.id,
      mailResult,
      skipped,
      subject,
    };
  } catch (e: any) {
    await prisma.runLog.update({
      where: { id: log.id },
      data: { finishedAt: new Date(), status: 'FAILED', errors: String(e?.message ?? e) },
    });
    throw e;
  }
}
