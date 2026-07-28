/**
 * 과거 기사 소급 재분류 — helperKeywords(대표자명·별칭 등 "진짜 보조 식별자")만으로 매칭되고
 * 강한 식별자(회사명·영문명·주키워드, 또는 그 단순 표기 변형)는 전혀 없는 기사를 isNoise=true 처리.
 *
 * 배경: relevance.ts의 filterReason이 예전엔 강한 식별자와 helperKeywords를 구분 없이 OR로
 * 묶어서, "버나드문"(대표자명)만 있고 회사명("스파크랩 그룹") 자체는 없는 기사도 통과시켰음.
 * 2026-07-28 filterReason 수정으로 앞으로 수집되는 기사는 막히지만, 기존 저장분은 소급 재검증 필요.
 * (relevance.ts의 resolveMainKeys()를 그대로 재사용 — 로직 이원화 방지)
 *
 * 드라이런(기본): 몇 건이 해당될지 + 목록 출력만.
 * 적용: APPLY=1 npx tsx scripts/cleanup-helper-only-matches.ts
 */
import { PrismaClient } from '@prisma/client';
import { scrapeArticleBody } from '../src/lib/sparkscope/scraper';
import { resolveGoogleNewsUrl } from '../src/lib/sparkscope/google-news-resolver';
import { matchesAsToken, matchesAsDirectMention, resolveMainKeys } from '../src/lib/sparkscope/relevance';

const prisma = new PrismaClient();
const APPLY = process.env.APPLY === '1';
const CONCURRENCY = 4;
const SCRAPE_DELAY_MS = 300;

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function scrapeBody(link: string): Promise<string> {
  try {
    let target = link;
    if (link.includes('news.google.com')) {
      const resolved = await resolveGoogleNewsUrl(link);
      if (!resolved) return '';
      target = resolved;
    }
    const body = await scrapeArticleBody(target);
    return body?.text ?? '';
  } catch {
    return '';
  }
}

async function main() {
  const targets = await prisma.monitoringTarget.findMany({
    where: { category: { in: ['portfolio_company', 'sparklabs_self'] }, helperKeywords: { not: null } },
    select: { primaryKeyword: true, name: true, englishName: true, helperKeywords: true, category: true },
  });
  const byKw = new Map(targets.map(t => [t.primaryKeyword, t]));
  const targetKws = [...byKw.keys()];
  console.log(`대상 키워드: ${targetKws.length}개 (helperKeywords 설정된 포트폴리오사·스파크랩 계열)`);

  const articles = await prisma.article.findMany({
    where: { matchedKeyword: { in: targetKws }, isNoise: false, link: { startsWith: 'http' } },
    select: { id: true, title: true, link: true, matchedKeyword: true },
  });
  console.log(`검사 대상 기사: ${articles.length}건 (제목 매칭 우선, 없으면 본문 재스크래핑)\n`);

  const toNoise: { id: string; title: string; keyword: string; matchedVia: string }[] = [];
  let done = 0;
  let scraped = 0;

  for (let i = 0; i < articles.length; i += CONCURRENCY) {
    const batch = articles.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(async a => {
      const target = byKw.get(a.matchedKeyword);
      if (!target) return null;

      const { mainKeys, trueHelpers } = resolveMainKeys({
        primaryKeyword: target.primaryKeyword,
        name: target.name,
        englishName: target.englishName,
        helperKeywords: target.helperKeywords,
        title: a.title,
      });
      if (trueHelpers.length === 0) return null; // 진짜 보조 식별자가 없으면 이 검사 대상 아님

      const mainInTitle = mainKeys.some(k => matchesAsToken(a.title, k));
      if (mainInTitle) return null; // 제목에 메인(또는 표기변형) 있으면 정상 — 스크래핑 불필요

      const helperInTitle = trueHelpers.some(k => matchesAsToken(a.title, k));
      if (!helperInTitle) return null; // 제목에 보조 식별자도 없으면 이 검사와 무관(다른 사유로 저장됐을 것)

      // 제목엔 보조 식별자만 있음 — 본문에 메인 식별자가 있는지 재확인(있으면 정상, 없으면 노이즈)
      const body = await scrapeBody(a.link);
      scraped++;
      const mainInBody = body.length > 0 && mainKeys.some(k => matchesAsDirectMention(body, k));
      if (mainInBody) return null;

      return { id: a.id, title: a.title, keyword: a.matchedKeyword, matchedVia: trueHelpers.find(k => matchesAsToken(a.title, k))! };
    }));

    for (const r of results) if (r) toNoise.push(r);

    done += batch.length;
    if (done % 20 === 0 || done === articles.length) {
      process.stdout.write(`\r진행: ${done}/${articles.length} | 본문 재확인: ${scraped}건 | 노이즈 후보: ${toNoise.length}건`);
    }
    await sleep(SCRAPE_DELAY_MS);
  }

  console.log(`\n\n=== 노이즈로 분류될 기사: ${toNoise.length}건 ===`);
  toNoise.forEach(a => console.log(`- [${a.keyword}] (보조식별자: ${a.matchedVia}) ${a.title}`));

  if (!APPLY) {
    console.log('\n[드라이런] DB 반영 안 함. 적용하려면 APPLY=1 로 재실행.');
    return;
  }

  const ids = toNoise.map(a => a.id);
  let updated = 0;
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const res = await prisma.article.updateMany({
      where: { id: { in: chunk } },
      data: { isNoise: true, noiseReason: 'helper_keyword_only' },
    });
    updated += res.count;
  }
  console.log(`\n✅ 완료: ${updated}건 isNoise=true 처리`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
