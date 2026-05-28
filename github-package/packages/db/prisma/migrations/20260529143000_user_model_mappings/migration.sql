CREATE TABLE "UserModelMapping" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "fromModel" TEXT NOT NULL,
  "toModel" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "UserModelMapping_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserModelMapping_userId_fromModel_key" ON "UserModelMapping"("userId", "fromModel");
CREATE INDEX "UserModelMapping_userId_idx" ON "UserModelMapping"("userId");

ALTER TABLE "UserModelMapping"
  ADD CONSTRAINT "UserModelMapping_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
