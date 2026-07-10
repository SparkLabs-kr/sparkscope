const fs = require('fs');

const env = fs.readFileSync('.env.local', 'utf-8');
let apiKey = '';
let fromEmail = '';

for (const line of env.split('\n')) {
  const match = line.match(/^([^=]+)=(.+)$/);
  if (!match) continue;
  const key = match[1].trim();
  let val = match[2].trim().replace(/^"(.*)"$/, '$1');
  if (key === 'RESEND_API_KEY') apiKey = val;
  if (key === 'DIGEST_FROM_EMAIL') fromEmail = val;
}

const domain = fromEmail.split('@')[1];

console.log('[Resend 도메인 인증 상태 확인]');
console.log('From Email:', fromEmail);
console.log('Domain:', domain);
console.log('');

(async () => {
  const res = await fetch('https://api.resend.com/domains', {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  
  const json = await res.json();
  console.log('[API 응답]');
  console.log(JSON.stringify(json, null, 2));
  
  const foundDomain = (json.data || []).find(d => d.name === domain);
  
  console.log('');
  if (!foundDomain) {
    console.log('❌ 도메인을 찾을 수 없음 — 등록되지 않았거나 다른 Resend 계정');
  } else {
    console.log(`도메인: ${foundDomain.name}`);
    console.log(`상태: ${foundDomain.status}`);
    if (foundDomain.status !== 'verified') {
      console.log(`DNS 레코드:`, foundDomain.records);
    }
  }
})();
