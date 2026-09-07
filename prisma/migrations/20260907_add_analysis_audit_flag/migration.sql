-- AnalysisAuditFlag — 주간 분석 오류 감사 결과 큐.
-- 순수 신규 테이블 추가라 기존 컬럼·데이터를 건드리지 않는다. IF NOT EXISTS라서 재실행해도 안전하다.
CREATE TABLE IF NOT EXISTS "AnalysisAuditFlag" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "snapshotTone" TEXT,
    "snapshotRiskFlag" TEXT,
    "snapshotOneLiner" TEXT,
    "issue" TEXT NOT NULL,
    "confidence" TEXT NOT NULL DEFAULT 'high',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    CONSTRAINT "AnalysisAuditFlag_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AnalysisAuditFlag_status_idx" ON "AnalysisAuditFlag"("status");
CREATE INDEX IF NOT EXISTS "AnalysisAuditFlag_articleId_idx" ON "AnalysisAuditFlag"("articleId");
