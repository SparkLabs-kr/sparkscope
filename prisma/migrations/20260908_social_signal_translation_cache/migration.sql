-- SocialSignal에 번역 캐시·점수 단위 컬럼 추가 (2026-09-08)
--
-- 테이블 본체는 20260902_add_social_signals가 이미 만들어 프로덕션에 적용돼 있다.
-- 여기서는 컬럼 두 개만 더한다 — 둘 다 nullable이라 기존 코드는 그대로 동작한다.
--
-- prisma db push를 쓰지 않는다. 프로덕션에 schema.prisma가 모르는 컬럼·테이블이
-- 남아 있어서(drift) db push가 그것들을 DROP 하려 든다. 항상 IF NOT EXISTS로 직접 실행한다.
--   실행: npx tsx --env-file=.env.local scripts/apply-migration.ts <이 파일 경로>

-- KO 화면용 번역 캐시. 지금은 메모리(6시간 TTL)에만 있어서 배포마다 날아가고,
-- 같은 제목을 다시 번역하며 계속 과금됐다.
ALTER TABLE "SocialSignal" ADD COLUMN IF NOT EXISTS "titleKo" TEXT;

-- points가 무엇을 세는지. HF 좋아요(14,271)와 HF 다운로드(26,731)와 HN 업보트(2,288)를
-- 같은 ▲로 표시하면 규모를 오해한다.
ALTER TABLE "SocialSignal" ADD COLUMN IF NOT EXISTS "pointsLabel" TEXT;
