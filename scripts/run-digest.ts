/**
 * 수동으로 다이제스트를 1회 실행 (배포 후 첫 테스트용)
 * npm run digest:run
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
