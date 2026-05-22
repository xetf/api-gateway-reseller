-- Store non-cached input tokens separately from cached input tokens.
-- Older rows stored total input tokens in "inputTokens"; those rows have
-- totalTokens = inputTokens + outputTokens while cachedInputTokens > 0.
UPDATE "ApiRequest"
SET "inputTokens" = GREATEST("inputTokens" - "cachedInputTokens", 0)
WHERE "cachedInputTokens" > 0
  AND "inputTokens" + "outputTokens" = "totalTokens";
