ALTER TABLE "Wallet"
ADD COLUMN "reservedBalance" DECIMAL(18, 8) NOT NULL DEFAULT 0;

ALTER TABLE "ApiRequest"
ADD COLUMN "reservedAmountUsd" DECIMAL(18, 8) NOT NULL DEFAULT 0;

CREATE INDEX "ApiRequest_status_reservedAmountUsd_idx" ON "ApiRequest"("status", "reservedAmountUsd");
