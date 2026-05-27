CREATE TABLE "IpAccessTierRule" (
    "id" TEXT NOT NULL,
    "cidrOrIp" TEXT NOT NULL,
    "tierId" TEXT NOT NULL,
    "status" "DedicatedRouteRuleStatus" NOT NULL DEFAULT 'ACTIVE',
    "priority" INTEGER NOT NULL DEFAULT 100,
    "remark" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IpAccessTierRule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IpAccessTierRule_cidrOrIp_key" ON "IpAccessTierRule"("cidrOrIp");
CREATE INDEX "IpAccessTierRule_status_priority_idx" ON "IpAccessTierRule"("status", "priority");
CREATE INDEX "IpAccessTierRule_tierId_idx" ON "IpAccessTierRule"("tierId");

ALTER TABLE "IpAccessTierRule" ADD CONSTRAINT "IpAccessTierRule_tierId_fkey" FOREIGN KEY ("tierId") REFERENCES "AccessTier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
