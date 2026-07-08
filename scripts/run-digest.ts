/**
 * 수동으로 다이제스트를 1회 실행 (수집 → 분석 → DB저장 → 발송).
 *
 * ▶ 정식 수동 발송 명령 (전사 staff@로 실제 발송, 프로젝트 루트에서 PowerShell):
 *   Get-Content .env.local -Encoding UTF8 | ? { $_ -match '^\s*[A-Z_]+=' -and $_ -notmatch '^\s*#' } | % { $kv=$_ -split '=',2; Set-Item "env:$($kv[0].Trim())" $kv[1].Trim().Trim('"') }; npm run digest:run -- --send
 *
 * 옵션: --send = 실제 발송 / --dry = 시뮬레이션 / (옵션 없음) = 수집·분석·DB저장만(발송 안 함)
 * 수신=DIGEST_TO_GROUP(staff@), 발신=DIGEST_FROM_EMAIL(marketing@). 발송 직전 도메인 인증 자동 확인.
 * (프로덕션 cron은 Vercel 환경변수를 쓰므로 위 env 주입 없이 자동 실행됨)
 */
import { runDailyDigest } from '../src/lib/sparkscope/runner';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry');
const send = args.includes('--send');

(async () => {
  console.log(`[script] running daily digest (send=${send}, dry=${dryRun})`);
  try {
    const result = await runDailyDigest({
      send,
      dryRun,
      baseUrl: process.env.NEXTAUTH_URL,
    });
    console.log('[script] result:', result);
  } catch (e) {
    console.error('[script] failed:', e);
    process.exit(1);
  }
  process.exit(0);
})();
