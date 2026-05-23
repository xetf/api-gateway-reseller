-- Track time-to-first-token for streaming responses.
ALTER TABLE "ApiRequest" ADD COLUMN "firstTokenLatencyMs" INTEGER;
