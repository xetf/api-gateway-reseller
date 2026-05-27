ALTER TABLE "WalletTransaction"
ADD COLUMN "source" TEXT NOT NULL DEFAULT 'UNKNOWN';

UPDATE "WalletTransaction"
SET "source" = CASE
  WHEN "type" = 'CHARGE' THEN 'API_CHARGE'
  WHEN "type" = 'REFUND' THEN 'REFUND'
  WHEN "type" = 'ADJUST' THEN 'ADMIN_ADJUST'
  WHEN "type" = 'RECHARGE' AND "metadata"->>'redeemCodeId' IS NOT NULL THEN 'REDEEM'
  WHEN "type" = 'RECHARGE' THEN 'ADMIN_RECHARGE'
  ELSE 'UNKNOWN'
END;

CREATE INDEX "WalletTransaction_source_createdAt_idx" ON "WalletTransaction"("source", "createdAt");
