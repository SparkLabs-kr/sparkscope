/**
 * 소셜 시그널 한국어 제목 백필.
 *
 * 번역은 수집하는 순간에만 붙어서, 이 구조가 생기기 전에 쌓인 행·번역 실패한 행은
 * titleKo가 null로 남는다(2026-09-08 확인: HN 223건 중 209건, Reddit 128건 중 108건).
 * 크론도 매 회차 조금씩 채우지만, 한 번에 밀어 넣으려면 이 스크립트를 쓴다.
 *
 * 사용: npx tsx --env-file=.env.local scripts/backfill-social-titles-ko.ts [--limit N]
 */
import { prisma } from '../src/lib/prisma';
import { translateBatchMemo } from '../src/lib/sparkscope/translate-content';
import { DOMAIN_SOURCES, NO_TRANSLATE } from '../src/lib/sparkscope/social-collect';

const BATCH = 40;
const LIMIT = (() => {
  const i = process.argv.indexOf('--limit');
  const v = i === -1 ? NaN : Number(process.argv[i + 1]);
  return Number.isFinite(v) && v > 0 ? v : 0;
})();

async function main() {
  // 화면에 실제로 쓰이는 소스만 — 모델 id(NO_TRANSLATE)는 번역하지 않는다.
  const sources = [...new Set([...DOMAIN_SOURCES.ai, ...DOMAIN_SOURCES.bio])]
    .filter(id => !NO_TRANSLATE.has(id));

  const rows = await prisma.socialSignal.findMany({
    where: { source: { in: sources }, titleKo: null },
    orderBy: { lastSeenAt: 'desc' },
    ...(LIMIT > 0 ? { take: LIMIT } : {}),
    select: { id: true, title: true, source: true },
  });
  console.log(`미번역 ${rows.length}건 (대상 소스: ${sources.join(', ')})`);
  if (rows.length === 0) { await prisma.$disconnect(); return; }

  let saved = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    try {
      const ko = await translateBatchMemo(chunk.map(r => r.title), 'ko');
      for (const [k, r] of chunk.entries()) {
        const v = ko[k];
        if (!v || !v.trim()) continue;
        await prisma.socialSignal.update({ where: { id: r.id }, data: { titleKo: v } });
        saved++;
      }
    } catch (e: any) {
      console.error(`  배치 실패(계속): ${(e?.message ?? '').split('\n')[0]}`);
    }
    process.stdout.write(`\r진행 ${Math.min(i + BATCH, rows.length)}/${rows.length} · 저장 ${saved}   `);
  }
  process.stdout.write('\n');
  console.log(`[backfill-social-titles-ko] ${saved}건 저장`);
  await prisma.$disconnect();
}

main().catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1); });
