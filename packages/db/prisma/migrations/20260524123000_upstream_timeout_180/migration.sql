ALTER TABLE "UpstreamProvider" ALTER COLUMN "timeoutMs" SET DEFAULT 180000;

UPDATE "UpstreamProvider"
SET "timeoutMs" = 180000
WHERE "timeoutMs" = 120000;
