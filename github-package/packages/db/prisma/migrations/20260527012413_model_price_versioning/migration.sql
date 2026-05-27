ALTER TABLE "ModelPrice"
ADD COLUMN "priceVersion" TEXT NOT NULL DEFAULT 'v1',
ADD COLUMN "effectiveFrom" TIMESTAMP(3),
ADD COLUMN "effectiveTo" TIMESTAMP(3),
ADD COLUMN "createdByUserId" TEXT;

CREATE INDEX "ModelPrice_priceVersion_idx" ON "ModelPrice"("priceVersion");
CREATE INDEX "ModelPrice_effectiveFrom_effectiveTo_idx" ON "ModelPrice"("effectiveFrom", "effectiveTo");
CREATE INDEX "ModelPrice_createdByUserId_idx" ON "ModelPrice"("createdByUserId");

ALTER TABLE "ModelPrice" ADD CONSTRAINT "ModelPrice_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
