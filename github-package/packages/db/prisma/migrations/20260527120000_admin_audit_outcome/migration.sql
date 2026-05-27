ALTER TABLE "AdminAuditLog" ADD COLUMN "outcome" TEXT;
ALTER TABLE "AdminAuditLog" ADD COLUMN "errorMessage" TEXT;

UPDATE "AdminAuditLog"
SET "outcome" = CASE
  WHEN "responseStatus" IS NULL THEN 'unknown'
  WHEN "responseStatus" >= 400 THEN 'failure'
  ELSE 'success'
END
WHERE "outcome" IS NULL;

CREATE INDEX "AdminAuditLog_outcome_createdAt_idx" ON "AdminAuditLog"("outcome", "createdAt");
