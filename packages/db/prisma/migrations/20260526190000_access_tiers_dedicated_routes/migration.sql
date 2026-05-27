CREATE TYPE "AccessTierStatus" AS ENUM ('ACTIVE', 'DISABLED');
CREATE TYPE "DedicatedRouteTargetType" AS ENUM ('USER', 'API_KEY', 'IP');
CREATE TYPE "DedicatedRouteRuleStatus" AS ENUM ('ACTIVE', 'DISABLED');

CREATE TABLE "AccessTier" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" "AccessTierStatus" NOT NULL DEFAULT 'ACTIVE',
  "sortOrder" INTEGER NOT NULL DEFAULT 100,
  "description" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AccessTier_pkey" PRIMARY KEY ("id")
);

INSERT INTO "AccessTier" ("id", "code", "name", "status", "sortOrder", "description", "createdAt", "updatedAt")
VALUES ('tier_standard', 'standard', 'Standard', 'ACTIVE', 100, 'Default access tier', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

ALTER TABLE "User" ADD COLUMN "tierId" TEXT;
ALTER TABLE "ApiKey" ADD COLUMN "tierId" TEXT;
ALTER TABLE "ModelPool" ADD COLUMN "tierId" TEXT;
ALTER TABLE "ApiRequest" ADD COLUMN "accessTierId" TEXT;
ALTER TABLE "ApiRequest" ADD COLUMN "dedicatedRouteRuleId" TEXT;

UPDATE "User" SET "tierId" = 'tier_standard' WHERE "tierId" IS NULL;
UPDATE "ApiKey" SET "tierId" = 'tier_standard' WHERE "tierId" IS NULL;
UPDATE "ModelPool" SET "tierId" = 'tier_standard' WHERE "tierId" IS NULL;

CREATE TABLE "DedicatedRouteRule" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "targetType" "DedicatedRouteTargetType" NOT NULL,
  "userId" TEXT,
  "apiKeyId" TEXT,
  "ipPattern" TEXT,
  "accessTierId" TEXT NOT NULL,
  "upstreamProvider" TEXT,
  "upstreamProviderKeyId" TEXT,
  "status" "DedicatedRouteRuleStatus" NOT NULL DEFAULT 'ACTIVE',
  "priority" INTEGER NOT NULL DEFAULT 100,
  "remark" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DedicatedRouteRule_pkey" PRIMARY KEY ("id")
);

DROP INDEX IF EXISTS "ModelPool_model_key";

CREATE UNIQUE INDEX "AccessTier_code_key" ON "AccessTier"("code");
CREATE INDEX "AccessTier_status_sortOrder_idx" ON "AccessTier"("status", "sortOrder");
CREATE INDEX "User_tierId_idx" ON "User"("tierId");
CREATE INDEX "ApiKey_tierId_idx" ON "ApiKey"("tierId");
CREATE INDEX "ApiRequest_accessTierId_createdAt_idx" ON "ApiRequest"("accessTierId", "createdAt");
CREATE INDEX "ApiRequest_dedicatedRouteRuleId_createdAt_idx" ON "ApiRequest"("dedicatedRouteRuleId", "createdAt");
CREATE INDEX "ModelPool_tierId_idx" ON "ModelPool"("tierId");
CREATE UNIQUE INDEX "ModelPool_model_tierId_key" ON "ModelPool"("model", "tierId");
CREATE INDEX "DedicatedRouteRule_targetType_status_priority_idx" ON "DedicatedRouteRule"("targetType", "status", "priority");
CREATE INDEX "DedicatedRouteRule_userId_status_priority_idx" ON "DedicatedRouteRule"("userId", "status", "priority");
CREATE INDEX "DedicatedRouteRule_apiKeyId_status_priority_idx" ON "DedicatedRouteRule"("apiKeyId", "status", "priority");
CREATE INDEX "DedicatedRouteRule_ipPattern_status_priority_idx" ON "DedicatedRouteRule"("ipPattern", "status", "priority");
CREATE INDEX "DedicatedRouteRule_accessTierId_idx" ON "DedicatedRouteRule"("accessTierId");
CREATE INDEX "DedicatedRouteRule_upstreamProviderKeyId_idx" ON "DedicatedRouteRule"("upstreamProviderKeyId");

ALTER TABLE "User" ADD CONSTRAINT "User_tierId_fkey" FOREIGN KEY ("tierId") REFERENCES "AccessTier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_tierId_fkey" FOREIGN KEY ("tierId") REFERENCES "AccessTier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ApiRequest" ADD CONSTRAINT "ApiRequest_accessTierId_fkey" FOREIGN KEY ("accessTierId") REFERENCES "AccessTier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ApiRequest" ADD CONSTRAINT "ApiRequest_dedicatedRouteRuleId_fkey" FOREIGN KEY ("dedicatedRouteRuleId") REFERENCES "DedicatedRouteRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ModelPool" ADD CONSTRAINT "ModelPool_tierId_fkey" FOREIGN KEY ("tierId") REFERENCES "AccessTier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DedicatedRouteRule" ADD CONSTRAINT "DedicatedRouteRule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DedicatedRouteRule" ADD CONSTRAINT "DedicatedRouteRule_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DedicatedRouteRule" ADD CONSTRAINT "DedicatedRouteRule_accessTierId_fkey" FOREIGN KEY ("accessTierId") REFERENCES "AccessTier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DedicatedRouteRule" ADD CONSTRAINT "DedicatedRouteRule_upstreamProviderKeyId_fkey" FOREIGN KEY ("upstreamProviderKeyId") REFERENCES "UpstreamProviderKey"("id") ON DELETE SET NULL ON UPDATE CASCADE;
