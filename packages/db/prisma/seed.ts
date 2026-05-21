import bcrypt from "bcryptjs";
import { prisma } from "../src/index.js";

const adminUsername = process.env.ADMIN_USERNAME ?? "admin";
const adminEmail = process.env.ADMIN_EMAIL ?? "admin@example.com";
const adminPassword = process.env.ADMIN_PASSWORD ?? "ayh20080407";
const currency = process.env.DEFAULT_CURRENCY ?? "USD";

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
    update: {},
    create: {
      userId: admin.id,
      balance: "100.00000000",
      currency,
    },
  });

  await prisma.upstreamProvider.upsert({
    where: { name: "default" },
    update: {
      baseUrl: process.env.UPSTREAM_BASE_URL ?? "https://api.openai.com",
      apiKey: process.env.UPSTREAM_API_KEY ?? "sk-upstream-key",
      timeoutMs: Number(process.env.UPSTREAM_TIMEOUT_MS ?? 120000),
      status: "ACTIVE",
    },
    create: {
      name: "default",
      baseUrl: process.env.UPSTREAM_BASE_URL ?? "https://api.openai.com",
      apiKey: process.env.UPSTREAM_API_KEY ?? "sk-upstream-key",
      timeoutMs: Number(process.env.UPSTREAM_TIMEOUT_MS ?? 120000),
      status: "ACTIVE",
    },
  });

  const prices = [
    {
      model: "gpt-4o-mini",
      upstreamInputPer1MTok: "0.15000000",
      upstreamOutputPer1MTok: "0.60000000",
      customerInputPer1MTok: "0.30000000",
      customerOutputPer1MTok: "1.20000000",
    },
    {
      model: "gpt-4o",
      upstreamInputPer1MTok: "2.50000000",
      upstreamOutputPer1MTok: "10.00000000",
      customerInputPer1MTok: "3.50000000",
      customerOutputPer1MTok: "14.00000000",
    },
    {
      model: "text-embedding-3-small",
      upstreamInputPer1MTok: "0.02000000",
      upstreamOutputPer1MTok: "0.00000000",
      customerInputPer1MTok: "0.05000000",
      customerOutputPer1MTok: "0.00000000",
    },
  ];

  for (const price of prices) {
    await prisma.modelPrice.upsert({
      where: { model: price.model },
      update: {
        ...price,
        currency,
        upstreamProvider: "default",
        enabled: true,
      },
      create: {
        ...price,
        currency,
        upstreamProvider: "default",
        enabled: true,
      },
    });
  }

  console.log(`Seeded admin ${adminUsername} with wallet balance.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
