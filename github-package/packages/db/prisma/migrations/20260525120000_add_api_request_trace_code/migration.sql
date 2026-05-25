ALTER TABLE "ApiRequest" ADD COLUMN "traceCode" TEXT;

UPDATE "ApiRequest"
SET "traceCode" = 'REQ-LEGACY-' || upper(substr(md5("id"), 1, 12))
WHERE "traceCode" IS NULL;

ALTER TABLE "ApiRequest" ALTER COLUMN "traceCode" SET NOT NULL;

CREATE UNIQUE INDEX "ApiRequest_traceCode_key" ON "ApiRequest"("traceCode");
