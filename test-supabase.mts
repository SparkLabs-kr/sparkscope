import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

console.log("=== Supabase 연결 테스트 ===\n");

// 1. URL 확인
console.log("✓ NEXT_PUBLIC_SUPABASE_URL:", supabaseUrl);
console.log("✓ NEXT_PUBLIC_SUPABASE_ANON_KEY:", supabaseAnonKey ? "✓ 설정됨" : "✗ 없음");

// 2. Supabase 클라이언트 생성
const supabase = createClient(supabaseUrl, supabaseAnonKey);
console.log("\n✓ Supabase 클라이언트 생성 완료");

// 3. 간단한 쿼리로 연결 테스트
try {
  const { data, error } = await supabase
    .from("articles")
    .select("count", { count: "exact" })
    .limit(1);

  if (error) {
    console.error("✗ 데이터베이스 쿼리 실패:", error.message);
  } else {
    console.log("✓ 데이터베이스 연결 성공!");
    console.log("✓ articles 테이블 존재 확인");
  }
} catch (err) {
  console.error("✗ 연결 오류:", err.message);
}

// 4. PostgreSQL 직접 연결 테스트
console.log("\n=== PostgreSQL 풀러 연결 테스트 ===\n");

const pgUrl = process.env.POSTGRES_PRISMA_URL;
console.log("✓ POSTGRES_PRISMA_URL 프로토콜:", pgUrl.split("://")[0]);
console.log("✓ 호스트:", pgUrl.match(/@(.*?):/)?.[1]);
console.log("✓ 포트:", pgUrl.match(/:(\d+)\//)?.[1]);
console.log("✓ pgbouncer:", pgUrl.includes("pgbouncer") ? "✓ 활성화" : "✗ 비활성화");

console.log("\n=== 결론 ===");
console.log("Supabase 프로젝트 ID: fdsfvsblbnqongeyvfjo");
console.log("지역: ap-northeast-2 (서울)");
console.log("풀러: aws-1-ap-northeast-2.pooler.supabase.com (IPv4)");
