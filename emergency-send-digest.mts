/**
 * 🚨 비상 발송 명령어
 *
 * 용도: 오전 9시 크론이 실패한 경우, 로컬에서 직접 발송
 * 특징: 수집 없음, DB의 기존 데이터만 사용
 *
 * 실행: npx tsx emergency-send-digest.mts
 */

import { runDailyDigest } from "@/lib/sparkscope/runner";

console.log("\n🚨 === 비상 발송 모드 === 🚨\n");
console.log("⚠️  주의: 오전 9시 크론 실패 시에만 실행!");
console.log("⚠️  중복 발송 위험이 있습니다.\n");

// 3초 대기 (실수로 실행하는 것 방지)
console.log("3초 후 발송이 시작됩니다... (Ctrl+C로 취소 가능)");
await new Promise(resolve => setTimeout(resolve, 3000));

try {
  console.log("\n📧 발송 시작...\n");

  const result = await runDailyDigest({
    send: true,           // 🔑 발송 실행
    skipCollect: true,    // 수집 건너뜀 (기존 데이터만 사용)
  });

  console.log("\n✅ 비상 발송 완료!\n");
  console.log("결과:", {
    digestId: result?.digestId,
    subject: result?.subject,
    mailResult: result?.mailResult ? "발송됨" : "발송 실패",
  });

  console.log("\n📋 발송 확인:");
  console.log("  1. staff@sparklabs.co.kr 메일함 확인");
  console.log("  2. DB 발송 기록: npx prisma studio");

} catch (error) {
  console.error("\n❌ 비상 발송 실패:\n", error);
  process.exit(1);
}
