-- 설명 생성 시도 시각 (2026-09-08)
--
-- 근거를 못 구해 설명을 못 만든 항목이, 크론이 돌 때마다 무한히 다시 시도되며 큐를 막았다.
-- 실측: Reddit 128건이 매 회차 앞자리를 차지해 arXiv·Lobsters 차례가 오지 않았다.
-- 시도한 시각을 남겨 일정 기간 다시 시도하지 않게 한다.
--
-- prisma db push를 쓰지 않는다(drift). 항상 IF NOT EXISTS로 직접 실행한다.

ALTER TABLE "SocialSignal" ADD COLUMN IF NOT EXISTS "blurbTriedAt" TIMESTAMP(3);
