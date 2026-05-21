import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.string().default("development"),
  API_HOST: z.string().default("0.0.0.0"),
  API_PORT: z.coerce.number().default(4100),
  JWT_SECRET: z.string().min(16),
  REDIS_URL: z.string().default("redis://127.0.0.1:6379"),
  UPSTREAM_BASE_URL: z.string().url().default("https://api.openai.com"),
  UPSTREAM_API_KEY: z.string().min(1),
  UPSTREAM_TIMEOUT_MS: z.coerce.number().default(120000),
  DEFAULT_CURRENCY: z.string().default("USD"),
});

export const env = envSchema.parse(process.env);
