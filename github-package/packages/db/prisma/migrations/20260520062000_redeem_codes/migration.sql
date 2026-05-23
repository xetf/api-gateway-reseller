-- CreateEnum
CREATE TYPE "RedeemCodeStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateTable
CREATE TABLE "RedeemCode" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "codePrefix" TEXT NOT NULL,
    "amount" DECIMAL(18,8) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" "RedeemCodeStatus" NOT NULL DEFAULT 'ACTIVE',
    "maxRedemptions" INTEGER NOT NULL DEFAULT 1,
    "redeemedCount" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "remark" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RedeemCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RedeemCodeRedemption" (
    "id" TEXT NOT NULL,
    "redeemCodeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" DECIMAL(18,8) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RedeemCodeRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RedeemCode_codeHash_key" ON "RedeemCode"("codeHash");

-- CreateIndex
CREATE INDEX "RedeemCode_status_createdAt_idx" ON "RedeemCode"("status", "createdAt");

-- CreateIndex
CREATE INDEX "RedeemCode_codePrefix_idx" ON "RedeemCode"("codePrefix");

-- CreateIndex
CREATE UNIQUE INDEX "RedeemCodeRedemption_redeemCodeId_userId_key" ON "RedeemCodeRedemption"("redeemCodeId", "userId");

-- CreateIndex
CREATE INDEX "RedeemCodeRedemption_userId_createdAt_idx" ON "RedeemCodeRedemption"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "RedeemCodeRedemption_redeemCodeId_createdAt_idx" ON "RedeemCodeRedemption"("redeemCodeId", "createdAt");

-- AddForeignKey
ALTER TABLE "RedeemCodeRedemption" ADD CONSTRAINT "RedeemCodeRedemption_redeemCodeId_fkey" FOREIGN KEY ("redeemCodeId") REFERENCES "RedeemCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RedeemCodeRedemption" ADD CONSTRAINT "RedeemCodeRedemption_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
