ALTER TABLE "ModelPoolChannel" ADD COLUMN "lastSuccessfulCallAt" TIMESTAMP(3);

CREATE INDEX "ModelPoolChannel_lastSuccessfulCallAt_idx" ON "ModelPoolChannel"("lastSuccessfulCallAt");
