/**
 * 스크립트용 환경변수 로더 — 반드시 다른 import보다 **먼저** 불러야 한다.
 *
 * 왜 필요한가: Next.js(개발 서버·프로덕션 빌드)는 `.env.local`을 `.env`보다 우선해서 읽지만,
 * `npx tsx scripts/...`로 실행하는 스크립트는 그렇지 않다. Prisma가 datasource URL을 위해
 * `.env`만 읽어주는 게 전부라서, `.env.local`에만 있는 값은 스크립트에서 `undefined`가 된다.
 *
 * 이 때문에 2026-08-05에 반나절을 날렸다: 유효한 OpenAI 키는 `.env.local`에 있었고
 * `.env`에는 잔액이 0인 옛 키가 남아 있었다. 화면(개발 서버)은 잘 돌아가는데 스크립트만
 * `credit_balance_exhausted`로 죽어서, 계정 크레딧이 소진된 것으로 오진했다.
 *
 * 사용:
 *   import './_env';            // ← 가장 첫 줄
 *   import { prisma } from '../src/lib/prisma';
 */
import * as fs from 'fs';
import * as path from 'path';

// Next.js와 같은 우선순위: .env.local 이 .env 를 덮어쓴다.
// 이미 셸에서 넘어온 값(process.env)이 있으면 그것을 최우선으로 둔다.
const FILES = ['.env', '.env.local'];

function parse(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  // CRLF로 저장된 파일이 있어서 \r를 반드시 함께 잘라낸다 — 안 그러면 키 끝에 \r가 붙어
  // "Illegal header value" 류의 엉뚱한 인증 오류가 난다.
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2]!.trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[m[1]!] = v;
  }
  return out;
}

const shellProvided = new Set(Object.keys(process.env));
const loaded: string[] = [];

for (const file of FILES) {
  const p = path.resolve(process.cwd(), file);
  if (!fs.existsSync(p)) continue;
  const vars = parse(fs.readFileSync(p, 'utf8'));
  let applied = 0;
  for (const [k, v] of Object.entries(vars)) {
    if (shellProvided.has(k)) continue; // 셸에서 명시한 값은 파일이 덮지 않는다
    process.env[k] = v;
    applied++;
  }
  loaded.push(`${file}(${applied})`);
}

if (process.env.SCRIPT_ENV_DEBUG) {
  console.log(`[env] 로드: ${loaded.join(', ') || '없음'}`);
}
