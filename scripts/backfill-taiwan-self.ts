/**
 * 대만 스파크랩 자사 언급 기사 백필.
 *
 * 왜 필요한가:
 *   '스파크랩 타이완' 감시 대상은 category가 sparklabs_self라 collector.ts(네이버)가
 *   담당했는데, 네이버는 대만 매체를 색인하지 않아 최근 90일 0건이었다(2026-09-07).
 *   taiwan-collect.ts(구글 뉴스 zh-TW)가 자사 대상도 함께 조회하도록 고친 뒤,
 *   그동안 못 받은 과거 기사를 이 스크립트로 채운다.
 *
 * 사용:
 *   npx tsx --env-file=.env.local scripts/backfill-taiwan-self.ts [--days 30] [--dry]
 *
 * 기본 30일 — 우선 1개월치만 채우기로 했다(2026-09-08). 대시보드의 대만 자사 언급 탭도
 * 그에 맞춰 기간 프리셋을 7일·1개월만 보여준다.
 */
import { collectTaiwanArticles } from '../src/lib/sparkscope/taiwan-collect';
import { analyzeArticles } from '../src/lib/sparkscope/analyzer';
import { ensureArticleKo, ensureArticleEn } from '../src/lib/sparkscope/translate-content';
import { normalizeSource } from '../src/lib/sparkscope/media';
import { prisma } from '../src/lib/prisma';

function argNum(flag: string, dflt: number): number {
  const i = process.argv.indexOf(flag);
  if (i === -1) return dflt;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) && v > 0 ? v : dflt;
}

async function main() {
  const days = argNum('--days', 30);
  const dry = process.argv.includes('--dry');

  console.log(`[backfill-taiwan-self] 최근 ${days}일 · 자사 대상만 조회${dry ? ' (dry-run)' : ''}`);

  const raw = (await collectTaiwanArticles(days, { onlySelf: true }))
    .filter(a => a.category === 'sparklabs_self');

  console.log(`  수집 후보 ${raw.length}건`);
  if (raw.length === 0) {
    console.log('  0건 — 구글 뉴스에 해당 기간 기사가 없거나 필터에서 전부 걸러졌다.');
    await prisma.$disconnect();
    return;
  }
  for (const a of raw) {
    console.log(`    [${a.source}] ${a.pubDate.toISOString().slice(0, 10)} ${a.title.slice(0, 80)}`);
  }
  if (dry) {
    console.log('  dry-run — 저장하지 않고 종료');
    await prisma.$disconnect();
    return;
  }

  // 이미 있는 링크는 분석까지 갈 필요가 없다 — LLM 호출을 아낀다.
  const existing = new Set(
    (await prisma.article.findMany({
      where: { link: { in: raw.map(a => a.link) } },
      select: { link: true },
    })).map(r => r.link),
  );
  const fresh = raw.filter(a => !existing.has(a.link));
  console.log(`  신규 ${fresh.length}건 (기존 ${existing.size}건은 건너뜀)`);
  if (fresh.length === 0) {
    await prisma.$disconnect();
    return;
  }

  const analyzed = await analyzeArticles(fresh, ['스파크랩 타이완', 'SparkLabs Taiwan'], []);

  let saved = 0;
  for (const a of analyzed) {
    try {
      await prisma.article.upsert({
        where: { link: a.link },
        create: {
          title: a.title,
          link: a.link,
          source: normalizeSource(a.source),
          pubDate: a.pubDate,
          matchedKeyword: a.matchedKeyword,
          category: a.category,
          importance: a.importance,
          tone: a.tone,
          oneLiner: a.oneLiner,
          ourTake: a.ourTake,
          priorityScore: a.basePriority,
          pitchScore: a.pitchScore,
          pitchTopic: a.pitchTopic ?? null,
          relatedCompanies: a.relatedCompanies?.length ? JSON.stringify(a.relatedCompanies) : null,
          riskFlag: a.riskFlag ?? null,
          analyzedAt: new Date(),
        },
        // 이미 있는 기사는 건드리지 않는다 — 사람이 스크랩·노이즈 표시한 걸 덮어쓰면 안 된다.
        update: {},
      });
      saved++;
    } catch (e) {
      console.error('  저장 실패:', a.link, e);
    }
  }

  // 제목 번역 캐시 — title은 번체 중문 원문이라 안 채우면 한국어 화면에 중문이 그대로 나온다.
  let translated = 0;
  try {
    const rows = await prisma.article.findMany({
      where: { link: { in: analyzed.map(a => a.link) }, OR: [{ titleKo: null }, { titleEn: null }] },
      select: { id: true, title: true, titleKo: true, titleEn: true, oneLiner: true, oneLinerEn: true, pitchTopic: true, pitchTopicEn: true },
    });
    if (rows.length > 0) {
      await ensureArticleKo(rows);
      await ensureArticleEn(rows);
      translated = rows.length;
    }
  } catch (e) {
    console.error('  제목 번역 실패(저장은 성공):', e);
  }

  console.log(`[backfill-taiwan-self] 저장 ${saved}건 · 제목 번역 ${translated}건`);
  await prisma.$disconnect();
}

main().catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1); });
