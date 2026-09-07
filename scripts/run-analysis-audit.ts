/**
 * 주간 분석 오류 감사 실행 — GitHub Actions에서 매주 월요일 07:00 KST에 돌린다.
 *   npm run audit:analysis
 */
import { prisma } from '../src/lib/prisma';
import { runAnalysisAudit } from '../src/lib/sparkscope/analysis-audit';

async function main() {
  const log = await prisma.runLog.create({ data: { runType: 'analysis-audit', status: 'RUNNING' } });
  try {
    const r = await runAnalysisAudit();
    console.log(
      `[analysis-audit] 검사 ${r.checked}건 · 재수집 실패 ${r.scrapeFailed}건 · ` +
      `큐에 올림 ${r.flagged}건 · 중복 스킵 ${r.skippedAlreadyFlagged}건`,
    );
    await prisma.runLog.update({
      where: { id: log.id },
      data: { status: 'SUCCESS', finishedAt: new Date(), analyzed: r.checked },
    });
  } catch (e) {
    console.error('[analysis-audit] 실패:', e);
    await prisma.runLog.update({
      where: { id: log.id },
      data: { status: 'FAILED', finishedAt: new Date(), errors: String((e as Error).message ?? e) },
    });
    process.exit(1);
  }
  process.exit(0);
}

main();
