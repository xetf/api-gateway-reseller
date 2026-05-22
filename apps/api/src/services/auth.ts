import bcrypt from "bcryptjs";
import { Decimal } from "decimal.js";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "@gateway/db";
import { hashSecret } from "../lib/crypto.js";
import { sendApiError } from "../lib/errors.js";
import type { ApiRequestWithUser } from "../types.js";

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export async function requireUser(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
  } catch {
    return reply.status(401).send({ message: "Unauthorized" });
  }
}

export function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
  done: (error?: Error) => void,
) {
  const user = request.user as { role?: string } | undefined;

  if (!user || user.role !== "ADMIN") {
    reply.status(403).send({ message: "Admin permission required" });
    return;
  }

  done();
}

export async function requireApiKey(
  app: FastifyInstance,
  request: ApiRequestWithUser,
  reply: FastifyReply,
) {
  const authorization = request.headers.authorization;
  const token = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : undefined;

  if (!token) {
    return sendApiError(reply, 401, "Missing API key", "authentication_error");
  }

  const apiKey = await prisma.apiKey.findUnique({
    where: { keyHash: hashSecret(token) },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          role: true,
          status: true,
          allowedModels: true,
        },
      },
    },
  });

  if (!apiKey || apiKey.status !== "ACTIVE" || apiKey.user.status !== "ACTIVE") {
    return sendApiError(reply, 401, "Invalid API key", "authentication_error");
  }

  if (apiKey.expiresAt && apiKey.expiresAt <= new Date()) {
    await prisma.apiKey.update({
      where: { id: apiKey.id },
      data: { status: "DISABLED" },
    });
    return sendApiError(reply, 401, "API key expired and has been disabled", "authentication_error");
  }

  const rateLimitKey = `ratelimit:${apiKey.id}:${Math.floor(Date.now() / 60000)}`;
  const count = await app.redis.incr(rateLimitKey);
  if (count === 1) {
    await app.redis.expire(rateLimitKey, 70);
  }

  if (count > apiKey.rateLimitPerMinute) {
    return sendApiError(reply, 429, "Rate limit exceeded", "rate_limit_error");
  }

  if (apiKey.totalLimitUsd && new Decimal(apiKey.totalLimitUsd.toString()).gt(0)) {
    const usage = await prisma.apiRequest.aggregate({
      where: {
        apiKeyId: apiKey.id,
        status: "SUCCESS",
      },
      _sum: {
        chargedAmountUsd: true,
      },
    });
    const usedUsd = new Decimal(usage._sum.chargedAmountUsd?.toString() ?? "0");
    if (usedUsd.gte(apiKey.totalLimitUsd.toString())) {
      await prisma.apiKey.update({
        where: { id: apiKey.id },
        data: { status: "DISABLED" },
      });
      return sendApiError(reply, 429, "API key total quota exceeded and has been disabled", "insufficient_quota");
    }
  }

  await prisma.apiKey.update({
    where: { id: apiKey.id },
    data: { lastUsedAt: new Date() },
  });

  request.apiAuth = {
    apiKey,
    user: apiKey.user,
  };
}
