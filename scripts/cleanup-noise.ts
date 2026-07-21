/**
 * 기존 수집분 소급 정리 — 관련성/노이즈 필터 위반 기사를 isNoise=true로 숨김.
 * 백필(backfill://)·curated 데이터는 제외, http로 수집된 기사만 대상. (되돌리기 가능)
 *
 * 드라이런(기본): 몇 건이 숨겨질지 + 샘플만 출력.
 * 적용:  CLEANUP_APPLY=1 tsx scripts/cleanup-noise.ts
 */
import { PrismaClient } from '@prisma/client';
import { filterReason } from '../src/lib/sparkscope/relevance';

const prisma = new PrismaClient();
const APPLY = process.env.CLEANUP_APPLY === '1';

async function main() {
  const targets = await prisma.monitoringTarget.findMany({ select: { primaryKeyword: true, name: true, englishName: true, helperKeywords: true, excludeWords: true, contextWords: true, category: true } });
  const byKw = new Map(targets.map(t => [t.primaryKeyword, t]));

  const articles = await prisma.article.findMany({
    where: { isNoise: false, link: { startsWith: 'http' } },
    select: { id: true, title: true, matchedKeyword: true },
  });
  console.log(`검사 대상(수집분, isNoise=false): ${articles.length}건`);

  const REASONS = ['exclude_word', 'missing_context', 'sports_ad', 'ad_noise', 'irrelevant'] as const;
  const byReason: Record<string, string[]> = { exclude_word: [], missing_context: [], sports_ad: [], ad_noise: [], irrelevant: [] };
  const violatorIds: Record<string, string[]> = { exclude_word: [], missing_context: [], sports_ad: [], ad_noise: [], irrelevant: [] };

  for (const a of articles) {
    const t = byKw.get(a.matchedKeyword);
    const relHelpers = t ? [t.name, t.englishName, t.helperKeywords].filter(Boolean).join(',') : null;
    const reason = filterReason({
      title: a.title,
      primaryKeyword: a.matchedKeyword,
      helperKeywords: relHelpers,
      excludeWords: t?.excludeWords ?? null,
      contextWords: t?.contextWords ?? null,
      category: t?.category ?? null,
    });
    if (reason) {
      violatorIds[reason].push(a.id);
      if (byReason[reason].length < 5) byReason[reason].push(`[${a.matchedKeyword}] ${a.title.slice(0, 40)}`);
    }
  }

  const totalViol = Object.values(violatorIds).reduce((s, arr) => s + arr.length, 0);
  console.log(`\n=== 위반(숨김 대상): ${totalViol}건 ===`);
  for (const r of REASONS) {
    console.log(`\n· ${r}: ${violatorIds[r].length}건`);
    byReason[r].forEach(s => console.log(`    - ${s}`));
  }
  console.log(`\n유지: ${articles.length - totalViol}건`);

  if (!APPLY) {
    console.log('\n[드라이런] 실제 반영 안 함. 적용하려면 CLEANUP_APPLY=1 로 재실행.');
    return;
  }

  let applied = 0;
  // exclude_word/contextWords 변경분도 기존 수집분에 소급 적용 (요청에 따라 전체 사유 포함).
  for (const r of REASONS) {
    const ids = violatorIds[r];
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const res = await prisma.article.updateMany({ where: { id: { in: chunk } }, data: { isNoise: true, noiseReason: r } });
      applied += res.count;
    }
  }
  console.log(`\n✅ 적용 완료: ${applied}건 숨김 처리(isNoise=true)`);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
