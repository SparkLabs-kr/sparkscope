-- 2.1 로그인·계정 체계 — User에 role/companyId/active 추가
--
-- ┌──────────────────────────────────────────────────────────────────────┐
-- │ 이 마이그레이션은 기존 데이터를 단 한 줄도 바꾸지 않는다.              │
-- │  · 컬럼을 추가하기만 한다 (DROP / RENAME / 타입 변경 없음)            │
-- │  · 기존 행을 UPDATE 하지 않는다                                      │
-- │  · User 테이블 외에는 아무것도 건드리지 않는다                        │
-- │    (Article · MonitoringTarget · Digest · InterNews · Bookmark 무관)  │
-- └──────────────────────────────────────────────────────────────────────┘
--
-- 실행 방법: 이 SQL을 프로덕션 DB에 직접 실행한다.
--   ⚠️ `prisma db push` 를 쓰면 안 된다. 프로덕션 DB에는 schema.prisma가 모르는
--      컬럼/테이블이 남아 있어서(drift) db push가 그것들을 DROP 하려 든다.
--      20260824_add_article_en_columns 와 같은 방식이다.
--
-- 실행 시점: 코드 배포보다 먼저. 컬럼만 추가하는 변경이라 기존 코드(main 브랜치 포함)는
-- 새 컬럼을 그냥 무시한다 — 미리 실행해두어도 지금 돌아가는 서비스에 아무 영향이 없다.
-- 반대로 코드가 먼저 나가면 없는 컬럼을 조회해서 에러가 난다.
--
-- 전부 IF NOT EXISTS / 조건부라서 여러 번 실행해도 안전하다.

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "role"          TEXT      NOT NULL DEFAULT 'PORTFOLIO';
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "companyId"     TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "active"        BOOLEAN   NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "invitedBy"     TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "invitedAt"     TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "deactivatedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastLoginAt"   TIMESTAMP(3);

-- 기존 계정을 ADMIN으로 올리는 UPDATE는 일부러 넣지 않았다.
--
-- role 기본값은 최소 권한인 PORTFOLIO다. 그런데도 사내 계정이 잠기지 않는 이유는,
-- src/lib/authz.ts 의 getSessionUser()가 "사내 도메인 메일이면 role 값과 무관하게 관리자"로
-- 판단하고 그때 행을 스스로 고쳐두기 때문이다(ALLOWED_EMAIL_DOMAINS 기준).
--
-- 덕분에 이 마이그레이션은 기존 행을 건드리지 않아도 되고,
-- 여러 번 돌려도 발급해둔 포트폴리오사 계정이 관리자로 올라가는 사고가 날 수 없다.

CREATE INDEX IF NOT EXISTS "User_role_active_idx" ON "User"("role", "active");
CREATE INDEX IF NOT EXISTS "User_companyId_idx"   ON "User"("companyId");

-- 외래키는 IF NOT EXISTS 문법이 없으므로 존재 여부를 보고 붙인다.
-- companyId는 전부 NULL로 시작하므로 이 제약 때문에 실패할 기존 행이 없다.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'User_companyId_fkey'
  ) THEN
    ALTER TABLE "User"
      ADD CONSTRAINT "User_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "MonitoringTarget"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
