import { NextResponse } from 'next/server';
import { Client } from 'pg';
import Anthropic from '@anthropic-ai/sdk';

export const dynamic = 'force-dynamic';

export async function GET() {
  const results: Record<string, unknown> = {};

  // 1. 환경변수 존재 여부
  results.env = {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ? `set (${process.env.ANTHROPIC_API_KEY.length}자)` : 'MISSING',
    FUND_DB_URL: process.env.FUND_DB_URL ? `set (${process.env.FUND_DB_URL.length}자)` : 'MISSING',
  };

  // 2. Anthropic API 테스트
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const resp = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 10,
      messages: [{ role: 'user', content: 'hi' }],
    });
    results.anthropic = { ok: true, type: resp.content[0]?.type };
  } catch (e: unknown) {
    results.anthropic = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  // 3. Fund DB 테스트 (fund-db.ts와 동일한 방식)
  try {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    const client = new Client({ connectionString: process.env.FUND_DB_URL });
    await client.connect();
    const r = await client.query(`SELECT COUNT(*) FROM shared_ro.external_funds WHERE investor_name = '미래에셋벤처투자'`);
    results.fundDb = { ok: true, count: r.rows[0].count };
    await client.end();
  } catch (e: unknown) {
    results.fundDb = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  return NextResponse.json(results, { status: 200 });
}
