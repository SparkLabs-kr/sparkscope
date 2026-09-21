/**
 * 구글 뉴스 프록시 링크(news.google.com/rss/articles/…)를 진짜 언론사 주소로 바꾼다.
 *
 * 왜 필요한가: 메일·대시보드는 프록시 링크를 열지 못해서 제목 검색(구글) 결과로 돌려보낸다
 * (article-link.ts). 읽는 사람이 기사 하나 보려고 검색 결과를 한 번 더 거쳐야 한다.
 * 수집 쪽은 2026-09-21에 고쳐서 새 기사는 진짜 주소로 들어오지만, 이미 저장된 기사는
 * 그대로 남아 있다 — 발송은 DB에 있는 기사를 쓰므로 이 스크립트로 채워야 한다.
 *
 *   npx tsx --env-file=.env.local scripts/backfill-article-links.ts --days 14 --dry
 *   npx tsx --env-file=.env.local scripts/backfill-article-links.ts --days 14
 *
 * --days 없으면 14일. --limit으로 건수 제한. 중간에 끊겨도 이미 바꾼 건 건너뛰므로
 * 그냥 다시 실행하면 이어서 진행된다.
 */
import './_env';
import { prisma } from '../src/lib/prisma';
import { resolveGoogleNewsUrls } from '../src/lib/sparkscope/google-news-resolver';

const CHUNK = 40; // 한 번에 해석할 묶음 — 진행 상황을 자주 찍고 중간에 끊겨도 덜 잃는다.

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) ? v : fallback;
}

async function main() {
  const days = arg('days', 14);
  const limit = arg('limit', 100000);
  const dry = process.argv.includes('--dry');

  const since = new Date(Date.now() - days * 86400000);
  const rows = await prisma.article.findMany({
    where: { pubDate: { gte: since }, link: { contains: 'news.google.com' } },
    select: { id: true, link: true, title: true, source: true },
    orderBy: { pubDate: 'desc' },
    take: limit,
  });

  console.log(`[backfill-links] 최근 ${days}일 · 프록시 링크 ${rows.length}건${dry ? ' (dry-run)' : ''}`);
  if (rows.length === 0) return;

  let ok = 0, failed = 0, conflict = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const map = await resolveGoogleNewsUrls(chunk.map(r => r.link));

    for (const r of chunk) {
      const real = map.get(r.link);
      if (!real) { failed++; continue; }
      if (dry) { ok++; continue; }
      try {
        await prisma.article.update({ where: { id: r.id }, data: { link: real } });
        ok++;
      } catch {
        // link는 unique다. 같은 기사가 이미 진짜 주소로 저장돼 있으면 여기로 온다 —
        // 중복이 하나 남는 것뿐이라 그냥 둔다(제목 기준 중복 제거가 메일에서 다시 걸러낸다).
        conflict++;
      }
    }
    console.log(`  ${Math.min(i + CHUNK, rows.length)}/${rows.length} — 성공 ${ok} · 해석실패 ${failed} · 중복 ${conflict}`);
  }

  console.log(`[backfill-links] 완료 — 성공 ${ok} · 해석실패 ${failed} · 중복충돌 ${conflict}`);
  if (failed > 0) {
    console.log('  해석실패는 원본 링크를 그대로 뒀다 — 예전처럼 제목 검색으로 열린다(기사가 사라지지는 않는다).');
  }
  if (failed > ok) {
    console.log('');
    console.log('  ⚠️  실패가 성공보다 많다 — 구글이 막았을 가능성이 높다(100건 남짓이 한계).');
    console.log('     몇 시간 뒤 같은 명령을 다시 돌리면 이미 고친 건 건너뛰고 이어서 진행한다.');
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
