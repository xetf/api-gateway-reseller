-- Clean up rows that may have been written by the old API process after the
-- first regular-input-token migration and before the fixed API was restarted.
UPDATE "ApiRequest"
SET "inputTokens" = GREATEST("inputTokens" - "cachedInputTokens", 0)
WHERE "cachedInputTokens" > 0
  AND "inputTokens" + "outputTokens" = "totalTokens";
