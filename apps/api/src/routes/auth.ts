import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { Decimal } from "decimal.js";
import { randomBytes, randomInt } from "node:crypto";
import { prisma } from "@gateway/db";
import { z } from "zod";
import { hashSecret } from "../lib/crypto.js";
import {
  isSmtpConfigured,
  readAuthSettings,
  toPublicAuthSettings,
} from "../services/auth-settings.js";
import { hashPassword, requireUser, verifyPassword } from "../services/auth.js";
import { sendEmailLoginCode } from "../services/mailer.js";

const loginSchema = z.object({
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  password: z.string().min(1),
});

const registerSchema = z.object({
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  name: z
    .string()
    .trim()
    .max(120)
    .optional()
    .transform((value) => value || undefined),
  password: z.string().min(8),
});

const emailCodeSchema = z.object({
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
});

const emailCodeLoginSchema = emailCodeSchema.extend({
  code: z.string().trim().regex(/^\d{6}$/),
  name: z
    .string()
    .trim()
    .max(120)
    .optional()
    .transform((value) => value || undefined),
});

const adminLoginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export async function authRoutes(app: FastifyInstance) {
  app.get("/auth/settings", async () => {
    const settings = await readAuthSettings();
    return { settings: toPublicAuthSettings(settings) };
  });

  app.post("/auth/register", async (request, reply) => {
    const body = registerSchema.parse(request.body);
    const passwordHash = await hashPassword(body.password);
    const settings = await readAuthSettings();
    const newUserBonus = new Decimal(settings.newUserBonusUsd);

    try {
      const user = await prisma.$transaction(async (tx) => {
        return createPublicUser(tx, {
          email: body.email,
          name: body.name,
          passwordHash,
          newUserBonus,
        });
      });

      return authResponse(app, user);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return reply.status(409).send({ message: "Email already exists" });
      }

      throw error;
    }
  });

  app.post("/auth/email-code/send", async (request, reply) => {
    const body = emailCodeSchema.parse(request.body);
    const settings = await readAuthSettings();

    if (!settings.emailCodeLoginEnabled) {
      return reply.status(403).send({ message: "Email code login is disabled" });
    }

    if (!isSmtpConfigured(settings)) {
      return reply.status(503).send({ message: "SMTP is not configured" });
    }

    const cooldownKey = emailCodeCooldownKey(body.email);
    const cooldownSet = await app.redis.set(cooldownKey, "1", "EX", settings.emailCodeCooldownSeconds, "NX");
    if (!cooldownSet) {
      return reply.status(429).send({ message: "验证码发送太频繁，请稍后再试。" });
    }

    const code = String(randomInt(100000, 1000000));
    const ttlSeconds = settings.emailCodeTtlSeconds;
    const ttlMinutes = Math.max(1, Math.ceil(ttlSeconds / 60));

    await app.redis.set(emailCodeKey(body.email), hashEmailCode(body.email, code), "EX", ttlSeconds);
    await app.redis.del(emailCodeAttemptsKey(body.email));

    try {
      await sendEmailLoginCode(settings, {
        to: body.email,
        code,
        ttlMinutes,
      });
    } catch (error) {
      await app.redis.del(emailCodeKey(body.email), cooldownKey);
      app.log.error({ error, email: body.email }, "Failed to send email login code");
      return reply.status(502).send({ message: "验证码邮件发送失败，请检查 SMTP 设置。" });
    }

    return {
      ok: true,
      expiresInSeconds: ttlSeconds,
      cooldownSeconds: settings.emailCodeCooldownSeconds,
    };
  });

  app.post("/auth/email-code/login", async (request, reply) => {
    const body = emailCodeLoginSchema.parse(request.body);
    const settings = await readAuthSettings();

    if (!settings.emailCodeLoginEnabled) {
      return reply.status(403).send({ message: "Email code login is disabled" });
    }

    const attemptsKey = emailCodeAttemptsKey(body.email);
    const attempts = await app.redis.incr(attemptsKey);
    if (attempts === 1) {
      await app.redis.expire(attemptsKey, settings.emailCodeTtlSeconds);
    }

    if (attempts > 5) {
      return reply.status(429).send({ message: "验证码尝试次数过多，请重新获取。" });
    }

    const storedHash = await app.redis.get(emailCodeKey(body.email));
    if (!storedHash || storedHash !== hashEmailCode(body.email, body.code)) {
      return reply.status(400).send({ message: "验证码无效或已过期。" });
    }

    let user = await prisma.user.findUnique({
      where: { email: body.email },
    });

    if (user && user.status !== "ACTIVE") {
      return reply.status(401).send({ message: "User is disabled" });
    }

    if (!user) {
      if (!settings.emailCodeAutoRegisterEnabled) {
        return reply.status(404).send({ message: "账号不存在，请先注册。" });
      }

      const passwordHash = await hashPassword(randomBytes(32).toString("base64url"));
      const newUserBonus = new Decimal(settings.newUserBonusUsd);

      try {
        user = await prisma.$transaction(async (tx) => {
          return createPublicUser(tx, {
            email: body.email,
            name: body.name,
            passwordHash,
            newUserBonus,
          });
        });
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          user = await prisma.user.findUniqueOrThrow({
            where: { email: body.email },
          });
        } else {
          throw error;
        }
      }
    }

    await app.redis.del(emailCodeKey(body.email), attemptsKey, emailCodeCooldownKey(body.email));
    return authResponse(app, user);
  });

  app.post("/auth/login", async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const user = await prisma.user.findUnique({
      where: { email: body.email },
    });

    if (!user || user.status !== "ACTIVE") {
      return reply.status(401).send({ message: "Invalid email or password" });
    }

    const valid = await verifyPassword(body.password, user.passwordHash);

    if (!valid) {
      return reply.status(401).send({ message: "Invalid email or password" });
    }

    return authResponse(app, user);
  });

  app.post("/auth/admin-login", async (request, reply) => {
    const body = adminLoginSchema.parse(request.body);
    const user = await prisma.user.findUnique({
      where: { username: body.username },
    });

    if (!user || user.role !== "ADMIN" || user.status !== "ACTIVE") {
      return reply.status(401).send({ message: "Invalid username or password" });
    }

    const valid = await verifyPassword(body.password, user.passwordHash);

    if (!valid) {
      return reply.status(401).send({ message: "Invalid username or password" });
    }

    return authResponse(app, user);
  });

  app.get("/auth/me", { preHandler: requireUser }, async (request) => {
    const jwtUser = request.user as { sub: string };
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: jwtUser.sub },
      select: {
        id: true,
        email: true,
        username: true,
        name: true,
        role: true,
        status: true,
        allowedModels: true,
        wallet: true,
      },
    });

    return { user };
  });
}

