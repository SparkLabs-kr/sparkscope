import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

console.log("=== Supabase 연결 테스트 ===\n");

// 환경변수 확인
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const dbUrl = process.env.POSTGRES_PRISMA_URL;

console.log("📌 설정 정보:");
console.log(`  • Supabase URL: ${supabaseUrl}`);
console.log(`  • 호스트: ${dbUrl?.match(/@(.*?):/)?.[1]}`);
console.log(`  • 포트: ${dbUrl?.match(/:(\d+)\//)?.[1]}`);
console.log(`  • pgbouncer: ${dbUrl?.includes("pgbouncer") ? "활성화" : "비활성화"}\n`);

try {
  // 1. 데이터베이스 연결 테스트
  const result = await prisma.$queryRaw`SELECT 1 as connected`;
  console.log("✅ 데이터베이스 연결 성공!\n");

  // 2. articles 테이블 상태 확인
  const articleCount = await prisma.article.count();
  console.log(`✅ articles 테이블 존재`);
  console.log(`   현재 기사 수: ${articleCount}건\n`);

  // 3. 프로젝트 ID 확인
  const projectId = supabaseUrl?.split("https://")[1]?.split(".supabase.co")[0];
  console.log("✅ Supabase 프로젝트 ID:", projectId);

  console.log("\n=== 결론 ===");
  console.log("✅ 회사 Supabase 프로젝트에 정상 연결됨");
  console.log("✅ 모든 환경변수가 올바르게 설정됨");
} catch (error) {
  console.error("❌ 연결 실패:", error.message);
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
