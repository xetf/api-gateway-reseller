import type { FastifyInstance } from "fastify";
import { Decimal } from "decimal.js";
import { prisma } from "@gateway/db";
import { z } from "zod";
import { requireAdmin, requireUser } from "../services/auth.js";

export async function walletRoutes(app: FastifyInstance) {
  app.get("/wallet", { preHandler: requireUser }, async (request) => {
    const user = request.user as { sub: string };
    const wallet = await prisma.wallet.findUnique({
      where: { userId: user.sub },
      select: {
        id: true,
        balance: true,
        reservedBalance: true,
        currency: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    const transactions = await prisma.walletTransaction.findMany({
      where: { userId: user.sub },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        type: true,
        amount: true,
        balanceBefore: true,
        balanceAfter: true,
        remark: true,
        createdAt: true,
      },
    });

    return { wallet, transactions };
  });

  app.post(
    "/wallet/recharge",
    { preHandler: [requireUser, requireAdmin] },
    async (request) => {
      const body = z
        .object({
          userId: z.string(),
          amount: z.string().or(z.number()).transform(String),
          remark: z.string().optional(),
        })
        .parse(request.body);

      const amount = new Decimal(body.amount);

      if (!amount.isFinite() || amount.lte(0)) {
        return { ok: false, message: "Amount must be positive" };
      }

      const result = await prisma.$transaction(async (tx) => {
        const wallet = await tx.wallet.upsert({
          where: { userId: body.userId },
          update: {},
          create: {
            userId: body.userId,
            balance: "0",
          },
        });
        const balanceBefore = new Decimal(wallet.balance.toString());
        const balanceAfter = balanceBefore.plus(amount);

        const updatedWallet = await tx.wallet.update({
          where: { userId: body.userId },
          data: { balance: balanceAfter.toFixed(8) },
        });

        const transaction = await tx.walletTransaction.create({
          data: {
            userId: body.userId,
            type: "RECHARGE",
            source: "ADMIN_RECHARGE",
            amount: amount.toFixed(8),
            balanceBefore: balanceBefore.toFixed(8),
            balanceAfter: balanceAfter.toFixed(8),
            remark: body.remark ?? "Manual recharge",
          },
        });

        return { wallet: updatedWallet, transaction };
      });

      return result;
    },
  );
}
