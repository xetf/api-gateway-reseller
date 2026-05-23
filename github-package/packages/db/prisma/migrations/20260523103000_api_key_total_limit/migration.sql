ALTER TABLE "ApiKey" ADD COLUMN "totalLimitUsd" DECIMAL(18,8);

UPDATE "ApiKey"
SET "totalLimitUsd" = "dailyLimitUsd"
WHERE "totalLimitUsd" IS NULL
  AND "dailyLimitUsd" IS NOT NULL;
