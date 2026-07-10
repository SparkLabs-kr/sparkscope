/**
 * Batch API 테스트 스크립트 (배치 재분류 전 검증)
 *
 * 이 스크립트는:
 * 1. Anthropic Batch API 연결 확인
 * 2. 작은 배치로 테스트 실행
 * 3. 결과 처리 검증
 *
 * 호출: tsx ./scripts/_test-batch-api.ts
 */
import fs from 'fs';
import path from 'path';

// 환경 변수 로드
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

async function testBatchAPI() {
  console.log('\n🧪 Batch API 테스트 시작\n');

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('❌ ANTHROPIC_API_KEY가 설정되지 않았습니다');
    process.exit(1);
  }

  console.log('✅ API 키 로드됨\n');

  // [1] 간단한 배치 요청 생성
  console.log('[1] 테스트 배치 요청 생성...');

  const testRequests = [
    {
      custom_id: 'test-1',
      params: {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 256,
        system: '당신은 JSON 분류 봇입니다. 반드시 valid JSON만 반환하세요.',
        messages: [
          {
            role: 'user',
            content: '다음 뉴스를 분류하세요:\n{"id":"1","title":"회사가 투자를 받았습니다","source":"매체"}\n\n출력: {"id":"1","category":"positive"}',
          },
        ],
      },
    },
    {
      custom_id: 'test-2',
      params: {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 256,
        system: '당신은 JSON 분류 봇입니다. 반드시 valid JSON만 반환하세요.',
        messages: [
          {
            role: 'user',
            content: '다음 뉴스를 분류하세요:\n{"id":"2","title":"회사가 소송을 당했습니다","source":"매체"}\n\n출력: {"id":"2","category":"negative"}',
          },
        ],
      },
    },
  ];

  // JSONL 생성
  const jsonl = testRequests.map(r => JSON.stringify(r)).join('\n');
  const tempFile = path.join(process.cwd(), '.test-batch.jsonl');
  fs.writeFileSync(tempFile, jsonl, 'utf-8');

  console.log(`✅ JSONL 파일 생성 (${testRequests.length}개 요청)\n`);

  // [2] 배치 제출
  console.log('[2] 배치 API 제출...');

  try {
    const fileBuffer = fs.readFileSync(tempFile);
    const form = new FormData();
    const fileBlob = new Blob([fileBuffer], { type: 'application/x-jsonl' });
    (form as any).append('file', fileBlob, 'test-batch.jsonl');

    const submitResponse = await fetch('https://api.anthropic.com/v1/messages/batches', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'anthropic-version': '2023-06-01',
      },
      body: form as any,
    });

    if (!submitResponse.ok) {
      const errText = await submitResponse.text();
      console.error(`❌ 배치 제출 실패: ${submitResponse.status}`);
      console.error(errText);
      process.exit(1);
    }

    const submitData = await submitResponse.json() as any;
    const batchId = submitData.id;

    console.log(`✅ 배치 제출 완료`);
    console.log(`   배치 ID: ${batchId}`);
    console.log(`   상태: ${submitData.processing_status}\n`);

    // [3] 상태 폴링 (최대 5분)
    console.log('[3] 배치 처리 대기 중 (최대 5분)...');

    let completed = false;
    let attempts = 0;
    const maxAttempts = 30; // 10초 × 30 = 5분

    while (attempts < maxAttempts && !completed) {
      await new Promise(resolve => setTimeout(resolve, 10000)); // 10초 대기
      attempts++;

      const statusResponse = await fetch(`https://api.anthropic.com/v1/messages/batches/${batchId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'anthropic-version': '2023-06-01',
        },
      });

      if (!statusResponse.ok) {
        console.error(`⚠️  상태 조회 실패 (시도 ${attempts}/${maxAttempts})`);
        continue;
      }

      const batch = await statusResponse.json() as any;
      const progress = batch.request_counts;

      console.log(`   [${attempts * 10}초] 상태: ${batch.processing_status} | 성공: ${progress.succeeded}, 실패: ${progress.failed}, 처리중: ${progress.processing}`);

      if (batch.processing_status === 'SUCCEEDED') {
        completed = true;
        console.log(`\n✅ 배치 완료!\n`);
        break;
      }

      if (batch.processing_status === 'FAILED') {
        console.error(`\n❌ 배치 실패: ${JSON.stringify(batch)}`);
        process.exit(1);
      }
    }

    if (!completed) {
      console.error(`\n⏱️  타임아웃 (5분 이상 대기)\n`);
      console.log(`배치 ID를 기록했습니다: ${batchId}`);
      console.log(`나중에 상태 확인: curl -H "Authorization: Bearer $ANTHROPIC_API_KEY" https://api.anthropic.com/v1/messages/batches/${batchId}\n`);
      process.exit(0);
    }

    // [4] 결과 처리
    console.log('[4] 배치 결과 처리...');

    const resultsResponse = await fetch(`https://api.anthropic.com/v1/messages/batches/${batchId}/results`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'anthropic-version': '2023-06-01',
      },
    });

    if (!resultsResponse.ok) {
      console.error(`❌ 결과 조회 실패: ${resultsResponse.status}`);
      process.exit(1);
    }

    const resultsText = await resultsResponse.text();
    const resultLines = resultsText.trim().split('\n').filter(l => l.trim());

    console.log(`✅ 결과 수신 (${resultLines.length}줄)\n`);

    let successCount = 0;
    let errorCount = 0;

    for (const line of resultLines) {
      const result = JSON.parse(line);

      if (result.error) {
        console.log(`   ❌ ${result.custom_id}: ${result.error.type} - ${result.error.message}`);
        errorCount++;
        continue;
      }

      const content = result.result.content?.[0]?.text || '';
      console.log(`   ✅ ${result.custom_id}:`);
      console.log(`      응답: ${content.substring(0, 80)}...`);
      successCount++;
    }

    console.log(`\n📊 테스트 결과:`);
    console.log(`   성공: ${successCount}/${testRequests.length}`);
    console.log(`   실패: ${errorCount}/${testRequests.length}`);

    if (successCount === testRequests.length) {
      console.log('\n✅ Batch API 테스트 통과! 본 배치 재분류를 시작해도 됩니다.\n');
      process.exit(0);
    } else {
      console.log('\n❌ 일부 요청이 실패했습니다.\n');
      process.exit(1);
    }

  } catch (error) {
    console.error(`\n❌ 에러: ${error}`);
    process.exit(1);
  } finally {
    // 임시 파일 정리
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }
  }
}

testBatchAPI();
