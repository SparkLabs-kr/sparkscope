/**
 * 이미 저장된 기사 중 "…"로 잘린 제목을 원문 og:title로 되살린다(title-restore.ts와 같은 로직).
 *
 *   npx tsx --env-file=.env.local scripts/backfill-truncated-titles.ts [--days 14] [--dry]
 *
 * 다시 돌려도 안전하다 — 이미 고친 제목은 "…"로 끝나지 않아 건너뛴다.
 */
import { prisma } from '../src/lib/prisma';
import { restoreTitle } from '../src/lib/sparkscope/title-restore';

const arg = (n: string) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };

(async () => {
  const days = Number(arg('--days') ?? 14);
  const dry = process.argv.includes('--dry');
  const rows = await prisma.article.findMany({
    where: { OR: [{ title: { endsWith: '...' } }, { title: { endsWith: '…' } }], pubDate: { gte: new Date(Date.now() - days * 864e5) } },
    select: { id: true, title: true, link: true },
  });
  let fixed = 0;
  for (let i = 0; i < rows.length; i += 8) {
    await Promise.all(rows.slice(i, i + 8).map(async r => {
      const full = await restoreTitle(r.title, r.link);
      if (full === r.title) return;
      fixed++;
      if (!dry) await prisma.article.update({ where: { id: r.id }, data: { title: full, titleEn: null } });
    }));
    if (i % 80 === 0) console.log(`${i}/${rows.length} · 되살림 ${fixed}`);
  }
  console.log(`끝 — ${rows.length}건 중 ${fixed}건 되살림${dry ? '(dry)' : ''}`);
  await prisma.$disconnect();
})();
