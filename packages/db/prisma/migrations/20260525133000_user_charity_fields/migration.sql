ALTER TABLE "User"
ADD COLUMN "charityEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "charityDisplayName" TEXT;

CREATE INDEX "User_charityEnabled_idx" ON "User"("charityEnabled");
