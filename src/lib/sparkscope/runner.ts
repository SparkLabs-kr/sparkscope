/**
 * 일일 다이제스트 전체 실행 — 수집 → 분석 → 저장 → 메일 발송.
 * /api/cron/daily-digest 와 /scripts/run-digest.ts 양쪽에서 호출.
 */
import { prisma } from '@/lib/prisma';
import type { RawArticle, AnalyzedArticle } from './types';
import { collectAllArticles, CATEGORY_PRIORITY } from './collector';
import { normalizeTitleKey } from './relevance';
import { normalizeSource } from './media';
import { analyzeArticles, generateEditorIntro } from './analyzer';
import { computeAndStoreDashboardInsights } from './dashboard-insights';
import { checkConfigDrift, formatDriftReport } from './config-drift';
import { buildDigestData, renderDigestHtml } from './digest';
import { buildDigestKeyMap, passesDigestGuard } from './review';
import { sendDigestEmail, buildSubject, isSendDomainVerified, sendOwnerAlert } from './mailer';
import { collectInterNews } from './inter-collect';
import { filterInterNewsWithGemini } from './inter-filter';
import { matchInterNewsWithPortfolio } from './inter-portfolio-match';
import { computeAndStoreInterSummaries } from './inter-summary';

export interface RunOptions {
  send?: boolean;            // 실제 메일 발송 여부 (false면 DB 저장까지만)
  testRecipient?: string;    // 명시 수신자 (미지정 시 전사 그룹 DIGEST_TO_GROUP)
  bcc?: string | string[];   // 숨은참조 (미지정 시 DIGEST_BCC → DIGEST_TEST_RECIPIENT)
  baseUrl?: string;          // 대시보드 링크 도메인
  dryRun?: boolean;          // 외부 호출 없이 시뮬레이션
  skipCollect?: boolean;     // true면 수집 건너뛰고 기존 데이터로 발송만 (발송 전용 모드)
}

// 실행 중 크래시(타임아웃·강제종료 등)로 죽으면 RunLog가 RUNNING 상태로 영원히 남는다 —
// 그 자리에서 잡을 방법이 없으므로(프로세스 자체가 죽어서 finally도 못 돈다), 다음 실행이
// 시작될 때 너무 오래된 RUNNING을 죽은 것으로 간주해 정리한다. 지금까지 가장 오래 걸린
// 수집이 84.8분이었던 걸 감안해 3시간을 기준으로 잡았다(2026-08-06, DB에 10건 방치돼있던 걸 발견).
const STALE_RUN_THRESHOLD_MS = 3 * 60 * 60 * 1000;
async function cleanupStaleRunLogs() {
  const cutoff = new Date(Date.now() - STALE_RUN_THRESHOLD_MS);
  const { count } = await prisma.runLog.updateMany({
    where: { status: 'RUNNING', startedAt: { lt: cutoff } },
    data: { status: 'FAILED', finishedAt: new Date(), errors: '타임아웃/크래시로 추정 — 다음 실행 시작 시 자동 정리됨' },
  });
  if (count > 0) console.warn(`[runner] 좀비 RunLog ${count}건 정리(3시간 초과 RUNNING → FAILED)`);
}

