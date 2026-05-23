-- AlterTable
ALTER TABLE "ModelPrice" ADD COLUMN     "customerPriceMultiplier" DECIMAL(18,8) NOT NULL DEFAULT 1,
ADD COLUMN     "upstreamPriceMultiplier" DECIMAL(18,8) NOT NULL DEFAULT 1;
