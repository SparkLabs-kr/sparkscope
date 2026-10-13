-- 브리핑 영상 시청 집계 (2026-10-12)
-- 적용은 scripts/apply-migration.ts 로만 한다 (prisma migrate / db push 사용 금지).
-- 전부 IF NOT EXISTS 라서 여러 번 돌려도 안전하다.

-- 구독자 소속 부서 (시트 '부서' 열) — 본부별 집계용
ALTER TABLE "DigestSubscriber" ADD COLUMN IF NOT EXISTS "department" TEXT;

-- 시청 이벤트 기록
CREATE TABLE IF NOT EXISTS "BriefingView" (
  "id"           TEXT         NOT NULL PRIMARY KEY,
  "dateKey"      TEXT         NOT NULL,
  "event"        TEXT         NOT NULL,
  "visitorId"    TEXT,
  "subscriberId" TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "BriefingView_dateKey_event_idx" ON "BriefingView" ("dateKey", "event");
CREATE INDEX IF NOT EXISTS "BriefingView_subscriberId_idx" ON "BriefingView" ("subscriberId");

-- 파트너용 anon 키로 직접 조회되지 않도록 RLS를 켠다 (정책은 없음 = anon 차단, 서버 연결은 그대로)
ALTER TABLE "BriefingView" ENABLE ROW LEVEL SECURITY;
