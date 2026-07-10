const fs = require('fs');
const path = require('path');

const env = fs.readFileSync('.env.local', 'utf-8');
for (const line of env.split('\n')) {
  const match = line.match(/^([^=]+)=(.+)$/);
  if (match) {
    const key = match[1].trim();
    let val = match[2].trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    if (key.startsWith('POSTGRES') || key.startsWith('DATABASE')) {
      process.env[key] = val;
    }
  }
}

(async () => {
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();

  const digests = await prisma.digest.findMany({
    orderBy: { date: 'desc' },
    take: 3,
    select: { date: true, sentAt: true, errorMsg: true, subject: true, recipients: true },
  });

  console.log('📋 최근 3개 다이제스트 기록:\n');
  for (const d of digests) {
    const date = d.date.toISOString().split('T')[0];
    const sent = d.sentAt ? '✅ 발송됨' : '❌ 미발송';
    console.log(`[${date}] ${sent}`);
    console.log(`  수신자: ${d.recipients}명`);
    console.log(`  제목: ${d.subject?.substring(0, 50) || '(없음)'}`);
    console.log(`  에러: ${d.errorMsg || '(없음)'}\n`);
  }

  await prisma.$disconnect();
})();
