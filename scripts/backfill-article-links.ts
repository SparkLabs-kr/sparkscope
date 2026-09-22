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
 * --days 없으면 14일. --limit으로 건수 제한. --category로 분류를 좁힌다
 * (예: --category portfolio_company_tw,portfolio_company_gv). 중간에 끊겨도 이미 바꾼 건 건너뛰므로
 * 그냥 다시 실행하면 이어서 진행된다.
 *
 * 구글이 100건 남짓부터 막기 때문에(2026-09-21 실측) 한 번에 다 못 고친다.
 * --rounds를 주면 한 회차에 --limit건씩 고치고 --cooldown초 쉬었다가 다음 회차를 돈다.
 * 차단이 감지되면 그 회차는 일찍 끝나고, 쉬는 동안 차단이 풀리므로 결국 다 채워진다.
 *
 *   npx tsx --env-file=.env.local scripts/backfill-article-links.ts \
 *     --days 7 --limit 70 --rounds 20 --cooldown 900
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

/** 한 회차: 남아 있는 프록시 링크를 limit건까지 고치고 결과를 돌려준다. */
async function runRound(days: number, limit: number, dry: boolean, priorityOnly: boolean, only: string[] | null) {
  const since = new Date(Date.now() - days * 86400000);
  // 스파크랩·포트폴리오를 먼저 고친다. 구글 차단 때문에 한 번에 다 못 고치는데(아래 참고),
  // 사람이 실제로 누르는 건 대부분 이쪽이라 여기부터 채우는 게 맞다. AC·VC·업계동향은
  // 메일에서도 아래쪽 섹션이고 양이 훨씬 많아서(2026-09-22 기준 787/859건) 뒤로 민다.
  const PRIORITY_CATEGORIES = ['sparklabs_self', 'portfolio_company', 'portfolio_company_tw', 'portfolio_company_gv'];
  // --category로 특정 분류만 좁힐 수 있다. 구글이 100건 남짓부터 막아서 한 실행이 고칠 수
  // 있는 양이 정해져 있는데, --priority만으로는 건수가 압도적인 한국 포트폴리오(2026-09-22
  // 기준 1,047건)가 그 몫을 다 가져가 대만·GV는 순서가 영영 안 온다. 그쪽만 먼저 채울 때 쓴다.
  const where = {
    pubDate: { gte: since },
    link: { contains: 'news.google.com' },
    ...(only ? { category: { in: only } } : priorityOnly ? { category: { in: PRIORITY_CATEGORIES } } : {}),
  };
  const rows = await prisma.article.findMany({
    where,
    select: { id: true, link: true, title: true, source: true },
    orderBy: { pubDate: 'desc' },
    take: limit,
  });

  console.log(`[backfill-links] 최근 ${days}일 · 남은 프록시 링크 ${rows.length}건${dry ? ' (dry-run)' : ''}`);
  if (rows.length === 0) return { ok: 0, failed: 0, conflict: 0, remaining: 0 };

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

  const remaining = await prisma.article.count({ where });
  console.log(`[backfill-links] 회차 완료 — 성공 ${ok} · 해석실패 ${failed} · 중복 ${conflict} · 남음 ${remaining}`);
  return { ok, failed, conflict, remaining };
}

async function main() {
  const days = arg('days', 14);
  const limit = arg('limit', 100000);
  const rounds = arg('rounds', 1);
  const cooldown = arg('cooldown', 900);
  const dry = process.argv.includes('--dry');

  const priorityOnly = process.argv.includes('--priority');
  if (priorityOnly) console.log('[backfill-links] 스파크랩·포트폴리오 기사만 대상으로 돈다(--priority).');

  const ci = process.argv.indexOf('--category');
  const only = ci !== -1 && process.argv[ci + 1] ? process.argv[ci + 1].split(',').map(v => v.trim()).filter(Boolean) : null;
  if (only) console.log(`[backfill-links] 분류 ${only.join(', ')}만 대상으로 돈다(--category).`);

  let totalOk = 0;
  for (let n = 1; n <= rounds; n++) {
    if (rounds > 1) console.log(`\n===== ${n}/${rounds} 회차 =====`);

    // DB가 잠깐 끊겨도(P1001) 이번 회차만 건너뛰고 계속한다. 예전엔 여기서 예외가 그대로
    // 올라가 16회차 중간에 스크립트가 통째로 죽었다(2026-09-22).
    let r;
    try {
      r = await runRound(days, limit, dry, priorityOnly, only);
    } catch (e: any) {
      console.error(`  회차 실패(건너뜀): ${e?.message ?? e}`);
      await new Promise(res => setTimeout(res, cooldown * 1000));
      continue;
    }
    totalOk += r.ok;

    if (r.remaining === 0) { console.log('[backfill-links] 남은 게 없다 — 끝.'); break; }
    if (dry || n === rounds) break;

    // 차단은 15분으로 안 풀린다 — 실측으로 약 3시간이었다(2026-09-22: 20회차를 15분
    // 간격으로 돌렸더니 1회차와 13회차만 성공했다). 헛도는 회차가 곧 호출 낭비이자
    // 차단 연장이라, 막힌 것 같으면 훨씬 길게 쉰다.
    const blocked = r.ok === 0 && r.failed > 0;
    const wait = blocked ? Math.max(cooldown, 3 * 3600) : cooldown;
    if (blocked) console.log(`  (구글 차단으로 보인다 — ${(wait / 3600).toFixed(1)}시간 쉬었다가 다시 시도한다)`);
    await new Promise(res => setTimeout(res, wait * 1000));
  }

  console.log(`\n[backfill-links] 전체 완료 — 이번 실행에서 ${totalOk}건 고침`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
