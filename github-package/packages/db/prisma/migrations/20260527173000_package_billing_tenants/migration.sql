CREATE TYPE "TenantStatus" AS ENUM ('ACTIVE', 'DISABLED');
CREATE TYPE "PackageTemplateStatus" AS ENUM ('ACTIVE', 'DISABLED');
CREATE TYPE "BillingAccountStatus" AS ENUM ('ACTIVE', 'SUSPENDED');
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PAID', 'VOID');

CREATE TABLE "Tenant" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "status" "TenantStatus" NOT NULL DEFAULT 'ACTIVE',
  "reseller" BOOLEAN NOT NULL DEFAULT false,
  "contactEmail" TEXT,
  "remark" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Tenant_code_key" ON "Tenant"("code");
CREATE INDEX "Tenant_status_reseller_idx" ON "Tenant"("status", "reseller");

CREATE TABLE "PackageTemplate" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "status" "PackageTemplateStatus" NOT NULL DEFAULT 'ACTIVE',
  "tierId" TEXT,
  "allowedModels" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "rateLimitPerMinute" INTEGER NOT NULL DEFAULT 0,
  "concurrencyLimit" INTEGER NOT NULL DEFAULT 0,
  "initialBalanceUsd" DECIMAL(18,8) NOT NULL DEFAULT 0,
  "monthlyCreditLimitUsd" DECIMAL(18,8) NOT NULL DEFAULT 0,
  "remark" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PackageTemplate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PackageTemplate_code_key" ON "PackageTemplate"("code");
CREATE INDEX "PackageTemplate_status_idx" ON "PackageTemplate"("status");
CREATE INDEX "PackageTemplate_tierId_idx" ON "PackageTemplate"("tierId");

CREATE TABLE "BillingAccount" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "status" "BillingAccountStatus" NOT NULL DEFAULT 'ACTIVE',
  "monthlySettlement" BOOLEAN NOT NULL DEFAULT false,
  "creditLimitUsd" DECIMAL(18,8) NOT NULL DEFAULT 0,
  "creditUsedUsd" DECIMAL(18,8) NOT NULL DEFAULT 0,
  "billingDay" INTEGER NOT NULL DEFAULT 1,
  "invoiceTitle" TEXT,
  "taxNumber" TEXT,
  "billingEmail" TEXT,
  "remark" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BillingAccount_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BillingAccount_userId_key" ON "BillingAccount"("userId");
CREATE INDEX "BillingAccount_status_monthlySettlement_idx" ON "BillingAccount"("status", "monthlySettlement");

CREATE TABLE "Invoice" (
  "id" TEXT NOT NULL,
  "billingAccountId" TEXT NOT NULL,
  "invoiceNo" TEXT NOT NULL,
  "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
  "amountUsd" DECIMAL(18,8) NOT NULL,
  "periodStart" TIMESTAMP(3),
  "periodEnd" TIMESTAMP(3),
  "issuedAt" TIMESTAMP(3),
  "paidAt" TIMESTAMP(3),
  "title" TEXT,
  "taxNumber" TEXT,
  "remark" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Invoice_invoiceNo_key" ON "Invoice"("invoiceNo");
CREATE INDEX "Invoice_billingAccountId_createdAt_idx" ON "Invoice"("billingAccountId", "createdAt");
CREATE INDEX "Invoice_status_createdAt_idx" ON "Invoice"("status", "createdAt");

ALTER TABLE "User" ADD COLUMN "tenantId" TEXT;
ALTER TABLE "User" ADD COLUMN "packageTemplateId" TEXT;
CREATE INDEX "User_tenantId_idx" ON "User"("tenantId");
CREATE INDEX "User_packageTemplateId_idx" ON "User"("packageTemplateId");

ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "User" ADD CONSTRAINT "User_packageTemplateId_fkey" FOREIGN KEY ("packageTemplateId") REFERENCES "PackageTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PackageTemplate" ADD CONSTRAINT "PackageTemplate_tierId_fkey" FOREIGN KEY ("tierId") REFERENCES "AccessTier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BillingAccount" ADD CONSTRAINT "BillingAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_billingAccountId_fkey" FOREIGN KEY ("billingAccountId") REFERENCES "BillingAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
