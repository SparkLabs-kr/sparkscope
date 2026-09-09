import { collectSocialSignals } from '../src/lib/sparkscope/social-collect';
import { prisma } from '../src/lib/prisma';
(async()=>{
  for (const dom of ['ai','bio'] as const) {
    const s=await collectSocialSignals(dom, Date.now()-90*864e5);
    console.log(`\n=== ${dom} · 소스 ${s.length}개 ===`);
    s.forEach(x=>console.log(`  ${x.label.padEnd(24)} ${String(x.posts.length).padStart(2)}건 ${x.stale?'[저장분]':''} ${x.connected?'':'(연결 필요)'} ${x.ranked?'인기순':'최신순'}`));
  }
  await prisma.$disconnect();
})();