function isUniqueConstraintError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

type PublicUser = {
  id: string;
  email: string;
  username: string | null;
  name: string | null;
  role: string;
  allowedModels: string[];
};

function authResponse(app: FastifyInstance, user: PublicUser) {
  const token = app.jwt.sign({
    sub: user.id,
    email: user.email,
    role: user.role,
  });

  return {
    token,
    user: serializeAuthUser(user),
  };
}

function serializeAuthUser(user: PublicUser) {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    name: user.name,
    role: user.role,
    allowedModels: user.allowedModels,
  };
}

async function createPublicUser(
  tx: Prisma.TransactionClient,
  input: {
    email: string;
    name?: string;
    passwordHash: string;
    newUserBonus: Decimal;
  },
) {
  const bonus = input.newUserBonus.isFinite() && input.newUserBonus.gt(0)
    ? input.newUserBonus
    : new Decimal(0);
  const created = await tx.user.create({
    data: {
      email: input.email,
      name: input.name,
      passwordHash: input.passwordHash,
      role: "USER",
      status: "ACTIVE",
      wallet: {
        create: {
          balance: bonus.toFixed(8),
        },
      },
    },
  });

  if (bonus.gt(0)) {
    await tx.walletTransaction.create({
      data: {
        userId: created.id,
        type: "RECHARGE",
        amount: bonus.toFixed(8),
        balanceBefore: "0",
        balanceAfter: bonus.toFixed(8),
        remark: "New user bonus",
      },
    });
  }

  return created;
}

function emailCodeKey(email: string) {
  return `auth:email-code:${email}`;
}

function emailCodeCooldownKey(email: string) {
  return `auth:email-code-cooldown:${email}`;
}

function emailCodeAttemptsKey(email: string) {
  return `auth:email-code-attempts:${email}`;
}

function hashEmailCode(email: string, code: string) {
  return hashSecret(`${email}:${code}`);
}
