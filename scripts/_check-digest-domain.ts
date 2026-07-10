import fs from 'fs';
import path from 'path';

const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      const value = match[2].trim().replace(/^"(.*)"$/, '$1');
      process.env[key] = value;
    }
  }
}

async function checkDomain() {
  const apiKey = process.env.RESEND_API_KEY;
  const domain = process.env.DIGEST_FROM_EMAIL?.split('@')[1];

  console.log('\n📋 다이제스트 설정 확인:\n');
  console.log(`✓ 발신 이메일: ${process.env.DIGEST_FROM_EMAIL}`);
  console.log(`✓ 도메인: ${domain}`);
  console.log(`✓ 수신자: ${process.env.DIGEST_TO_GROUP}`);
  console.log(`✓ API 키: ${apiKey ? '있음 ✓' : '없음 ❌'}\n`);

  if (!apiKey || !domain) {
    console.log('❌ API 키 또는 도메인이 설정되지 않았습니다.\n');
    return;
  }

  try {
    console.log(`🔍 도메인 인증 상태 확인 (${domain})...`);
    const res = await fetch('https://api.resend.com/domains', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const json: any = await res.json();
    const d = (json?.data ?? []).find((x: any) => x.name === domain);

    if (d) {
      console.log(`\n✓ 도메인 찾음:`);
      console.log(`  상태: ${d.status.toUpperCase()}`);
      console.log(`  생성: ${new Date(d.createdAt).toLocaleDateString('ko-KR')}`);
      console.log(`  ${d.status === 'verified' ? '✅ 발송 가능' : '❌ 인증 필요'}\n`);
    } else {
      console.log(`\n❌ 도메인을 찾을 수 없습니다.\n`);
      console.log('등록된 도메인 목록:');
      (json?.data ?? []).forEach((x: any) => {
        console.log(`  • ${x.name} (${x.status})`);
      });
      console.log();
    }
  } catch (e: any) {
    console.error(`\n❌ 오류: ${e.message}\n`);
  }
}

checkDomain();
