-- 다이제스트 구독자 표. 여러 번 실행해도 안전하도록 전부 IF NOT EXISTS로 쓴다.
CREATE TABLE IF NOT EXISTS "DigestSubscriber" (
  "id"         TEXT NOT NULL,
  "email"      TEXT NOT NULL,
  "name"       TEXT,
  "sparklabs"  BOOLEAN NOT NULL DEFAULT true,
  "portfolio"  BOOLEAN NOT NULL DEFAULT true,
  "inter"      BOOLEAN NOT NULL DEFAULT true,
  "aiSignals"  BOOLEAN NOT NULL DEFAULT true,
  "competitor" BOOLEAN NOT NULL DEFAULT true,
  "industry"   BOOLEAN NOT NULL DEFAULT true,
  "active"     BOOLEAN NOT NULL DEFAULT true,
  "token"      TEXT NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DigestSubscriber_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DigestSubscriber_email_key" ON "DigestSubscriber"("email");
CREATE UNIQUE INDEX IF NOT EXISTS "DigestSubscriber_token_key" ON "DigestSubscriber"("token");
CREATE INDEX IF NOT EXISTS "DigestSubscriber_active_idx" ON "DigestSubscriber"("active");

-- 파트너(anon key)에게 열려 있는 뷰가 아니므로 RLS를 켜 둔다. CLAUDE.md의 신규 테이블 규칙.
ALTER TABLE "DigestSubscriber" ENABLE ROW LEVEL SECURITY;
