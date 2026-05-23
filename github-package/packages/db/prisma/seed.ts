import bcrypt from "bcryptjs";
import { prisma } from "../src/index.js";

const adminUsername = process.env.ADMIN_USERNAME ?? "admin";
const adminEmail = process.env.ADMIN_EMAIL ?? "admin@example.com";
const adminPassword = process.env.ADMIN_PASSWORD ?? "change-this-admin-password";
const currency = process.env.DEFAULT_CURRENCY ?? "USD";
const healthCheckIntervalSeconds = process.env.MODEL_POOL_HEALTH_INTERVAL_SECONDS ?? "30";
const penaltySeconds = process.env.MODEL_POOL_PENALTY_SECONDS ?? "60";

async function main() {
  const passwordHash = await bcrypt.hash(adminPassword, 12);

  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      username: adminUsername,
      passwordHash,
      role: "ADMIN",
      status: "ACTIVE",
    },
    create: {
      email: adminEmail,
      username: adminUsername,
      name: "Admin",
      passwordHash,
      role: "ADMIN",
      status: "ACTIVE",
    },
  });

  await prisma.wallet.upsert({
    where: { userId: admin.id },
    update: {
      currency,
    },
    create: {
      userId: admin.id,
      balance: "0.00000000",
      currency,
    },
  });

  await prisma.systemSetting.upsert({
    where: { key: "model_pool_health_interval_seconds" },
    update: {
      value: healthCheckIntervalSeconds,
    },
    create: {
      key: "model_pool_health_interval_seconds",
      value: healthCheckIntervalSeconds,
    },
  });

  await prisma.systemSetting.upsert({
    where: { key: "model_pool_penalty_seconds" },
    update: {
      value: penaltySeconds,
    },
    create: {
      key: "model_pool_penalty_seconds",
      value: penaltySeconds,
    },
  });

  console.log(`Seeded blank deployment admin ${adminUsername}.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
