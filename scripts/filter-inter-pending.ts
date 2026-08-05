// 판정이 없는 InterNews를 찾아 Gemini 필터링·포트폴리오 매칭을 채워 넣는다.
//
// 왜 필요한가: backfill-inter-historical.ts는 기사를 전부 저장한 "다음에" 마지막 단계에서
// 한 번만 필터링한다. 그래서 수집이 오래 걸리는 대규모 백필 도중 구글 차단·네트워크 오류·
// Ctrl-C로 죽으면, 저장은 됐지만 판정이 없는 InterNews 행이 남는다. 그 행들은 URL 기준
// 중복 방지에 걸려서 재실행해도 "신규"로 잡히지 않으므로, 영구히 판정 없이 방치된다
// (= 화면에 영원히 안 나옴). 이 스크립트가 그 구멍을 메운다.
//
// 실행:
//   npx tsx scripts/filter-inter-pending.ts --dry-run
//   npx tsx scripts/filter-inter-pending.ts [--limit=500] [--since=2024-08-01]
//
// 몇 번이든 다시 돌려도 안전하다 — 판정이 이미 있는 기사는 조회 대상에서 빠진다.

import './_env'; // ← .env.local 로드. 다른 import보다 먼저여야 한다
import { prisma } from '../src/lib/prisma';
import { filterInterNewsWithGemini } from '../src/lib/sparkscope/inter-filter';
import { matchInterNewsWithPortfolio } from '../src/lib/sparkscope/inter-portfolio-match';

async function main() {
  const arg = (k: string) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=')[1];
  const dryRun = process.argv.includes('--dry-run');
  const limit = Number(arg('limit') ?? 1000);
  const sinceRaw = arg('since');
  const since = sinceRaw ? new Date(`${sinceRaw}T00:00:00Z`) : undefined;
  if (sinceRaw && isNaN(since!.getTime())) throw new Error(`--since 날짜를 해석할 수 없습니다: ${sinceRaw}`);

  const pending = await prisma.interNews.findMany({
    where: {
      verdicts: { none: {} },
      ...(since ? { publishedAt: { gte: since } } : {}),
    },
    select: { id: true, source: true, title: true, publishedAt: true },
    orderBy: { publishedAt: 'asc' },
    take: limit,
  });

  const totalPending = await prisma.interNews.count({
    where: { verdicts: { none: {} }, ...(since ? { publishedAt: { gte: since } } : {}) },
  });

  console.log(`[Pending] 판정 없는 기사 ${totalPending}건 중 이번 실행 대상 ${pending.length}건`);
  if (pending.length === 0) {
    console.log('[Pending] 처리할 기사가 없습니다.');
    return;
  }

  const first = pending[0]!.publishedAt.toISOString().slice(0, 10);
  const last = pending[pending.length - 1]!.publishedAt.toISOString().slice(0, 10);
  console.log(`[Pending] 발행일 범위 ${first} ~ ${last}`);

  if (dryRun) {
    pending.slice(0, 20).forEach(a => {
      console.log(`[dry-run] ${a.publishedAt.toISOString().slice(0, 10)} | ${a.source} | ${a.title}`);
    });
    if (pending.length > 20) console.log(`[dry-run] ... 외 ${pending.length - 20}건`);
    return;
  }

  const ids = pending.map(a => a.id);
  const filterResult = await filterInterNewsWithGemini(ids);
  console.log(`[Pending] 필터링 완료: ${filterResult.relevant}/${filterResult.filtered} 관련`);

  if (filterResult.relevant > 0) {
    const relevantVerdicts = await prisma.interNewsVerdict.findMany({
      where: { newsId: { in: ids }, relevant: true },
      select: { id: true },
    });
    const matchResult = await matchInterNewsWithPortfolio(relevantVerdicts.map(v => v.id));
    console.log(`[Pending] 포트폴리오 매칭 완료: ${matchResult.matched}건`);
  }

  const stillPending = await prisma.interNews.count({ where: { verdicts: { none: {} } } });
  console.log(`[Pending] 남은 미판정 기사 ${stillPending}건`);
}

main()
  .catch(e => {
    console.error('[Pending] 실패:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
