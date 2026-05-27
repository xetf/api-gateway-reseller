CREATE TYPE "ApiRequestResultType" AS ENUM ('PROXIED_SUCCESS', 'UPSTREAM_ERROR', 'GATEWAY_NOTICE', 'IP_BAN', 'RATE_LIMITED', 'INSUFFICIENT_BALANCE', 'MANUAL_TERMINATED', 'AUTO_TERMINATED', 'BILLING_ERROR', 'CLIENT_CLOSED', 'GATEWAY_ERROR');

ALTER TABLE "ApiRequest" ADD COLUMN "resultType" "ApiRequestResultType";

UPDATE "ApiRequest"
SET "resultType" = CASE
  WHEN "status" = 'SUCCESS' THEN 'PROXIED_SUCCESS'::"ApiRequestResultType"
  WHEN "status" = 'FAILED' AND "responseUsage"->>'reason' = 'ip_ban' THEN 'IP_BAN'::"ApiRequestResultType"
  WHEN "status" = 'FAILED' AND COALESCE(("responseUsage"->>'returnedToUser')::boolean, false) = true THEN 'GATEWAY_NOTICE'::"ApiRequestResultType"
  WHEN "status" = 'FAILED' THEN 'UPSTREAM_ERROR'::"ApiRequestResultType"
  ELSE NULL
END
WHERE "resultType" IS NULL;

CREATE INDEX "ApiRequest_resultType_createdAt_idx" ON "ApiRequest"("resultType", "createdAt");
