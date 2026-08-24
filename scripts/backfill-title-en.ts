/**
 * Article.titleEn / oneLinerEn / pitchTopicEn 백필.
 *
 * EN 화면은 이 값이 있으면 LLM 호출 없이 바로 영어로 그려진다. 비어 있으면 조회 때
 * 즉석 번역하는데(translate-content.ts), 대시보드처럼 목록이 많은 화면은 그만큼 느려진다.
 * 그래서 한 번 전체를 채워두고, 이후 새 기사는 수집 크론이 이어서 채운다.
 *
 * 사용:
 *   npx tsx --env-file=.env.local scripts/backfill-title-en.ts            # 최근 것부터 전체
 *   npx tsx --env-file=.env.local scripts/backfill-title-en.ts --limit 500
 *   npx tsx --env-file=.env.local scripts/backfill-title-en.ts --days 30  # 최근 30일만
 *   npx tsx --env-file=.env.local scripts/backfill-title-en.ts --inter     # Inter 탭 판정·매칭 사유
 *
 * 중간에 끊겨도 안전하다 — 이미 채운 것은 건너뛰므로 그냥 다시 실행하면 이어서 진행된다.
 */
import { prisma } from '../src/lib/prisma';
import { ensureArticleEn, ensureInterReasonEn } from '../src/lib/sparkscope/translate-content';

const CHUNK = 60; // 한 번에 DB에서 꺼내 번역할 기사 수

function argNum(flag: string): number | undefined {
  const i = process.argv.indexOf(flag);
  if (i < 0) return undefined;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) ? v : undefined;
}

/**
 * Inter 탭의 판정 사유(InterNewsVerdict.reason)·매칭 사유(InterPortfolioMatch.reason) 백필.
 * 같은 문구가 많이 겹쳐서(예: "AI 인프라 트렌드") 실제 번역 건수는 행 수보다 훨씬 적다.
 */
async function backfillInterReasons(limit?: number) {
  const CHUNK_ROWS = 200;
  let done = 0;
  for (;;) {
    const [verdicts, matches] = await Promise.all([
      prisma.interNewsVerdict.findMany({
        where: { relevant: true, reasonEn: null },
        orderBy: { filteredAt: 'desc' },
        take: CHUNK_ROWS,
        select: { id: true, reason: true, reasonEn: true },
      }),
      prisma.interPortfolioMatch.findMany({
        where: { reasonEn: null },
        orderBy: { matchedAt: 'desc' },
        take: CHUNK_ROWS,
        select: { id: true, reason: true, reasonEn: true },
      }),
    ]);
    if (verdicts.length === 0 && matches.length === 0) break;

    await ensureInterReasonEn(verdicts, matches);
    const filled = verdicts.filter(v => v.reasonEn).length + matches.filter(m => m.reasonEn).length;
    if (filled === 0) {
      console.error('[backfill:inter] 한 건도 번역되지 않았다 — 중단합니다.');
      break;
    }
    done += filled;
    console.log(`[backfill:inter] 누적 ${done}건 (이번 묶음 판정 ${verdicts.length} / 매칭 ${matches.length})`);
    if (limit && done >= limit) break;
  }
  console.log(`[backfill:inter] 완료: ${done}건`);
}

async function main() {
  if (process.argv.includes('--inter')) return backfillInterReasons(argNum('--limit'));
  const limit = argNum('--limit');
  const days = argNum('--days');

  const where: Record<string, unknown> = {
    isNoise: false,
    titleEn: null,
    ...(days ? { pubDate: { gte: new Date(Date.now() - days * 86400_000) } } : {}),
  };

  const todo = await prisma.article.count({ where });
  const target = limit ? Math.min(limit, todo) : todo;
  console.log(`[backfill] 대상 ${todo}건, 이번 실행 ${target}건`);
  if (target === 0) return;

  let done = 0;
  const startedAt = Date.now();
  while (done < target) {
    const take = Math.min(CHUNK, target - done);
    const rows = await prisma.article.findMany({
      where,
      orderBy: { pubDate: 'desc' }, // 최근 기사가 화면에 먼저 뜨므로 먼저 채운다
      take,
      select: { id: true, title: true, titleEn: true, oneLiner: true, oneLinerEn: true, pitchTopic: true, pitchTopicEn: true },
    });
    if (rows.length === 0) break;

    // max: rows.length — 백필은 화면 응답과 달리 상한을 둘 이유가 없다.
    await ensureArticleEn(rows, { max: rows.length });

    // 번역이 전부 실패해 titleEn이 하나도 안 채워지면 같은 행을 계속 다시 집어 무한 루프가 된다.
    const filled = rows.filter(r => r.titleEn).length;
    if (filled === 0) {
      console.error('[backfill] 이 묶음에서 한 건도 번역되지 않았다 — API 키·요금·한도를 확인하고 다시 실행하세요. 중단합니다.');
      break;
    }

    done += rows.length;
    const perSec = done / ((Date.now() - startedAt) / 1000);
    const left = Math.round((target - done) / Math.max(perSec, 0.01));
    console.log(`[backfill] ${done}/${target} (이 묶음 ${filled}/${rows.length} 성공, 남은 시간 약 ${left}초)`);
  }
  console.log(`[backfill] 완료: ${done}건, ${Math.round((Date.now() - startedAt) / 1000)}초`);
}

main()
  .catch(e => { console.error('[backfill] 실패:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
