ALTER TABLE "ModelPoolChannel" ADD COLUMN "recoverySuccesses" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ModelPoolChannel" ADD COLUMN "penalizedUntil" TIMESTAMP(3);
ALTER TABLE "ModelPoolChannel" ADD COLUMN "penaltyReason" TEXT;

CREATE INDEX "ModelPoolChannel_penalizedUntil_idx" ON "ModelPoolChannel"("penalizedUntil");

CREATE TABLE "UpstreamProviderKey" (
  "id" TEXT NOT NULL,
  "upstreamProviderId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "keyPrefix" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "priority" INTEGER NOT NULL DEFAULT 100,
  "lastUsedAt" TIMESTAMP(3),
  "lastCheckStatus" TEXT,
  "lastCheckedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "UpstreamProviderKey_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UpstreamProviderKey_upstreamProviderId_fkey" FOREIGN KEY ("upstreamProviderId") REFERENCES "UpstreamProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "UpstreamProviderKey_upstreamProviderId_status_priority_idx" ON "UpstreamProviderKey"("upstreamProviderId", "status", "priority");
CREATE INDEX "UpstreamProviderKey_lastUsedAt_idx" ON "UpstreamProviderKey"("lastUsedAt");
CREATE UNIQUE INDEX "UpstreamProviderKey_upstreamProviderId_name_key" ON "UpstreamProviderKey"("upstreamProviderId", "name");

INSERT INTO "UpstreamProviderKey" (
  "id",
  "upstreamProviderId",
  "name",
  "key",
  "keyPrefix",
  "status",
  "priority",
  "createdAt",
  "updatedAt"
)
SELECT
  'upk_' || md5("id" || ':' || "apiKey"),
  "id",
  '默认 Key',
  "apiKey",
  left("apiKey", 12),
  CASE WHEN "status" = 'ACTIVE' THEN 'ACTIVE' ELSE 'DISABLED' END,
  100,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "UpstreamProvider"
WHERE "apiKey" IS NOT NULL
  AND length(trim("apiKey")) > 0
ON CONFLICT DO NOTHING;

ALTER TABLE "ApiRequest" ADD COLUMN "upstreamProviderKeyId" TEXT;
CREATE INDEX "ApiRequest_upstreamProviderKeyId_createdAt_idx" ON "ApiRequest"("upstreamProviderKeyId", "createdAt");
ALTER TABLE "ApiRequest" ADD CONSTRAINT "ApiRequest_upstreamProviderKeyId_fkey" FOREIGN KEY ("upstreamProviderKeyId") REFERENCES "UpstreamProviderKey"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "SystemSetting" ("key", "value", "createdAt", "updatedAt")
VALUES ('model_pool_penalty_seconds', '60', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
