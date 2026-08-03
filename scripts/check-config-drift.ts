/**
 * master-keywords.json ↔ DB 수동 확인용. 메일 안 보내고 콘솔에만 출력.
 * 실행: npx tsx scripts/check-config-drift.ts
 */
import { checkConfigDrift, formatDriftReport } from '../src/lib/sparkscope/config-drift';
import { prisma } from '../src/lib/prisma';

async function main() {
  const drift = await checkConfigDrift();
  console.log(formatDriftReport(drift));
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
