-- 매체 1면 헤드라인·인기기사 관측 기록 (NewsHeadline)
--
-- 조회 시점에 긁으면 "지금 1면"만 알 수 있어서, 하루만 지나도 어제 1면을 휩쓴 사안이
-- 신호 0이 된다. 2시간마다 관측해 쌓아 두고 기간 조회 시 이 기록을 본다.
--
-- 멱등하게 쓴다 — 여러 번 돌려도 안전해야 한다.

CREATE TABLE IF NOT EXISTS "NewsHeadline" (
  "id"          TEXT NOT NULL,
  "source"      TEXT NOT NULL,
  "domain"      TEXT NOT NULL,
  "kind"        TEXT NOT NULL,
  "title"       TEXT NOT NULL,
  "url"         TEXT NOT NULL,
  "rank"        INTEGER NOT NULL,
  "bestRank"    INTEGER NOT NULL,
  "views"       INTEGER,
  "domestic"    BOOLEAN NOT NULL DEFAULT false,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NewsHeadline_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "NewsHeadline_source_url_key" ON "NewsHeadline"("source", "url");
CREATE INDEX IF NOT EXISTS "NewsHeadline_domain_lastSeenAt_idx" ON "NewsHeadline"("domain", "lastSeenAt");
CREATE INDEX IF NOT EXISTS "NewsHeadline_domain_kind_bestRank_idx" ON "NewsHeadline"("domain", "kind", "bestRank");

-- raw SQL로 만든 테이블은 RLS가 꺼진 채 생성된다(CLAUDE.md의 파트너 공개 규칙).
-- 정책 없이 켜면 deny-all이 되고, anon에는 GRANT도 하지 않는다 — 파트너에게 여는 것은
-- 뷰뿐이고 이 테이블은 대상이 아니다.
ALTER TABLE "NewsHeadline" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "NewsHeadline" FROM anon, authenticated;
