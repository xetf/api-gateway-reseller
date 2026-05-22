-- Create model pools from existing model prices.
CREATE TABLE "ModelPool" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "model" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "ModelPool_model_key" ON "ModelPool"("model");
CREATE INDEX "ModelPool_status_idx" ON "ModelPool"("status");

CREATE TABLE "ModelPoolChannel" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "modelPoolId" TEXT NOT NULL,
  "upstreamProvider" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "priority" INTEGER NOT NULL DEFAULT 100,
  "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
  "lastCheckStatus" TEXT,
  "lastCheckedAt" TIMESTAMP(3),
  "lastLatencyMs" INTEGER,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ModelPoolChannel_modelPoolId_fkey" FOREIGN KEY ("modelPoolId") REFERENCES "ModelPool" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ModelPoolChannel_modelPoolId_upstreamProvider_key" ON "ModelPoolChannel"("modelPoolId", "upstreamProvider");
CREATE INDEX "ModelPoolChannel_upstreamProvider_status_idx" ON "ModelPoolChannel"("upstreamProvider", "status");
CREATE INDEX "ModelPoolChannel_status_priority_idx" ON "ModelPoolChannel"("status", "priority");

INSERT INTO "ModelPool" ("id", "model", "status", "createdAt", "updatedAt")
SELECT
  'mp_' || md5("model"),
  "model",
  'ACTIVE',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM (
  SELECT DISTINCT "model"
  FROM "ModelPrice"
) models;

INSERT INTO "ModelPoolChannel" ("id", "modelPoolId", "upstreamProvider", "status", "priority", "consecutiveFailures", "createdAt", "updatedAt")
SELECT
  'mpc_' || md5(price."upstreamProvider" || ':' || price."model"),
  mpool."id",
  price."upstreamProvider",
  CASE WHEN price."enabled" THEN 'ACTIVE' ELSE 'DISABLED' END,
  100,
  0,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "ModelPrice" price
JOIN "ModelPool" mpool ON mpool."model" = price."model";
