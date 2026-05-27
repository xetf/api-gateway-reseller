ALTER TABLE "DedicatedRouteRule" ADD COLUMN "startsAt" TIMESTAMP(3);
ALTER TABLE "DedicatedRouteRule" ADD COLUMN "expiresAt" TIMESTAMP(3);

CREATE INDEX "DedicatedRouteRule_status_startsAt_expiresAt_idx" ON "DedicatedRouteRule"("status", "startsAt", "expiresAt");
