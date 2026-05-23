import { prisma } from "@gateway/db";

type PendingRequestCleanupLogger = {
  error: (value: unknown, message?: string) => void;
  info?: (value: unknown, message?: string) => void;
};

const startupStalePendingMs = 5 * 60 * 1000;
const runtimeStalePendingMs = 2 * 60 * 60 * 1000;
const cleanupIntervalMs = 60 * 1000;
const stalePendingMessage = "Request abandoned before completion";

export async function cleanupStalePendingRequests(olderThanMs = startupStalePendingMs) {
  const cutoff = new Date(Date.now() - olderThanMs);

  const count = await prisma.$executeRaw`
    UPDATE "ApiRequest"
    SET
      "status" = 'FAILED'::"ApiRequestStatus",
      "httpStatus" = 504,
      "errorMessage" = ${stalePendingMessage},
      "latencyMs" = LEAST(
        2147483647,
        GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - "createdAt")) * 1000))
      )::integer,
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE
      "status" = 'PENDING'::"ApiRequestStatus"
      AND "createdAt" < ${cutoff}
  `;

  return { count };
}

export function startPendingRequestCleanupScheduler(logger?: PendingRequestCleanupLogger) {
  const timer = setInterval(() => {
    void cleanupStalePendingRequests(runtimeStalePendingMs)
      .then((result) => {
        if (result.count > 0) {
          logger?.info?.(result, "Stale pending API requests marked failed");
        }
      })
      .catch((error) => {
        logger?.error(error, "Stale pending API request cleanup failed");
      });
  }, cleanupIntervalMs);

  return () => clearInterval(timer);
}
