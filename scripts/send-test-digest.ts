/**
 * 테스트 다이제스트 발송 — 기존 DB 기사로 생성
 * (수집 생략, 분석+생성+발송만)
 *
 * 호출: npx tsx ./scripts/send-test-digest.ts
 */
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { analyzeArticles, generateEditorIntro } from '@/lib/sparkscope/analyzer';
import { buildDigestData, renderDigestHtml } from '@/lib/sparkscope/digest';
import { sendDigestEmail, buildSubject, isSendDomainVerified } from '@/lib/sparkscope/mailer';

// 환경 변수 로드 (tsx는 .env.local 자동 로드 안 함)
const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      let value = match[2].trim();
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  }
}

const prisma = new PrismaClient();

async function sendTestDigest() {
  console.log('\n🚀 테스트 다이제스트 발송 시작\n');

  try {
    // [1] 도메인 인증 확인
    console.log('[1/5] 도메인 인증 상태 확인...');
    const domain = await isSendDomainVerified();
    console.log(`  도메인: ${domain.domain}`);
    console.log(`  상태: ${domain.status}`);

    if (!domain.verified) {
      console.error('\n❌ 도메인 미인증 — 발송 중단');
      process.exit(1);
    }

    // [2] 최근 3일 기사 조회 (KST 기준)
    console.log('\n[2/5] 최근 3일 기사 조회...');
    const kstNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
    const threeDaysAgo = new Date(kstNow.getTime() - 3 * 24 * 60 * 60 * 1000);

    const articles = await prisma.article.findMany({
      where: {
        pubDate: { gte: threeDaysAgo },
        isNoise: false,
        category: { not: 'unrelated' },
      },
      orderBy: { priorityScore: 'desc' },
      take: 500,
    });

    console.log(`  조회된 기사: ${articles.length}건`);
    if (articles.length === 0) {
      console.error('\n❌ 최근 3일 기사 없음');
      process.exit(1);
    }

    // [3] 포트폴리오/트렌드 정보 (분석용)
    console.log('\n[3/5] 분석 컨텍스트 로드...');
    const portfolioTargets = await prisma.monitoringTarget.findMany({
      where: { category: 'portfolio_company', status: 'ACTIVE' },
      select: { name: true },
    });
    const trendTargets = await prisma.monitoringTarget.findMany({
      where: { category: 'industry_trend', status: 'ACTIVE' },
      select: { name: true },
    });

    const portfolioUniverse = portfolioTargets.map(t => t.name);
    const trendingTopics = trendTargets.map(t => t.name);
    console.log(`  포트폴리오: ${portfolioUniverse.length}개, 트렌드: ${trendingTopics.length}개`);

    // [4] 심층 분석 (Sonnet)
    console.log('\n[4/5] 심층 분석 중 (Claude Sonnet)...');
    const analyzed = await analyzeArticles(articles, portfolioUniverse, trendingTopics);
    console.log(`  분석 완료: ${analyzed.length}건`);

    // [5] 편집자 인사 + 다이제스트 생성
    console.log('\n[5/5] 다이제스트 생성 & 발송...');
    const sortedTop3 = [...analyzed].sort((a, b) => b.priorityScore - a.priorityScore).slice(0, 3);
    const editorIntro = await generateEditorIntro(sortedTop3);

    const scrapped = await prisma.article.findMany({ where: { isScrapped: true }, select: { link: true } });
    const scrappedLinks = new Set(scrapped.map(s => s.link));

    const data = buildDigestData(analyzed, editorIntro, undefined, scrappedLinks);
    const html = renderDigestHtml(data, process.env.NEXTAUTH_URL);
    const subject = buildSubject(data.dateLabel, data.top3[0]?.title);

    // [6] 메일 발송 (isu.jang@만)
    const testRecipient = 'isu.jang@sparklabs.co.kr';
    console.log(`  발송 대상: ${testRecipient}`);

    const mailResult = await sendDigestEmail({
      subject,
      html,
      to: testRecipient,
    });

    // [7] DB 기록
    const today = new Date(kstNow.getFullYear(), kstNow.getMonth(), kstNow.getDate(), 0, 0, 0, 0);
    await prisma.digest.upsert({
      where: { date: today },
      create: {
        date: today,
        subject,
        htmlBody: html,
        sentAt: new Date(),
        recipients: 1,
      },
      update: {
        subject,
        htmlBody: html,
        sentAt: new Date(),
        recipients: 1,
      },
    });

    console.log('\n✅ 테스트 다이제스트 발송 완료!\n');
    console.log('📧 발송 정보:');
    console.log(`  제목: ${subject}`);
    console.log(`  수신: ${testRecipient}`);
    console.log(`  Message ID: ${mailResult.id}`);
    console.log(`  기사: ${analyzed.length}건\n`);

    await prisma.$disconnect();

  } catch (error) {
    console.error('\n❌ 에러:', error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

sendTestDigest();
