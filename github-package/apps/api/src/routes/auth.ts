import type { FastifyInstance } from "fastify";
import { prisma } from "@gateway/db";
import { z } from "zod";
import { requireUser, verifyPassword } from "../services/auth.js";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const adminLoginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export async function authRoutes(app: FastifyInstance) {
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

    const token = app.jwt.sign({
      sub: user.id,
      email: user.email,
      role: user.role,
    });

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        name: user.name,
        role: user.role,
        allowedModels: user.allowedModels,
      },
    };
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

    const token = app.jwt.sign({
      sub: user.id,
      email: user.email,
      role: user.role,
    });

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        name: user.name,
        role: user.role,
        allowedModels: user.allowedModels,
      },
    };
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
