-- 지사(region) + 시너지 매칭용 컬럼/테이블 추가 (2026-09-08)
--
-- prisma db push를 쓰지 않는다. 프로덕션에 schema.prisma가 모르는 컬럼·테이블이
-- 남아 있어서(drift) db push가 그것들을 DROP 하려 든다. 항상 IF NOT EXISTS로 직접 실행한다.
--   실행: npx tsx --env-file=.env.local scripts/apply-migration.ts <이 파일 경로>

-- ── MonitoringTarget ────────────────────────────────────────────
-- region: 'kr' | 'tw' | 'sa' | 'au' | 'us' …
-- 지사가 늘 때마다 category를 쪼개는 방식(portfolio_company_tw)을 끝내기 위한 컬럼.
-- 기존 category는 수집 파이프라인 호환을 위해 그대로 둔다.
ALTER TABLE "MonitoringTarget" ADD COLUMN IF NOT EXISTS "region" TEXT;
ALTER TABLE "MonitoringTarget" ADD COLUMN IF NOT EXISTS "domain" TEXT;
ALTER TABLE "MonitoringTarget" ADD COLUMN IF NOT EXISTS "sector" TEXT;
ALTER TABLE "MonitoringTarget" ADD COLUMN IF NOT EXISTS "embedding" TEXT;
ALTER TABLE "MonitoringTarget" ADD COLUMN IF NOT EXISTS "embeddedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "MonitoringTarget_region_idx" ON "MonitoringTarget"("region");
CREATE INDEX IF NOT EXISTS "MonitoringTarget_sector_idx" ON "MonitoringTarget"("sector");

-- 기존 행의 region 채우기 — 지금은 나라가 category 안에 들어 있다.
UPDATE "MonitoringTarget" SET "region" = 'tw' WHERE "category" = 'portfolio_company_tw' AND "region" IS NULL;
UPDATE "MonitoringTarget" SET "region" = 'kr' WHERE "category" <> 'portfolio_company_tw' AND "region" IS NULL;

-- ── SynergyPair ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "SynergyPair" (
  "id"           TEXT NOT NULL,
  "krTargetId"   TEXT NOT NULL,
  "krName"       TEXT NOT NULL,
  "twTargetId"   TEXT NOT NULL,
  "twName"       TEXT NOT NULL,
  "twRegion"     TEXT NOT NULL,
  "sector"       TEXT,
  "similarity"   DOUBLE PRECISION NOT NULL,
  "relation"     TEXT NOT NULL,
  "rationale"    TEXT,
  "collabFormat" TEXT,
  "feedback"     TEXT,
  "feedbackBy"   TEXT,
  "feedbackAt"   TIMESTAMP(3),
  "computedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SynergyPair_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SynergyPair_krTargetId_twTargetId_key" ON "SynergyPair"("krTargetId", "twTargetId");
CREATE INDEX IF NOT EXISTS "SynergyPair_relation_idx" ON "SynergyPair"("relation");
CREATE INDEX IF NOT EXISTS "SynergyPair_sector_idx" ON "SynergyPair"("sector");
CREATE INDEX IF NOT EXISTS "SynergyPair_similarity_idx" ON "SynergyPair"("similarity");

-- 해외 지사 자사 대상의 region 교정 — 위 일괄 UPDATE는 category 기준이라 전부 'kr'로 들어간다.
-- sparklabs_self에는 지사 법인이 섞여 있으므로 이름으로 바로잡는다(멱등).
UPDATE "MonitoringTarget" SET "region" = 'tw' WHERE "name" = '스파크랩 타이완';
UPDATE "MonitoringTarget" SET "region" = 'sa' WHERE "name" = '스파크랩 사우디';
UPDATE "MonitoringTarget" SET "region" = 'au' WHERE "name" = '스파크랩 호주';
UPDATE "MonitoringTarget" SET "region" = 'us' WHERE "name" IN ('스파크랩 글로벌벤처스', '스파크랩 글로벌');

-- embedSource: 실제로 임베딩한 텍스트를 남긴다.
-- 한국 회사 설명은 한국어, 대만은 영어라 그대로 임베딩하면 같은 사업이어도 코사인이 눌린다
-- (2026-09-08 실측: 베러먼데이코리아 "커피 프랜차이즈" ↔ IDrip "coffee maker" = 0.221).
-- 그래서 한국어 설명은 영어 한 줄로 정규화한 뒤 임베딩하고, 그 텍스트를 여기 보관한다
-- — 나중에 "왜 이 둘이 비슷하다고 나왔나"를 사람이 되짚을 수 있어야 한다.
ALTER TABLE "MonitoringTarget" ADD COLUMN IF NOT EXISTS "embedSource" TEXT;
