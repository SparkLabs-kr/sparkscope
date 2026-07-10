const fs = require('fs');
const path = require('path');

// .env.local 읽기
const envPath = path.join(__dirname, '.env.local');
const env = fs.readFileSync(envPath, 'utf-8');

let apiKey = '';
let fromEmail = '';

for (const line of env.split('\n')) {
  const match = line.match(/^([^=]+)=(.+)$/);
  if (!match) continue;
  
  const key = match[1].trim();
  let value = match[2].trim().replace(/^"(.*)"$/, '$1');
  
  if (key === 'RESEND_API_KEY') apiKey = value;
  if (key === 'DIGEST_FROM_EMAIL') fromEmail = value;
}

console.log('[환경변수 확인]');
console.log('API Key:', apiKey.substring(0, 20) + '...');
console.log('From Email:', fromEmail);
console.log('');

const testEmail = {
  from: fromEmail,
  to: 'isu.jang@sparklabs.co.kr',
  subject: 'test',
  html: '<p>테스트 메일입니다.</p>',
};

console.log('[Resend API 요청]');
console.log('To:', testEmail.to);
console.log('Subject:', testEmail.subject);
console.log('');

(async () => {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(testEmail),
    });
    
    const data = await res.json();
    console.log('[Resend API 응답]');
    console.log(JSON.stringify(data, null, 2));
    
    if (data.id) {
      console.log('\n✅ Message ID:', data.id);
      console.log('📍 Resend 대시보드에서 확인: https://dashboard.resend.com/emails');
    } else if (data.error) {
      console.log('\n❌ 에러:', data.error);
    }
  } catch (e) {
    console.log('\n❌ Fetch 에러:', e.message);
  }
})();
