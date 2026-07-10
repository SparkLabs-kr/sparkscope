import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { analyzeArticles, generateEditorIntro } from '@/lib/sparkscope/analyzer';
import { buildDigestData, renderDigestHtml } from '@/lib/sparkscope/digest';
import { sendDigestEmail, buildSubject } from '@/lib/sparkscope/mailer';

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

(async () => {
  console.log('\n📧 staff@sparklabs.co.kr 정식 발송\n');

  try {
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

    const portfolioTargets = await prisma.monitoringTarget.findMany({
      where: { category: 'portfolio_company', status: 'ACTIVE' },
      select: { name: true },
    });
    const trendTargets = await prisma.monitoringTarget.findMany({
      where: { category: 'industry_trend', status: 'ACTIVE' },
      select: { name: true },
    });

    const analyzed = await analyzeArticles(articles, portfolioTargets.map(t => t.name), trendTargets.map(t => t.name));
    const sortedTop3 = [...analyzed].sort((a, b) => b.priorityScore - a.priorityScore).slice(0, 3);
    const editorIntro = await generateEditorIntro(sortedTop3);

    const scrapped = await prisma.article.findMany({ where: { isScrapped: true }, select: { link: true } });
    const data = buildDigestData(analyzed, editorIntro, undefined, new Set(scrapped.map(s => s.link)));
    const html = renderDigestHtml(data, 'https://sparkscope.vercel.app');
    const subject = buildSubject(data.dateLabel, data.top3[0]?.title);

    const mailResult = await sendDigestEmail({
      subject,
      html,
      to: 'staff@sparklabs.co.kr',
    });

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

    console.log('✅ staff@ 발송 완료!\n');
    console.log('📧 수신: staff@sparklabs.co.kr');
    console.log('📰 기사: ' + analyzed.length + '건');
    console.log('🆔 Message ID: ' + mailResult.id + '\n');

    await prisma.$disconnect();
  } catch (error) {
    console.error('\n❌ 에러:', error);
    await prisma.$disconnect();
    process.exit(1);
  }
})();
