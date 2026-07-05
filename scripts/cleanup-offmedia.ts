/**
 * 확정 매체 26개(media.ts) 외 기사를 isNoise=true(noiseReason='off_media')로 마킹.
 * → KPI·기사목록·비교카드 등 isNoise=false 기반 화면이 모두 26개 매체 기준으로 정렬됨.
 *   미리보기:  npx tsx scripts/cleanup-offmedia.ts
 *   실제반영:  npx tsx scripts/cleanup-offmedia.ts --apply
 * (되돌리기: noiseReason='off_media' 인 것을 isNoise=false 로. tsx는 env 수동 주입 필요)
 */
import { prisma } from '../src/lib/prisma';
import { isKnownMedia } from '../src/lib/sparkscope/media';

(async () => {
  const apply = process.argv.includes('--apply');
  const rows = await prisma.article.findMany({ where: { isNoise: false }, select: { id: true, source: true } });
  const off = rows.filter(r => !isKnownMedia(r.source));
  console.log(`비노이즈 총 ${rows.length}건 중 26개 매체 외: ${off.length}건 (${rows.length ? Math.round(off.length / rows.length * 100) : 0}%)`);

  // 어떤 매체들이 잘려나가는지 상위 확인
  const bySource = new Map<string, number>();
  for (const r of off) bySource.set(r.source, (bySource.get(r.source) ?? 0) + 1);
  const top = Array.from(bySource.entries()).sort((a, b) => b[1] - a[1]).slice(0, 15);
  console.log('제외 매체 상위 15:');
  for (const [s, n] of top) console.log(`  ${s}: ${n}`);

  if (!apply) { console.log('\n(dry-run) 실제 반영하려면 --apply'); process.exit(0); }

  let n = 0;
  const ids = off.map(o => o.id);
  const BATCH = 500;
  for (let i = 0; i < ids.length; i += BATCH) {
    const chunk = ids.slice(i, i + BATCH);
    await prisma.article.updateMany({ where: { id: { in: chunk } }, data: { isNoise: true, noiseReason: 'off_media' } });
    n += chunk.length;
    console.log(`  ...${n}/${ids.length}`);
  }
  console.log(`✅ ${n}건 off_media 처리 완료.`);
  process.exit(0);
})();
