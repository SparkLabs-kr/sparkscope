/**
 * 기존 DB의 "부분일치 노이즈" 정리 — portfolio_company 기사 중 회사명이
 * 독립 토큰(주어)으로 등장하지 않는 기사를 isNoise=true로 마킹.
 *   예: '노리'→'노리지만'(동사), '리코'→'인실리코'(Insilico)
 *
 * ⚠️ 공유 Neon DB에 씀. 기본은 dry-run(미리보기)만. 실제 반영은 --apply 필요.
 *   미리보기:  npx tsx scripts/cleanup-irrelevant.ts
 *   실제반영:  npx tsx scripts/cleanup-irrelevant.ts --apply
 * (tsx는 .env.local 자동 로드 안 함 — 실행 전 env 주입 필요)
 */
import { prisma } from '../src/lib/prisma';
import { matchesAsToken } from '../src/lib/sparkscope/relevance';

(async () => {
  const apply = process.argv.includes('--apply');
  const targets = await prisma.monitoringTarget.findMany({
    where: { category: 'portfolio_company', status: 'ACTIVE' },
    select: { primaryKeyword: true, name: true, englishName: true, helperKeywords: true },
  });
  const keyMap = new Map<string, string[]>();
  for (const t of targets) {
    const keys = [t.primaryKeyword, t.name, t.englishName, ...(t.helperKeywords ?? '').split(',')]
      .map(k => (k ?? '').trim()).filter(k => k.length >= 2);
    keyMap.set(t.primaryKeyword, Array.from(new Set(keys)));
  }

  const rows = await prisma.article.findMany({
    where: { category: 'portfolio_company', isNoise: false },
    select: { id: true, title: true, matchedKeyword: true },
  });

  const toMark = rows.filter(a => {
    const keys = keyMap.get(a.matchedKeyword) ?? [a.matchedKeyword];
    return !keys.some(k => matchesAsToken(a.title, k));
  });

  console.log(`portfolio 비노이즈 총 ${rows.length}건 중 제외 대상: ${toMark.length}건`);
  console.log('샘플 10건:');
  for (const a of toMark.slice(0, 10)) console.log(`  [${a.matchedKeyword}] ${a.title.slice(0, 55)}`);

  if (!apply) {
    console.log('\n(dry-run) 실제 반영하려면 --apply 를 붙여 다시 실행하세요.');
    await prisma.$disconnect();
    process.exit(0);
  }

  let n = 0;
  for (const a of toMark) {
    await prisma.article.update({ where: { id: a.id }, data: { isNoise: true, noiseReason: 'irrelevant' } });
    n++;
    if (n % 200 === 0) console.log(`  ...${n} 처리`);
  }
  console.log(`✅ ${n}건 isNoise=true 처리 완료.`);
  await prisma.$disconnect();
  process.exit(0);
})();