export async function runDailyDigest(opts: RunOptions = {}) {
  await cleanupStaleRunLogs();
  const log = await prisma.runLog.create({
    data: { runType: 'daily', status: 'RUNNING' },
  });

  try {
    // 1. 수집 (skipCollect=true면 건너뛰고 기존 데이터 사용 — 발송 전용 모드)
    let raw: RawArticle[];
    if (opts.skipCollect) {
      // 기존 DB의 최근 3일 분석된 기사 사용 (수집 생략)
      const kstNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
      const threeDaysAgo = new Date(kstNow.getTime() - 3 * 24 * 60 * 60 * 1000);
      const existing = await prisma.article.findMany({
        where: {
          pubDate: { gte: threeDaysAgo },
          isNoise: false,
          category: { not: 'unrelated' },
          analyzedAt: { not: null },
        },
        select: {
          id: true,
          title: true,
          link: true,
          source: true,
          pubDate: true,
          matchedKeyword: true,
          category: true,
          importance: true,
          tone: true,
          oneLiner: true,
          ourTake: true,
          relatedCompanies: true,
          pitchScore: true,
          pitchTopic: true,
          riskFlag: true,
          isNoise: true,
          noiseReason: true,
          priorityScore: true,
        },
        orderBy: { priorityScore: 'desc' },
        take: 500,
      });
      raw = existing as any;
      console.log(`[runner] skip collect mode: using ${raw.length} existing articles`);
    } else {
      // 일반 수집 모드
      const maxPerCat = process.env.COLLECT_MAX_PER_CATEGORY ? Number(process.env.COLLECT_MAX_PER_CATEGORY) : 30;
      const daysBack = process.env.COLLECT_DAYS_BACK ? Number(process.env.COLLECT_DAYS_BACK) : undefined;
      // 경쟁사(114개)는 매일 다 훑기엔 네이버 호출량·실행시간 부담이 커서, 다이제스트가
      // 나가는 월·수·금(그 전 새벽 수집)에만 전체를 다 훑고, 나머지 요일엔 대시보드 고정
      // 12개 카드만 가볍게 갱신한다.
      const kstDay = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' })).getDay(); // 0=일 ~ 6=토
      const digestDayFullScan = [1, 3, 5].includes(kstDay); // 월(1)·수(3)·금(5)
      console.log(`[runner] 경쟁사·업계동향 전체 스캔: ${digestDayFullScan ? 'ON(다이제스트 발송일)' : 'OFF(경쟁사 고정 12개만·업계동향은 기존 캡)'}`);
      raw = await collectAllArticles({ maxKeywordsPerCategory: maxPerCat, daysBack, digestDayFullScan });
    }

    // 1.5 Inter(해외 트렌드) 탭 — RSS 수집 + Gemini 필터링 (skipCollect 모드에서는 건너뜀)
    if (!opts.skipCollect) {
      try {
        const { newsIds } = await collectInterNews();
        if (newsIds.length > 0) {
          const filterResult = await filterInterNewsWithGemini(newsIds);
          console.log(`[runner] Inter filtered: ${filterResult.relevant}/${filterResult.filtered} relevant`);

          if (filterResult.relevant > 0) {
            const relevantVerdicts = await prisma.interNewsVerdict.findMany({
              where: { newsId: { in: newsIds }, relevant: true },
              select: { id: true },
            });
            const matchResult = await matchInterNewsWithPortfolio(relevantVerdicts.map(v => v.id));
            console.log(`[runner] Inter portfolio matched: ${matchResult.matched}건, ${matchResult.failed.length}개 오류`);
          }
        }
        await computeAndStoreInterSummaries();
      } catch (e: any) {
        console.error('[runner] Inter collection/filtering failed:', e?.message ?? e);
        // Inter 실패는 포트폴리오 다이제스트에 영향 안 줌
      }
    }

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

    // 3. 분석 (Claude) — skipCollect 모드는 이미 DB에 분석 완료된 데이터이므로 재분석하지 않고 그대로 사용
    //    (기존에는 skipCollect에서도 최대 500건을 순차 재분석해 60초 maxDuration을 초과, 발송 자체가 무산되었음)
    const analyzed: AnalyzedArticle[] = opts.skipCollect
      ? (raw as any[]).map(a => ({
          ...a,
          relatedCompanies: typeof a.relatedCompanies === 'string' ? JSON.parse(a.relatedCompanies) : (a.relatedCompanies ?? []),
        }))
      : await analyzeArticles(raw, portfolioUniverse, trendingTopics);
    console.log(`[runner] analyzed ${analyzed.length} articles (skipCollect=${!!opts.skipCollect})`);

    // 4. DB 저장 (upsert by link) — skipCollect 모드는 생략 (이미 저장된 데이터)
    if (!opts.skipCollect) {
      // 구글 뉴스는 같은 기사도 수집 때마다 link 토큰이 바뀌어서 link만으로 upsert하면
      // 실행할 때마다 같은 기사가 새 행으로 계속 쌓인다(진짜 중복). link가 달라도 최근 14일 내
      // 정규화 제목+매체가 같으면 같은 기사로 보고, 기존 행의 link로 upsert해서 갱신되게 한다.
      const recentWindow = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
      const recentExisting = await prisma.article.findMany({
        where: { pubDate: { gte: recentWindow } },
        select: { link: true, title: true, source: true, category: true },
      });
      // `${source}::${titleKey}` -> 기존 link·category (분류 승격 판단용 — 아래 참고)
      // source는 정규화해서 키를 만든다 — "mt.co.kr"과 "머니투데이"처럼 같은 매체가 다른 표기로
      // 들어오면 원문 그대로는 다른 키가 돼서 같은 기사가 중복 행으로 쌓인다(2026-08-06, 모드하우스/
      // 에이티넘인베스트먼트 기사가 표기 차이로 별도 저장되어 다이제스트에 중복 노출된 사례로 발견).
      const existingByKey = new Map<string, { link: string; category: string }>();
      for (const e of recentExisting) {
        existingByKey.set(`${normalizeSource(e.source)}::${normalizeTitleKey(e.title)}`, { link: e.link, category: e.category });
      }

      // 기사 하나가 잘못돼도(NaN 필드·URL 과다 길이 등 예측 못한 제약 위반) 그날 수집분
      // 전체가 통째로 유실되지 않도록 건별로 격리. 실패는 기록만 하고 나머지는 계속 저장.
      // (2026-07-10: try/catch 없이 돌다가 priorityScore NaN·link 인덱스 크기 초과로
      //  루프 중간에 예외가 나서 그날 수집분이 전부 저장 안 된 사고가 있었음)
      let saveFailures = 0;
      for (const a of analyzed) {
        const dedupeKey = `${normalizeSource(a.source)}::${normalizeTitleKey(a.title)}`;
        const existing = existingByKey.get(dedupeKey);
        const targetLink = existing?.link ?? a.link;
        // 기존 행이 더 낮은 우선순위 분류(예: industry_trend 흔한 키워드)로 먼저 저장돼 있었는데
        // 오늘 더 구체적인 분류(예: competitor 회사명)로 재매칭됐으면 승격한다. 반대(더 낮은
        // 우선순위로 재매칭)는 무시해 기존 분류를 지키고, 새로 생기는 행은 항상 create로 붙는다.
        // (2026-08-05: matchedKeyword/category가 update에 아예 없어 첫날 잘못 붙은 분류가
        //  영원히 고정되던 버그 — 와이앤아처 관련 기사 대부분이 "데모데이"/"액셀러레이터" 같은
        //  업계동향 키워드로 묶여 회사 카드에 하나도 안 잡히는 사고로 발견.)
        const shouldPromote = !existing || (CATEGORY_PRIORITY[a.category] ?? 0) > (CATEGORY_PRIORITY[existing.category] ?? 0);
        try {
          await prisma.article.upsert({
            where: { link: targetLink },
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
              ...(shouldPromote ? { matchedKeyword: a.matchedKeyword, category: a.category } : {}),
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
        } catch (e: any) {
          saveFailures++;
          console.error(`[runner] article save failed, skipping "${a.title}" (${a.link}):`, e?.message ?? e);
        }
      }
      if (saveFailures > 0) {
        console.error(`[runner] ${saveFailures}/${analyzed.length} articles failed to save this run`);
      }

      // 4.5 대시보드 AI 요약(위기 원인·경쟁사 트렌드) 사전계산 — 하루 1회, 실제 수집 실행 때만
      // (skipCollect=발송 전용 모드에서는 돌리지 않음). 내부적으로 실패를 삼키므로 발송에는 영향 없음.
      await computeAndStoreDashboardInsights();

      // 4.55 Inter(해외 트렌드) 탭 AI 요약 사전계산 — 위와 같은 이유로 하루 1회, 여기서만.
      await computeAndStoreInterSummaries();

      // 4.6 master-keywords.json ↔ DB 불일치 확인 — 하루 1회, 다를 때만 관리자에게 메일.
      // (7/31~8/3에 파일은 고쳤는데 DB엔 반영 안 된 채로 몇 주 방치된 사고 재발 방지)
      try {
        const drift = await checkConfigDrift();
        if (drift.total > 0) {
          console.warn(`[runner] config drift ${drift.total}건 발견`);
          if (process.env.ADMIN_ALERT_EMAIL) {
            const notified = await sendOwnerAlert(
              process.env.ADMIN_ALERT_EMAIL,
              `[SparkScope] 감시대상 설정 불일치 ${drift.total}건 발견`,
              formatDriftReport(drift),
            );
            console.warn(`[runner] 관리자 알림 ${notified ? '발송 완료' : '발송 실패'}`);
          } else {
            console.warn('[runner] ADMIN_ALERT_EMAIL 미설정 — 메일 알림 스킵');
          }
        }
      } catch (e) {
        console.error('[runner] config drift check failed:', e);
      }
    }

    // 4.7 다이제스트 발송 가드 재검증 — isNoise:false는 수집 당일 AI가 한 번 판단하고 끝이라
    // 나중에 노이즈 규칙이 강화돼도 이미 저장된 기사엔 소급 적용이 안 된다. 대시보드는 렌더할 때마다
    // isBlockedNoise를 실시간 재검사하는데 발송 경로는 이 재검사가 빠져있어 대시보드보다 메일에
    // 오탐이 더 많이 남는 원인이었다(검수 콘솔 loadDigestCandidates에만 있던 가드를 여기서도 적용,
    // 2026-08-06).
    const guardTargets = await prisma.monitoringTarget.findMany({
      where: { category: { in: ['portfolio_company', 'sparklabs_self'] }, status: 'ACTIVE' },
      select: { primaryKeyword: true, name: true, englishName: true, helperKeywords: true },
    });
    const guardKeyMap = buildDigestKeyMap(guardTargets);
    const digestReady = analyzed.filter(a => passesDigestGuard(a, guardKeyMap));
    console.log(`[runner] digest guard: ${analyzed.length} -> ${digestReady.length} (노이즈/관련성 재검증 후)`);

    // 5. 편집자 인사
    const sortedTop3 = [...digestReady].sort((a, b) => b.priorityScore - a.priorityScore).slice(0, 3);
    const editorIntro = await generateEditorIntro(sortedTop3);

    // 6. 다이제스트 데이터 + HTML (본부 스크랩 기사 TOP3 우선 반영)
    const scrapped = await prisma.article.findMany({ where: { isScrapped: true }, select: { link: true } });
    const scrappedLinks = new Set(scrapped.map(s => s.link));
    const data = buildDigestData(digestReady, editorIntro, undefined, scrappedLinks);
    const html = renderDigestHtml(data, opts.baseUrl);
    const subject = buildSubject(data.dateLabel, data.top3[0]?.title);

    // 7. DB에 다이제스트 저장 — KST 기준 오늘
    const kstNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
    const today = new Date(kstNow.getFullYear(), kstNow.getMonth(), kstNow.getDate(), 0, 0, 0, 0);
    // 발송 시도가 없는 실행(수집 전용, send=false)은 콘텐츠만 갱신하고 sentAt/errorMsg는 손대지 않는다.
    // 예전엔 무조건 null로 리셋해서, 발송 크론이 이미 성공시켜둔 sentAt을 그날 나중에 끝나는
    // 수집 실행이 지워버려 "안 보낸 것"처럼 보이는 문제가 있었음.
    const willAttemptSend = !!opts.send && !opts.dryRun;
    const digestRecord = await prisma.digest.upsert({
      where: { date: today },
      create: { date: today, subject, htmlBody: html },
      update: willAttemptSend
        ? { subject, htmlBody: html, sentAt: null, errorMsg: null }
        : { subject, htmlBody: html },
    });

    // 8. 메일 발송 — 발송 직전 발신 도메인 인증 여부 확인(미인증이면 전원 발송 스킵, 담당자 알림)
    let mailResult: any = null;
    let skipped: string | undefined;
    // BCC는 DIGEST_BCC가 명시적으로 설정된 경우에만. (TEST_RECIPIENT로 폴백하면 중복 수신 위험)
    const bcc = opts.bcc ?? process.env.DIGEST_BCC ?? undefined;
    // 2026-07-17은 발송 중단
    const isBlockDate = kstNow.getFullYear() === 2026 && kstNow.getMonth() === 6 && kstNow.getDate() === 17;
    if (isBlockDate) {
      skipped = 'scheduled_pause_2026_07_17';
      await prisma.digest.update({ where: { id: digestRecord.id }, data: { errorMsg: '2026-07-17 발송 중단' } });
      console.log('[runner] 2026-07-17 발송 중단');
    } else if (opts.send && !opts.dryRun) {
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
