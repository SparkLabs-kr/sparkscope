-- SocialSignal에 한 줄 설명(blurb) 추가 (2026-09-08)
--
-- Hugging Face 항목은 제목이 모델 id라("Qwopus3.8-27B-Flash-GGUF") 그것만으로는
-- 무슨 모델인지, 왜 많이 쓰이는지 알 수 없다. 모델 카드를 근거로 만든 한 줄 설명을 여기 담는다.
-- nullable이라 기존 코드는 그대로 동작한다.
--
-- prisma db push를 쓰지 않는다(drift). 항상 IF NOT EXISTS로 직접 실행한다.
--   실행: npx tsx --env-file=.env.local scripts/apply-migration.ts <이 파일 경로>

ALTER TABLE "SocialSignal" ADD COLUMN IF NOT EXISTS "blurb" TEXT;
