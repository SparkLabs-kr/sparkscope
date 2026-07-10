const fs = require('fs');
const path = require('path');

const env = fs.readFileSync('.env.local', 'utf-8');
for (const line of env.split('\n')) {
  const match = line.match(/^([^=]+)=(.+)$/);
  if (!match) continue;
  const key = match[1].trim();
  let val = match[2].trim();
  if (val.startsWith('"')) val = val.slice(1, -1);
  process.env[key] = val;
}

// testRecipient 명시: isu.jang@sparklabs.co.kr 만 발송 (staff@ 아님)
(async () => {
  const { runDailyDigest } = await import('./src/lib/sparkscope/runner.ts');
  
  console.log('[Runner 실행 — test 모드]\n');
  const result = await runDailyDigest({
    send: true,
    testRecipient: 'isu.jang@sparklabs.co.kr',
    baseUrl: 'http://localhost:3000',
  });
  
  console.log('\n[결과]');
  console.log(JSON.stringify(result, null, 2));
  
  if (result.skipped) {
    console.log('\n❌ 발송 건너뜀:', result.skipped);
  } else if (result.mailResult) {
    console.log('\n✅ 발송 성공!');
    console.log('Message ID:', result.mailResult.id);
  }
})();
