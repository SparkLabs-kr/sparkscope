const fs = require('fs');

const env = fs.readFileSync('.env.local', 'utf-8');
for (const line of env.split('\n')) {
  const match = line.match(/^([^=]+)=(.+)$/);
  if (!match) continue;
  const key = match[1].trim();
  let val = match[2].trim();
  if (val.startsWith('"')) val = val.slice(1, -1);
  process.env[key] = val;
}

(async () => {
  const { isSendDomainVerified, sendDigestEmail } = await import('./src/lib/sparkscope/mailer.ts');
  
  console.log('[1단계] 도메인 인증 상태 확인\n');
  const domain = await isSendDomainVerified();
  console.log('결과:', JSON.stringify(domain, null, 2));
  
  if (!domain.verified) {
    console.log('\n❌ 도메인 미인증 — 발송 중단');
    process.exit(1);
  }
  
  console.log('\n[2단계] 테스트 메일 발송\n');
  try {
    const result = await sendDigestEmail({
      subject: '[SparkScope] 테스트',
      html: '<p>발송 테스트입니다.</p>',
      to: 'isu.jang@sparklabs.co.kr',
    });
    console.log('\n✅ 발송 성공!');
    console.log('Message ID:', result.id);
  } catch (e) {
    console.log('\n❌ 발송 실패:');
    console.log('에러:', e.message);
  }
})();
