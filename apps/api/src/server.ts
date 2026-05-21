import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import jwt from "@fastify/jwt";
import { ZodError } from "zod";
import { redis } from "./lib/redis.js";
import { env } from "./env.js";
import { authRoutes } from "./routes/auth.js";
import { apiKeyRoutes } from "./routes/api-keys.js";
import { walletRoutes } from "./routes/wallet.js";
import { usageRoutes } from "./routes/usage.js";
import { redeemCodeRoutes } from "./routes/redeem-codes.js";
import { proxyRoutes } from "./routes/proxy.js";
import { adminRoutes } from "./routes/admin.js";

declare module "fastify" {
  interface FastifyInstance {
    redis: typeof redis;
  }
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: {
      sub: string;
      email: string;
      role: string;
    };
    user: {
      sub: string;
      email: string;
      role: string;
    };
  }
}

const app = Fastify({
  logger: {
    level: env.NODE_ENV === "production" ? "info" : "debug",
  },
  bodyLimit: 20 * 1024 * 1024,
});

app.decorate("redis", redis);

await app.register(cors, {
  origin: true,
  credentials: true,
  methods: ["GET", "HEAD", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Authorization", "Content-Type"],
});
await app.register(helmet, {
  contentSecurityPolicy: false,
});
await app.register(jwt, {
  secret: env.JWT_SECRET,
  sign: {
    expiresIn: "7d",
  },
});

app.setErrorHandler((error, _request, reply) => {
  if (error instanceof ZodError) {
    return reply.status(400).send({
      message: "Validation error",
      issues: error.issues,
    });
  }

  if (hasStatusCode(error)) {
    return reply.status(error.statusCode).send({
      message: error.message,
    });
  }

  app.log.error(error);
  return reply.status(500).send({
    message: "Internal server error",
  });
});

app.get("/", async () => ({
  ok: true,
  service: "api-gateway-reseller",
  health: "/health",
}));

app.get("/health", async () => ({ ok: true }));

await app.register(authRoutes);
await app.register(apiKeyRoutes);
await app.register(walletRoutes);
await app.register(usageRoutes);
await app.register(redeemCodeRoutes);
await app.register(proxyRoutes);
await app.register(adminRoutes);

async function start() {
  try {
    await redis.connect().catch((error: unknown) => {
      app.log.warn({ error }, "Redis connect failed, API key rate limit may fail");
    });
    await app.listen({
      host: env.API_HOST,
      port: env.API_PORT,
    });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

void start();

function hasStatusCode(error: unknown): error is { statusCode: number; message: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    typeof (error as { statusCode?: unknown }).statusCode === "number" &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  );
}
