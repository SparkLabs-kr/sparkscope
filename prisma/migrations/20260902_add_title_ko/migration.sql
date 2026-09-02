-- Article.titleKo — 한국어 화면용 제목 번역 캐시.
--
-- 왜 필요한가: title은 원문 그대로를 담는다. 국내 기사는 그게 한국어지만 대만 기사는
-- 번체 중문이라(120건 중 119건) 한국어 화면에 중문 제목이 그대로 나간다.
-- titleEn과 대칭인 자리를 하나 만들어 준다.
--
-- 안전성: 순수 추가. 기존 컬럼·데이터·인덱스를 건드리지 않으며 NULL 허용이라
-- 기존 행은 그대로 유효하다. IF NOT EXISTS라서 재실행해도 안전하다.
ALTER TABLE "Article" ADD COLUMN IF NOT EXISTS "titleKo" TEXT;
