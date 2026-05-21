import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { Decimal } from "decimal.js";
import { prisma } from "@gateway/db";
import { z } from "zod";
import { hashSecret } from "../lib/crypto.js";
import { requireUser } from "../services/auth.js";

export async function redeemCodeRoutes(app: FastifyInstance) {
  app.post("/redeem-codes/redeem", { preHandler: requireUser }, async (request, reply) => {
    const user = request.user as { sub: string };
    const body = z
      .object({
        code: z.string().min(8).max(160),
      })
      .parse(request.body);
    const codeHash = hashSecret(body.code.trim());

    try {
      const result = await prisma.$transaction(
        async (tx) => {
          const redeemCode = await tx.redeemCode.findUnique({
            where: { codeHash },
          });

          if (!redeemCode) {
            throw new RedeemError("兑换码无效。");
          }

          if (redeemCode.status !== "ACTIVE") {
            throw new RedeemError("兑换码已停用。");
          }

          if (redeemCode.expiresAt && redeemCode.expiresAt < new Date()) {
            throw new RedeemError("兑换码已过期。");
          }

          if (redeemCode.redeemedCount >= redeemCode.maxRedemptions) {
            throw new RedeemError("兑换码已被使用完。");
          }

          const amount = new Decimal(redeemCode.amount.toString());
          if (!amount.isFinite() || amount.lte(0)) {
            throw new RedeemError("兑换码金额异常，请联系管理员。");
          }

          const wallet = await tx.wallet.upsert({
            where: { userId: user.sub },
            update: {},
            create: {
              userId: user.sub,
              balance: "0",
              currency: redeemCode.currency,
            },
          });
          const balanceBefore = new Decimal(wallet.balance.toString());
          const balanceAfter = balanceBefore.plus(amount);

          const updatedWallet = await tx.wallet.update({
            where: { userId: user.sub },
            data: {
              balance: balanceAfter.toFixed(8),
              currency: redeemCode.currency,
            },
          });

          await tx.redeemCode.update({
            where: { id: redeemCode.id },
            data: {
              redeemedCount: {
                increment: 1,
              },
            },
          });

          await tx.redeemCodeRedemption.create({
            data: {
              redeemCodeId: redeemCode.id,
              userId: user.sub,
              amount: amount.toFixed(8),
            },
          });

          const transaction = await tx.walletTransaction.create({
            data: {
              userId: user.sub,
              type: "RECHARGE",
              amount: amount.toFixed(8),
              balanceBefore: balanceBefore.toFixed(8),
              balanceAfter: balanceAfter.toFixed(8),
              remark: `Redeem code ${redeemCode.codePrefix}`,
              metadata: {
                redeemCodeId: redeemCode.id,
                codePrefix: redeemCode.codePrefix,
              },
            },
          });

          return {
            wallet: updatedWallet,
            transaction,
            redeemed: {
              amount: amount.toFixed(8),
              currency: redeemCode.currency,
              codePrefix: redeemCode.codePrefix,
            },
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        },
      );

      return result;
    } catch (error) {
      if (error instanceof RedeemError) {
        return reply.status(400).send({ message: error.message });
      }

      if (isUniqueConstraintError(error)) {
        return reply.status(400).send({ message: "你已经兑换过这个兑换码。" });
      }

      throw error;
    }
  });
}

class RedeemError extends Error {}

function isUniqueConstraintError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}
