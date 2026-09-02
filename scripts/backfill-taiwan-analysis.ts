/**
 * 대만 기사 분석 백필 — 한국어 요약이 비어 있는 기사를 분석기에 태운다.
 *
 * 왜 필요한가:
 *   대만 120건은 3개월 트라이얼 때 DB에 직접 넣었고, 그 뒤 주간 크론은
 *   upsert의 update를 비워 둔다("이미 있는 기사는 건드리지 않는다" — 사람이 표시한
 *   스크랩·노이즈를 덮어쓰지 않기 위해). 그래서 이 120건은 분석 단계를 한 번도 타지 않았다.
 *   결과: oneLiner 0건 · analyzedAt 0건. 중문 제목만 있는 상태.
 *
 *   분석기 프롬프트는 "원문 언어와 무관하게 출력은 한국어"라서, 중문 기사를 태우면
 *   한국어 요약이 나온다. 즉 번역기를 따로 부르지 않아도 한국어는 여기서 채워진다.
 *
 * 무엇을 쓰고 무엇을 안 쓰는가:
 *   쓴다   — oneLiner · ourTake · importance · pitchScore · pitchTopic ·
 *            relatedCompanies · riskFlag · analyzedAt  (전부 지금 비어 있는 칸)
 *   안 쓴다 — tone. 이미 120건 전부 값이 있고, 그 값이 무엇을 근거로 들어갔는지
 *            이 스크립트는 모른다. 덮어쓰면 기존 판단이 조용히 사라진다.
 *            대신 분석기 판정과 저장된 값이 다른 건수를 리포트로만 남긴다.
 *   안 쓴다 — isNoise. 사람이 표시했을 수 있어 건드리지 않는다.
 *
 * 실행:
 *   npx tsx --env-file=.env.local scripts/backfill-taiwan-analysis.ts          (미리보기)
 *   npx tsx --env-file=.env.local scripts/backfill-taiwan-analysis.ts --write  (실제 저장)
 */
import { PrismaClient } from '@prisma/client';
import { analyzeArticles } from '../src/lib/sparkscope/analyzer';
import { TAIWAN_CATEGORY } from '../src/lib/sparkscope/taiwan-collect';
import type { RawArticle, Category } from '../src/lib/sparkscope/types';

const prisma = new PrismaClient();
const WRITE = process.argv.includes('--write');
const LIMIT = Number(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] ?? '0');

async function main() {
  const targets = await prisma.monitoringTarget.findMany({
    where: { category: TAIWAN_CATEGORY, status: 'ACTIVE' },
    select: { name: true, notes: true },
  });
  const descOf = new Map(targets.map(t => [t.name, t.notes ?? undefined]));

  const rows = await prisma.article.findMany({
    // 분석을 한 번도 안 탄 것만. 이미 요약이 있으면 건너뛴다 — 재실행해도 중복 결제가 없다.
    where: { category: TAIWAN_CATEGORY, oneLiner: null },
    orderBy: { pubDate: 'desc' },
    ...(LIMIT ? { take: LIMIT } : {}),
    select: {
      id: true, title: true, link: true, source: true, pubDate: true,
      matchedKeyword: true, category: true, priorityScore: true, tone: true,
    },
  });

  console.log(`분석 대상: ${rows.length}건 ${WRITE ? '(저장함)' : '(미리보기 — 저장하지 않음)'}`);
  if (rows.length === 0) {
    console.log('비어 있는 기사가 없습니다. 끝.');
    return;
  }

  const raw: RawArticle[] = rows.map(r => ({
    title: r.title,
    link: r.link,
    source: r.source,
    pubDate: r.pubDate,
    matchedKeyword: r.matchedKeyword,
    category: r.category as Category,
    basePriority: r.priorityScore,
    companyDesc: descOf.get(r.matchedKeyword),
  }));

  const t0 = Date.now();
  // trendingTopics는 국내 이슈 기준이라 대만엔 의미가 없어 빈 배열 (크론과 동일).
  const analyzed = await analyzeArticles(raw, targets.map(t => t.name), []);
  console.log(`분석 완료: ${analyzed.length}건 / ${((Date.now() - t0) / 1000).toFixed(0)}초\n`);

  const storedTone = new Map(rows.map(r => [r.link, r.tone]));
  const idOf = new Map(rows.map(r => [r.link, r.id]));

  let written = 0;
  const toneDiff: { title: string; stored: string | null; fresh: string }[] = [];

  for (const a of analyzed) {
    const id = idOf.get(a.link);
    if (!id) continue;

    const stored = storedTone.get(a.link) ?? null;
    if (stored !== a.tone) toneDiff.push({ title: a.title, stored, fresh: a.tone });

    if (WRITE) {
      await prisma.article
        .update({
          where: { id },
          data: {
            // tone·isNoise는 의도적으로 제외 (파일 상단 주석 참고).
            oneLiner: a.oneLiner,
            ourTake: a.ourTake ?? null,
            importance: a.importance,
            pitchScore: a.pitchScore,
            pitchTopic: a.pitchTopic ?? null,
            relatedCompanies: a.relatedCompanies?.length ? JSON.stringify(a.relatedCompanies) : null,
            riskFlag: a.riskFlag ?? null,
            analyzedAt: new Date(),
          },
        })
        .then(() => { written++; })
        .catch(e => console.error('저장 실패:', a.link, e));
    }
  }

  console.log('=== 한국어 요약 샘플 (중문 제목 → 한국어 oneLiner) ===');
  for (const a of analyzed.slice(0, 8)) {
    console.log(`  원문: ${a.title.slice(0, 54)}`);
    console.log(`  요약: ${a.oneLiner}`);
    console.log(`  톤: ${a.tone}  중요도: ${a.importance}  피칭: ${a.pitchScore}`);
    console.log('  ---');
  }

  console.log(`\n=== 톤 비교 (저장된 값은 건드리지 않았다) ===`);
  console.log(`  분석기와 저장값이 다른 기사: ${toneDiff.length} / ${analyzed.length}`);
  for (const d of toneDiff.slice(0, 8)) {
    console.log(`    ${d.stored ?? 'null'} → ${d.fresh}   ${d.title.slice(0, 46)}`);
  }
  if (toneDiff.length > 8) console.log(`    ... 외 ${toneDiff.length - 8}건`);

  console.log(WRITE ? `\n저장 완료: ${written}건` : '\n미리보기였습니다. 저장하려면 --write 를 붙이세요.');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
