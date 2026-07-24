import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

console.log("=== 7/9(목) ~ 7/15(수) 기사 현황 ===\n");

try {
  // 합계
  const total = await prisma.article.count({
    where: {
      pubDate: {
        gte: new Date("2026-07-09"),
        lt: new Date("2026-07-16"),
      },
    },
  });

  // 날짜별 상세 (쿼리로 직접)
  const dailyBreakdown = await prisma.$queryRaw`
    SELECT DATE("pubDate") as date, COUNT(*) as count
    FROM "Article"
    WHERE "pubDate" >= '2026-07-09'::date AND "pubDate" < '2026-07-16'::date
    GROUP BY DATE("pubDate")
    ORDER BY date
  `;

  console.log("📅 날짜별:");
  for (const row of dailyBreakdown) {
    console.log(`  ${row.date}: ${Number(row.count)}건`);
  }

  console.log(`\n✅ 총 ${total}건\n`);

  if (total === 0) {
    console.log("⚠️  기사가 수집되지 않았습니다. 수집 스크립트를 실행해야 합니다.");
  }
} catch (error) {
  console.error("❌ 오류:", error.message);
} finally {
  await prisma.$disconnect();
}
