ALTER TABLE "UpstreamProviderKey"
ADD COLUMN "encryptedKey" TEXT,
ADD COLUMN "encryptionKeyVersion" TEXT;

CREATE INDEX "UpstreamProviderKey_encryptionKeyVersion_idx" ON "UpstreamProviderKey"("encryptionKeyVersion");
