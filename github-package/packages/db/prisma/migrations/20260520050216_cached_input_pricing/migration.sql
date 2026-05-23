-- AlterTable
ALTER TABLE "ModelPrice" ADD COLUMN     "customerCachedInputPer1MTok" DECIMAL(18,8) NOT NULL DEFAULT 0,
ADD COLUMN     "upstreamCachedInputPer1MTok" DECIMAL(18,8) NOT NULL DEFAULT 0;
