-- Align SystemSetting.updatedAt with the Prisma schema after the table exists.
ALTER TABLE "SystemSetting" ALTER COLUMN "updatedAt" DROP DEFAULT;
