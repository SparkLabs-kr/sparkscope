import { runDailyDigest } from "@/lib/sparkscope/runner";

console.log("\n📰 SparkScope 기사 수집 시작\n");
console.log("기간: 2026-07-09(목) ~ 2026-07-15(수)\n");

try {
  const result = await runDailyDigest({
    send: false,           // 발송하지 않음
    skipCollect: false,    // 수집 실행
  });

  console.log("\n✅ 기사 수집 완료!\n");
  console.log("결과:", {
    collected: result?.collected || 0,
    analyzed: result?.analyzed || 0,
    saved: result?.saved || 0,
  });
} catch (error) {
  console.error("\n❌ 수집 중 오류 발생:\n", error);
  process.exit(1);
}
