ALTER TABLE "ModelPool" ADD COLUMN "autoHealthCheckEnabled" BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX "ModelPool_autoHealthCheckEnabled_idx" ON "ModelPool"("autoHealthCheckEnabled");
