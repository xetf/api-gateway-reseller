-- Add cached input accounting to persisted request rows.
ALTER TABLE "ApiRequest" ADD COLUMN "cachedInputTokens" INTEGER NOT NULL DEFAULT 0;

-- Model prices are now scoped by upstream provider and model.
DROP INDEX IF EXISTS "ModelPrice_model_key";

CREATE UNIQUE INDEX "ModelPrice_upstreamProvider_model_key" ON "ModelPrice"("upstreamProvider", "model");
CREATE INDEX "ModelPrice_upstreamProvider_enabled_idx" ON "ModelPrice"("upstreamProvider", "enabled");

-- Existing installs used a single global price table. Copy those prices to
-- every configured upstream so switching providers does not make models vanish.
INSERT INTO "ModelPrice" (
  "id",
  "model",
  "upstreamProvider",
  "currency",
  "upstreamInputPer1MTok",
  "upstreamOutputPer1MTok",
  "upstreamCachedInputPer1MTok",
  "upstreamPriceMultiplier",
  "customerInputPer1MTok",
  "customerOutputPer1MTok",
  "customerCachedInputPer1MTok",
  "customerPriceMultiplier",
  "minimumChargeUsd",
  "enabled",
  "createdAt",
  "updatedAt"
)
SELECT
  md5(random()::text || clock_timestamp()::text || mp."id" || up."id"),
  mp."model",
  up."name",
  mp."currency",
  mp."upstreamInputPer1MTok",
  mp."upstreamOutputPer1MTok",
  mp."upstreamCachedInputPer1MTok",
  mp."upstreamPriceMultiplier",
  mp."customerInputPer1MTok",
  mp."customerOutputPer1MTok",
  mp."customerCachedInputPer1MTok",
  mp."customerPriceMultiplier",
  mp."minimumChargeUsd",
  mp."enabled",
  NOW(),
  NOW()
FROM "ModelPrice" mp
JOIN "UpstreamProvider" up ON up."name" <> mp."upstreamProvider"
ON CONFLICT ("upstreamProvider", "model") DO NOTHING;
