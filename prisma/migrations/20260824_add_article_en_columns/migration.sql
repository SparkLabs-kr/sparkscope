-- EN 화면용 번역 캐시 컬럼 추가.
--
-- 기존 컬럼을 건드리지 않는 순수 추가 마이그레이션이다. `prisma db push`를 쓰지 않는 이유는
-- 프로덕션 DB에 schema.prisma가 모르는 컬럼/테이블이 남아 있어(drift) db push가 그것들을
-- DROP 하려 들기 때문이다. 이 SQL만 직접 실행하면 안전하다.
ALTER TABLE "Article" ADD COLUMN IF NOT EXISTS "titleEn" TEXT;
ALTER TABLE "Article" ADD COLUMN IF NOT EXISTS "oneLinerEn" TEXT;
ALTER TABLE "Article" ADD COLUMN IF NOT EXISTS "pitchTopicEn" TEXT;

-- Inter 탭 판정·매칭 사유의 영어 캐시.
ALTER TABLE "InterNewsVerdict" ADD COLUMN IF NOT EXISTS "reasonEn" TEXT;
ALTER TABLE "InterPortfolioMatch" ADD COLUMN IF NOT EXISTS "reasonEn" TEXT;
