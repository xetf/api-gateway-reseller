-- AlterTable
ALTER TABLE "User" ADD COLUMN "allowedModels" TEXT[] DEFAULT ARRAY[]::TEXT[];
