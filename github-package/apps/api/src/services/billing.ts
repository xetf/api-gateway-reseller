import { Decimal } from "decimal.js";
import { performance } from "node:perf_hooks";
import { prisma, type ApiRequest, type ModelPrice } from "@gateway/db";
import { calculateCharges } from "../lib/money.js";
import { applyUnifiedCustomerPricing } from "./unified-pricing.js";
import type { Usage } from "../types.js";

export async function ensureWalletCanStart(userId: string) {
  const wallet = await prisma.wallet.findUnique({
    where: { userId },
  });

  if (!wallet) {
    return { ok: false as const, reason: "Wallet not found" };
  }

  const balance = new Decimal(wallet.balance.toString());

  if (balance.lte(0)) {
    return { ok: false as const, reason: "Insufficient balance" };
  }

  return { ok: true as const, balance };
}

export async function chargeForRequest(params: {
  requestId: string;
  userId: string;
  price: ModelPrice;
  usage: Usage;
  startedAt?: number;
}) {
  const { requestId, userId, price, usage, startedAt } = params;
  const chargePrice = await applyUnifiedCustomerPricing(price);
  const { upstreamCostUsd, chargedAmountUsd } = calculateCharges(chargePrice, usage);

  return prisma.$transaction(async (tx) => {
    const wallet = await tx.wallet.findUnique({
      where: { userId },
    });

    if (!wallet) {
      throw new Error("Wallet not found");
    }

    const balanceBefore = new Decimal(wallet.balance.toString());
    const balanceAfter = balanceBefore.minus(chargedAmountUsd);

    if (balanceAfter.lt(0)) {
      throw new Error("Insufficient balance after usage calculation");
    }

    await tx.wallet.update({
      where: { userId },
      data: {
        balance: balanceAfter.toFixed(8),
      },
    });

    await tx.walletTransaction.create({
      data: {
        userId,
        requestId,
        type: "CHARGE",
        amount: chargedAmountUsd.negated().toFixed(8),
        balanceBefore: balanceBefore.toFixed(8),
        balanceAfter: balanceAfter.toFixed(8),
        remark: `API usage ${price.model}`,
        metadata: {
          inputTokens: usage.inputTokens,
          cachedInputTokens: usage.cachedInputTokens,
          totalInputTokens: usage.inputTokens + usage.cachedInputTokens,
          outputTokens: usage.outputTokens,
          totalTokens: usage.totalTokens,
          upstreamCostUsd: upstreamCostUsd.toFixed(8),
          chargedAmountUsd: chargedAmountUsd.toFixed(8),
        },
      },
    });

    const apiRequest = await tx.apiRequest.update({
      where: { id: requestId },
      data: {
        status: "SUCCESS",
        inputTokens: usage.inputTokens,
        cachedInputTokens: usage.cachedInputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
        latencyMs: startedAt === undefined ? undefined : Math.round(performance.now() - startedAt),
        upstreamCostUsd: upstreamCostUsd.toFixed(8),
        chargedAmountUsd: chargedAmountUsd.toFixed(8),
        responseUsage: usage.raw === undefined ? undefined : (usage.raw as object),
      },
    });

    if (apiRequest.apiKeyId) {
      const apiKey = await tx.apiKey.findUnique({
        where: { id: apiRequest.apiKeyId },
        select: {
          id: true,
          totalLimitUsd: true,
          status: true,
        },
      });

      if (apiKey?.status === "ACTIVE" && apiKey.totalLimitUsd) {
        const limit = new Decimal(apiKey.totalLimitUsd.toString());
        if (limit.gt(0)) {
          const usage = await tx.apiRequest.aggregate({
            where: {
              apiKeyId: apiKey.id,
              status: "SUCCESS",
            },
            _sum: {
              chargedAmountUsd: true,
            },
          });
          const usedUsd = new Decimal(usage._sum.chargedAmountUsd?.toString() ?? "0");
          if (usedUsd.gte(limit)) {
            await tx.apiKey.update({
              where: { id: apiKey.id },
              data: { status: "DISABLED" },
            });
          }
        }
      }
    }

    return apiRequest;
  });
}

export async function markRequestFailed(
  request: Pick<ApiRequest, "id">,
  errorMessage: string,
  httpStatus?: number,
  latencyMs?: number,
) {
  await prisma.apiRequest.update({
    where: { id: request.id },
    data: {
      status: "FAILED",
      errorMessage,
      httpStatus,
      latencyMs,
    },
  });
}
