-- 2.2 AI 시그널 — 소셜 시그널과 시점별 수치 저장
--
-- ┌──────────────────────────────────────────────────────────────────┐
-- │ 기존 테이블·데이터를 전혀 건드리지 않는다. 새 테이블 두 개만 만든다.  │
-- └──────────────────────────────────────────────────────────────────┘
--
-- 실행 방법: 이 SQL을 직접 실행한다. `prisma db push`는 쓰지 않는다 —
-- 프로덕션 DB에 schema.prisma가 모르는 컬럼/테이블이 남아 있어(drift) db push가
-- 그것들을 DROP 하려 든다. (20260824_add_article_en_columns 와 같은 방식)
--
-- 여러 번 실행해도 안전하다.

CREATE TABLE IF NOT EXISTS "SocialSignal" (
  "id"          TEXT         NOT NULL,
  "source"      TEXT         NOT NULL,
  "externalId"  TEXT         NOT NULL,
  "domain"      TEXT         NOT NULL,
  "title"       TEXT         NOT NULL,
  "url"         TEXT         NOT NULL,
  "origin"      TEXT,
  "author"      TEXT,
  "publishedAt" TIMESTAMP(3),
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "points"      INTEGER      NOT NULL DEFAULT 0,
  "comments"    INTEGER      NOT NULL DEFAULT 0,
  CONSTRAINT "SocialSignal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SocialSignal_source_externalId_key" ON "SocialSignal"("source", "externalId");
CREATE INDEX IF NOT EXISTS "SocialSignal_domain_lastSeenAt_idx" ON "SocialSignal"("domain", "lastSeenAt");
CREATE INDEX IF NOT EXISTS "SocialSignal_firstSeenAt_idx"       ON "SocialSignal"("firstSeenAt");

CREATE TABLE IF NOT EXISTS "SocialSignalSample" (
  "id"        TEXT         NOT NULL,
  "signalId"  TEXT         NOT NULL,
  "points"    INTEGER      NOT NULL,
  "comments"  INTEGER      NOT NULL,
  "sampledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SocialSignalSample_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SocialSignalSample_signalId_sampledAt_idx" ON "SocialSignalSample"("signalId", "sampledAt");
CREATE INDEX IF NOT EXISTS "SocialSignalSample_sampledAt_idx"          ON "SocialSignalSample"("sampledAt");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SocialSignalSample_signalId_fkey') THEN
    ALTER TABLE "SocialSignalSample"
      ADD CONSTRAINT "SocialSignalSample_signalId_fkey"
      FOREIGN KEY ("signalId") REFERENCES "SocialSignal"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
