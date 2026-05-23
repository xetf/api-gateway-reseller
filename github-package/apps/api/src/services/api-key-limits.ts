import { Decimal } from "decimal.js";
import { prisma, type ApiKey } from "@gateway/db";

export async function disableExpiredOrOverLimitApiKeys(userId?: string) {
  const now = new Date();

  await prisma.apiKey.updateMany({
    where: {
      ...(userId ? { userId } : {}),
      status: "ACTIVE",
      expiresAt: {
        lte: now,
      },
    },
    data: {
      status: "DISABLED",
    },
  });

  const limitedKeys = await prisma.apiKey.findMany({
    where: {
      ...(userId ? { userId } : {}),
      status: "ACTIVE",
      totalLimitUsd: {
        not: null,
        gt: 0,
      },
    },
    select: {
      id: true,
      totalLimitUsd: true,
    },
  });

  for (const apiKey of limitedKeys) {
    if (await isApiKeyTotalLimitReached(apiKey.id, apiKey.totalLimitUsd?.toString())) {
      await prisma.apiKey.update({
        where: { id: apiKey.id },
        data: { status: "DISABLED" },
      });
    }
  }
}

export async function disableApiKeyIfTotalLimitReached(
  apiKey: Pick<ApiKey, "id" | "totalLimitUsd" | "status">,
) {
  if (apiKey.status !== "ACTIVE") {
    return false;
  }

  const reached = await isApiKeyTotalLimitReached(apiKey.id, apiKey.totalLimitUsd?.toString());
  if (!reached) {
    return false;
  }

  await prisma.apiKey.update({
    where: { id: apiKey.id },
    data: { status: "DISABLED" },
  });

  return true;
}

export async function isApiKeyTotalLimitReached(apiKeyId: string, totalLimitUsd?: string | null) {
  if (!totalLimitUsd || new Decimal(totalLimitUsd).lte(0)) {
    return false;
  }

  const usedUsd = await getApiKeyTotalUsageUsd(apiKeyId);
  return usedUsd.gte(totalLimitUsd);
}

export async function getApiKeyTotalUsageUsd(apiKeyId: string) {
  const usage = await prisma.apiRequest.aggregate({
    where: {
      apiKeyId,
      status: "SUCCESS",
    },
    _sum: {
      chargedAmountUsd: true,
    },
  });

  return new Decimal(usage._sum.chargedAmountUsd?.toString() ?? "0");
}
