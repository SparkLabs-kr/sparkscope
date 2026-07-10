import { Client } from 'pg';

async function testSlab() {
  const client = new Client({
    connectionString: process.env.SLAB_DATABASE_URL,
  });

  try {
    console.log('[test] SLAB 연결 시도...');
    await client.connect();
    console.log('[test] ✓ 연결 성공');

    const result = await client.query('SELECT COUNT(*) as count FROM slab.company');
    const count = result.rows[0].count;
    console.log(`[test] slab.company 행 수: ${count}`);

    if (count === '366') {
      console.log('[test] ✓ 예상 값(366) 일치!');
    } else {
      console.log(`[test] ⚠️ 행 수가 예상값(366)과 다름: ${count}`);
    }
  } catch (e) {
    console.error('[test] 연결/쿼리 실패:', (e as Error).message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

testSlab();
