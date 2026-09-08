-- 파트너 공개용 AI 시그널 피드 (2026-09-08)
--
-- 블루사이트가 Supabase anon key로 직접 읽어 자기 홈페이지 배너에 띄운다.
-- 그쪽이 우리 API를 부르는 대신 DB를 직접 조회하는 구조라, "무엇이 나가는가"를
-- 테이블·뷰 수준에서 못박아야 한다.
--
-- 왜 테이블이 필요한가: TOP 5의 절반(뉴스)은 조회 시점에 RSS에서 실시간으로 만들어지고
-- DB에 없었다. 랭킹 규칙(소스별 등수 환산 + 가중치)도 TypeScript에 있어 SQL 뷰만으로는
-- 재현할 수 없다. 그래서 발송 시각에 계산 결과를 여기 물질화한다.
-- 다이제스트 메일과 같은 함수(signal-feed.ts)가 만든 것을 그대로 쓰므로 둘이 갈리지 않는다.
--
-- prisma db push를 쓰지 않는다(drift). 항상 IF NOT EXISTS로 직접 실행한다.

CREATE TABLE IF NOT EXISTS "AiSignalFeed" (
  "id"          TEXT NOT NULL,
  -- 발행 회차. 같은 회차의 5건이 같은 값을 갖는다(월·수·금 발송 시각).
  "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "rank"        INTEGER NOT NULL,
  "kind"        TEXT NOT NULL,            -- 'news' | 'signal'
  "domain"      TEXT NOT NULL DEFAULT 'ai',
  "title"       TEXT NOT NULL,
  "titleKo"     TEXT,
  "url"         TEXT NOT NULL,
  "source"      TEXT NOT NULL,            -- 표시 이름 (Reuters, Hugging Face · 인기 모델)
  "sourceId"    TEXT NOT NULL,            -- 기계용 ('news' | hf | hn | …)
  "author"      TEXT,
  "points"      INTEGER,
  "pointsLabel" TEXT,
  "comments"    INTEGER,
  "alsoInCount" INTEGER,
  "summary"     TEXT,                     -- 한 줄 설명 (뉴스는 요약, 나머지는 blurb)
  "summaryEn"   TEXT,
  "itemDate"    TEXT,                     -- 원문 발행일 YYYY-MM-DD
  CONSTRAINT "AiSignalFeed_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AiSignalFeed_publishedAt_rank_idx" ON "AiSignalFeed"("publishedAt" DESC, "rank");

-- 원본 테이블은 잠근다. 파트너는 아래 뷰로만 본다.
ALTER TABLE "AiSignalFeed" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "AiSignalFeed" FROM anon, authenticated;

-- 파트너 공개 뷰 — 가장 최근 회차 5건만.
--
-- ⚠️ 컬럼을 하나씩 골라서 연다. SELECT * 를 쓰면 나중에 컬럼이 늘 때 의도치 않게 같이 나간다.
-- ⚠️ 포트폴리오사 매칭·내부 분석(ourTake·riskFlag)은 이 테이블에 애초에 없다.
CREATE OR REPLACE VIEW public.ai_signal_feed_public AS
SELECT
  f."publishedAt" AS published_at,
  f."rank",
  f."kind",
  f."domain",
  f."title",
  f."titleKo"     AS title_ko,
  f."url",
  f."source",
  f."sourceId"    AS source_id,
  f."author",
  f."points",
  f."pointsLabel" AS points_label,
  f."comments",
  f."alsoInCount" AS also_in_count,
  f."summary",
  f."summaryEn"   AS summary_en,
  f."itemDate"    AS item_date
FROM "AiSignalFeed" f
WHERE f."publishedAt" = (SELECT MAX("publishedAt") FROM "AiSignalFeed")
ORDER BY f."rank";

-- 뷰는 소유자 권한으로 실행된다(security_invoker 기본 false)므로 위 RLS를 통과한다.
-- inter_news_public이 이미 같은 방식으로 열려 있다.
GRANT SELECT ON public.ai_signal_feed_public TO anon, authenticated;
