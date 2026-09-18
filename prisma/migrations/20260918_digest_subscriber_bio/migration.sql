-- 바이오 트렌드 TOP 5 구독 여부. 기본 true라 기존 구독자에게도 바로 보인다 —
-- 새 섹션이 아무에게도 안 보이는 상태로 조용히 묻히지 않게 하려는 것(schema.prisma 주석 참고).
ALTER TABLE "DigestSubscriber" ADD COLUMN IF NOT EXISTS "bioSignals" BOOLEAN NOT NULL DEFAULT true;
