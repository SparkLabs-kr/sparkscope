/**
 * 대만 도입 판단용 — 한국 포트폴리오사의 실제 기사량을 뽑는다.
 *
 * 대만은 구글 뉴스 RSS 트라이얼로 3개월 142건(보도 114 · 공시 28) / 15개사를 실측했다.
 * 비교 대상인 한국 수치는 아직 추정치라 판단 근거로 쓰기 어렵다 — 이 스크립트로 실제 값을 채운다.
 *
 * 대시보드(src/app/dashboard/page.tsx)와 같은 조건을 쓴다:
 *   category='portfolio_company', isNoise=false, pubDate 범위 필터.
 * 그래야 화면에 보이는 숫자와 어긋나지 않는다.
 *
 * 실행: npx tsx scripts/compare-taiwan-baseline.ts
 */
import './_env';                       // ← 반드시 첫 줄 (.env.local 우선 로딩)
import { prisma } from '../src/lib/prisma';

const CATEGORY = 'portfolio_company';

// 대만 트라이얼과 같은 기준일(2026-08-26)을 써야 기간이 대응된다.
const TO = new Date('2026-08-26T23:59:59Z');
const WINDOWS: Array<{ label: string; days: number }> = [
  { label: '7일', days: 7 },
  { label: '1개월', days: 30 },
  { label: '3개월', days: 90 },
  { label: '1년', days: 365 },
];

async function main() {
  const targets = await prisma.monitoringTarget.count({ where: { category: CATEGORY } });
  const active = await prisma.monitoringTarget.count({ where: { category: CATEGORY, status: 'ACTIVE' } });
  const withContext = await prisma.monitoringTarget.count({
    where: { category: CATEGORY, contextWords: { not: null } },
  });
  const withExclude = await prisma.monitoringTarget.count({
    where: { category: CATEGORY, excludeWords: { not: null } },
  });

  console.log('=== 한국 포트폴리오사 기준선 ===');
  console.log(`모니터링 대상 ${targets}개 (ACTIVE ${active})`);
  console.log(`문맥어 설정 ${withContext}개 · 제외어 설정 ${withExclude}개\n`);

  console.log('기간별 기사 수 (isNoise=false):');
  for (const w of WINDOWS) {
    const since = new Date(TO.getTime() - w.days * 24 * 60 * 60 * 1000);
    const count = await prisma.article.count({
      where: { category: CATEGORY, isNoise: false, pubDate: { gte: since, lte: TO } },
    });
    // 기사가 하나라도 잡힌 회사 수 — 대만의 "15개사"와 직접 비교되는 값이다.
    const companies = await prisma.article.groupBy({
      by: ['matchedKeyword'],
      where: { category: CATEGORY, isNoise: false, pubDate: { gte: since, lte: TO } },
      _count: { _all: true },
    });
    console.log(`  ${w.label.padEnd(6)} ${String(count).padStart(6)}건 · ${String(companies.length).padStart(4)}개사`);
  }

  // 3개월 상위 회사 — 대만이 永悅健康 한 곳에 쏠린 것과 비교하기 위한 값.
  const since90 = new Date(TO.getTime() - 90 * 24 * 60 * 60 * 1000);
  const top = await prisma.article.groupBy({
    by: ['matchedKeyword'],
    where: { category: CATEGORY, isNoise: false, pubDate: { gte: since90, lte: TO } },
    _count: { _all: true },
    orderBy: { _count: { matchedKeyword: 'desc' } },
    take: 10,
  });
  console.log('\n3개월 상위 10개사:');
  top.forEach((t, i) => console.log(`  ${String(i + 1).padStart(2)}. ${t.matchedKeyword} — ${t._count._all}건`));

  const total90 = top.reduce((a, t) => a + t._count._all, 0);
  const all90 = await prisma.article.count({
    where: { category: CATEGORY, isNoise: false, pubDate: { gte: since90, lte: TO } },
  });
  console.log(`\n상위 10개사가 3개월 전체의 ${all90 ? Math.round((total90 / all90) * 100) : 0}% 차지`);
  console.log(`\n--- 대만 트라이얼(3개월): 142건 · 15개사 (보도 114 · 공시 28) ---`);
  if (all90) console.log(`대만 / 한국 = ${((142 / all90) * 100).toFixed(1)}%`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
