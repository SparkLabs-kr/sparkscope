/**
 * Inter 탭 3줄 요약(DashboardInsight kind='inter_summary')을 지금 바로 다시 계산한다.
 *
 * 원래는 daily-collect 크론이 하루 1회 계산해 두고 대시보드는 읽기만 한다(CLAUDE.md 참고).
 * 프롬프트를 고친 직후처럼 "다음 배치까지 기다리지 않고 즉시 반영해야 할 때" 쓰는 수동 스크립트.
 *
 * 실행: npx tsx scripts/refresh-inter-summary.ts
 */

import fs from 'fs';
import path from 'path';

// 다른 scripts/*.ts와 동일한 방식으로 .env.local을 직접 읽는다(dotenv 의존성 없음).
const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([^=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^"(.*)"$/, '$1');
  }
}

async function main() {
  const { computeAndStoreInterSummaries } = await import('../src/lib/sparkscope/inter-summary');
  const { prisma } = await import('../src/lib/prisma');

  // 도메인(bio/ai) × 기간(7일/1개월/3개월/1년/3년) 전체 조합을 재계산.
  await computeAndStoreInterSummaries();

  const rows = await prisma.dashboardInsight.findMany({ where: { kind: 'inter_summary' } });
  for (const r of rows) {
    const v = JSON.parse(r.value);
    console.log(`\n[${r.key}] ${r.computedAt.toISOString()}`);
    console.log(`  trend   : ${v.trend}`);
    console.log(`  position: ${v.position}`);
    console.log(`  action  : ${v.action}`);
  }
  await prisma.$disconnect();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
