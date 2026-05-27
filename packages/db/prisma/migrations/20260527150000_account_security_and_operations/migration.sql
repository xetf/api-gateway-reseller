-- Extend user lifecycle states.
ALTER TYPE "UserStatus" ADD VALUE IF NOT EXISTS 'SUSPENDED';
ALTER TYPE "UserStatus" ADD VALUE IF NOT EXISTS 'TRIAL';
ALTER TYPE "UserStatus" ADD VALUE IF NOT EXISTS 'RISK_REVIEW';

-- User lifecycle and login observability.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "statusReason" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastLoginAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "User_status_idx" ON "User"("status");

CREATE TABLE IF NOT EXISTS "LoginLog" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "email" TEXT,
  "username" TEXT,
  "method" TEXT NOT NULL,
  "success" BOOLEAN NOT NULL,
  "failureReason" TEXT,
  "ip" TEXT,
  "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LoginLog_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "LoginLog" ADD CONSTRAINT "LoginLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "LoginLog_userId_createdAt_idx" ON "LoginLog"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "LoginLog_email_createdAt_idx" ON "LoginLog"("email", "createdAt");
CREATE INDEX IF NOT EXISTS "LoginLog_username_createdAt_idx" ON "LoginLog"("username", "createdAt");
CREATE INDEX IF NOT EXISTS "LoginLog_method_success_createdAt_idx" ON "LoginLog"("method", "success", "createdAt");
CREATE INDEX IF NOT EXISTS "LoginLog_ip_createdAt_idx" ON "LoginLog"("ip", "createdAt");

-- API key operations metadata.
ALTER TABLE "ApiKey" ADD COLUMN IF NOT EXISTS "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "ApiKey" ADD COLUMN IF NOT EXISTS "disabledReason" TEXT;
ALTER TABLE "ApiKey" ADD COLUMN IF NOT EXISTS "disabledAt" TIMESTAMP(3);
ALTER TABLE "ApiKey" ADD COLUMN IF NOT EXISTS "ipWhitelist" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
CREATE INDEX IF NOT EXISTS "ApiKey_status_disabledAt_idx" ON "ApiKey"("status", "disabledAt");

-- Upstream key risk and quota metadata.
ALTER TABLE "UpstreamProviderKey" ADD COLUMN IF NOT EXISTS "dailyLimitUsd" DECIMAL(18,8);
ALTER TABLE "UpstreamProviderKey" ADD COLUMN IF NOT EXISTS "monthlyLimitUsd" DECIMAL(18,8);
ALTER TABLE "UpstreamProviderKey" ADD COLUMN IF NOT EXISTS "providerRateLimit" INTEGER;
ALTER TABLE "UpstreamProviderKey" ADD COLUMN IF NOT EXISTS "disabledReason" TEXT;
ALTER TABLE "UpstreamProviderKey" ADD COLUMN IF NOT EXISTS "lastErrorCategory" TEXT;
CREATE INDEX IF NOT EXISTS "UpstreamProviderKey_lastErrorCategory_idx" ON "UpstreamProviderKey"("lastErrorCategory");

-- Redeem campaign controls.
ALTER TABLE "RedeemCode" ADD COLUMN IF NOT EXISTS "campaignName" TEXT;
ALTER TABLE "RedeemCode" ADD COLUMN IF NOT EXISTS "validUserTierId" TEXT;
ALTER TABLE "RedeemCode" ADD COLUMN IF NOT EXISTS "perUserLimit" INTEGER NOT NULL DEFAULT 1;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'RedeemCode_validUserTierId_fkey'
  ) THEN
    ALTER TABLE "RedeemCode" ADD CONSTRAINT "RedeemCode_validUserTierId_fkey" FOREIGN KEY ("validUserTierId") REFERENCES "AccessTier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "RedeemCode_campaignName_idx" ON "RedeemCode"("campaignName");
CREATE INDEX IF NOT EXISTS "RedeemCode_validUserTierId_idx" ON "RedeemCode"("validUserTierId");

-- Allow per-user campaign limits above one redemption.
DROP INDEX IF EXISTS "RedeemCodeRedemption_redeemCodeId_userId_key";
