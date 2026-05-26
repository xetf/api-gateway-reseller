ALTER TABLE "UpstreamProvider"
ADD COLUMN "compactItemType" TEXT NOT NULL DEFAULT 'compaction_summary';

UPDATE "UpstreamProvider"
SET "compactItemType" = 'compaction'
WHERE "baseUrl" IN ('https://api.proxy-ai.tech', 'https://superapi.buzz');
