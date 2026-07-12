/**
 * 프로덕션 발송 경로 검증
 * /api/cron/daily-send-only와 동일하게: skipCollect + send 모드
 * 실제 Vercel Cron이 월요일에 할 일을 지금 시뮬레이션
 */
import fs from 'fs';
import path from 'path';
import { runDailyDigest } from '@/lib/sparkscope/runner';

// .env.local 수동 로드
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

async function testProductionSend() {
  console.log('\n🚀 프로덕션 발송 경로 검증\n');
  console.log('시뮬레이션: Vercel Cron이 월요일 9시에 할 일\n');

  try {
    const result = await runDailyDigest({
      send: true,
      skipCollect: true,  // 핵심: 기존 DB 데이터만 사용
      testRecipient: 'isu.jang@sparklabs.co.kr',  // 테스트 수신
      baseUrl: 'https://sparkscope.vercel.app',
    });

    console.log('\n✅ 발송 성공!\n');
    console.log('결과:');
    console.log(`  기사: ${result.collected}건`);
    console.log(`  분석: ${result.analyzed}건`);
    console.log(`  Message ID: ${result.mailResult?.id}`);
    console.log(`  제목: ${result.subject}`);
    console.log(`\n발송 대상: isu.jang@sparklabs.co.kr\n`);

    if (result.skipped) {
      console.log(`⚠️  주의: ${result.skipped}`);
    }

  } catch (error: any) {
    console.error('\n❌ 에러:', error.message);
    process.exit(1);
  }
}

testProductionSend();
