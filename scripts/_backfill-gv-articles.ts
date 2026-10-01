/**
 * GV 포트폴리오사 과거 기사 백필 (일회성).
 *
 * 크론 라우트(/api/cron/gv-collect)와 같은 경로를 쓰되, 분석·저장을 배치로 쪼갠다 —
 * 90일치는 기사가 수백 건이라 라우트의 maxDuration 300초를 넘긴다. HTTP를 안 타므로
 * 타임아웃이 없다.
 *
 *   npx tsx --env-file=.env.local scripts/_backfill-gv-articles.ts [일수] [--dry]
 *
 * 재실행 안전: 저장은 link 기준 upsert에 update:{}라 이미 있는 기사를 건드리지 않는다
 * (사람이 스크랩·노이즈 표시한 것이 덮어써지지 않는다).
 */
import './_env';
import { prisma } from '../src/lib/prisma';
import { collectGvArticles, GV_SELF_NAME, GV_CATEGORY } from '../src/lib/sparkscope/gv-collect';
import { analyzeArticles } from '../src/lib/sparkscope/analyzer';
import { ensureArticleKo, ensureArticleEn } from '../src/lib/sparkscope/translate-content';

const BATCH = 40; // 분석 한 묶음 — 진행을 자주 찍고 중간에 끊겨도 앞부분은 남는다.

async function main() {
  const days = Number(process.argv[2]) || 90;
  const dry = process.argv.includes('--dry');

  console.log(`[gv-backfill] 최근 ${days}일 수집 시작${dry ? ' (dry)' : ''}`);
  const raw = await collectGvArticles(days);
  console.log(`[gv-backfill] 후보 ${raw.length}건`);
  if (raw.length === 0) return;

  // 이미 DB에 있는 링크는 분석에서 제외한다 — LLM 비용이 아깝고, 저장 단계에서
  // update:{}로 어차피 무시된다.
  const existing = new Set(
    (await prisma.article.findMany({
      where: { link: { in: raw.map(a => a.link) } },
      select: { link: true },
    })).map(r => r.link),
  );
  const fresh = raw.filter(a => !existing.has(a.link));
  console.log(`[gv-backfill] 기존 ${existing.size}건 제외 → 신규 ${fresh.length}건`);
  if (fresh.length === 0 || dry) {
    if (dry) console.log('[gv-backfill] dry — 분석·저장 안 함');
    return;
  }

  const universe = (await prisma.monitoringTarget.findMany({
    where: { OR: [{ category: GV_CATEGORY }, { name: GV_SELF_NAME }] },
    select: { name: true },
  })).map(u => u.name);

  let saved = 0, analyzedTotal = 0;
  for (let i = 0; i < fresh.length; i += BATCH) {
    const chunk = fresh.slice(i, i + BATCH);
    const round = Math.floor(i / BATCH) + 1;
    const rounds = Math.ceil(fresh.length / BATCH);
    console.log(`[gv-backfill] ${round}/${rounds} 회차 — ${chunk.length}건 분석 중...`);

    const analyzed = await analyzeArticles(chunk, universe, []);
    analyzedTotal += analyzed.length;

    for (const a of analyzed) {
      try {
        await prisma.article.upsert({
          where: { link: a.link },
          create: {
            title: a.title, link: a.link, source: a.source, pubDate: a.pubDate,
            matchedKeyword: a.matchedKeyword, category: a.category,
            importance: a.importance, tone: a.tone, oneLiner: a.oneLiner, ourTake: a.ourTake,
            priorityScore: a.basePriority, pitchScore: a.pitchScore,
            pitchTopic: a.pitchTopic ?? null,
            relatedCompanies: a.relatedCompanies?.length ? JSON.stringify(a.relatedCompanies) : null,
            riskFlag: a.riskFlag ?? null, analyzedAt: new Date(),
          },
          update: {},
        });
        saved++;
      } catch (e) {
        console.error('[gv-backfill] 저장 실패:', a.link, e);
      }
    }

    // 제목 번역은 회차마다 — 마지막에 몰면 중간에 끊겼을 때 전부 비어 있게 된다.
    try {
      const rows = await prisma.article.findMany({
        where: { link: { in: analyzed.map(a => a.link) }, OR: [{ titleKo: null }, { titleEn: null }] },
        select: { id: true, title: true, titleKo: true, titleEn: true, oneLiner: true, oneLinerEn: true, pitchTopic: true, pitchTopicEn: true },
      });
      if (rows.length > 0) { await ensureArticleKo(rows); await ensureArticleEn(rows); }
    } catch (e) {
      console.error('[gv-backfill] 번역 실패(수집·저장은 성공):', e);
    }
    console.log(`[gv-backfill] ${round}/${rounds} 완료 — 누적 저장 ${saved}건`);
  }

  console.log(`[gv-backfill] 끝 — 후보 ${raw.length} · 신규 ${fresh.length} · 분석통과 ${analyzedTotal} · 저장 ${saved}`);
  await prisma.$disconnect();
}
main();
