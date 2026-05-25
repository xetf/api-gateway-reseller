import { prisma } from "@gateway/db";
import {
  abortActiveApiRequest,
  createManualTerminateUsage,
  manualTerminateMessage,
  manualTerminateStatusCode,
} from "./active-api-requests.js";
import { readPendingAutoTerminateSettings } from "./pending-auto-terminate-settings.js";

type PendingRequestCleanupLogger = {
  error: (value: unknown, message?: string) => void;
  info?: (value: unknown, message?: string) => void;
};

const cleanupIntervalMs = 5 * 1000;
const cleanupBatchSize = 200;

export async function cleanupStalePendingRequests(olderThanMs?: number) {
  const settings = await readPendingAutoTerminateSettings();
  if (!settings.enabled && olderThanMs === undefined) {
    return { count: 0, abortedActiveCount: 0, skipped: true as const };
  }

  const stalePendingMs = olderThanMs ?? settings.timeoutSeconds * 1000;
  const cutoff = new Date(Date.now() - stalePendingMs);
  const pendingRequests = await prisma.apiRequest.findMany({
    where: {
      status: "PENDING",
      createdAt: {
        lt: cutoff,
      },
    },
    select: {
      id: true,
      createdAt: true,
    },
    orderBy: {
      createdAt: "asc",
    },
    take: cleanupBatchSize,
  });

  let count = 0;
  let abortedActiveCount = 0;

  for (const pendingRequest of pendingRequests) {
    const abortResult = abortActiveApiRequest(pendingRequest.id);
    const latencyMs = Math.min(
      2147483647,
      Math.max(0, Math.round(Date.now() - pendingRequest.createdAt.getTime())),
    );
    const updateResult = await prisma.apiRequest.updateMany({
      where: {
        id: pendingRequest.id,
        status: "PENDING",
      },
      data: {
        status: "FAILED",
        httpStatus: manualTerminateStatusCode,
        errorMessage: manualTerminateMessage,
        latencyMs,
        responseUsage: createManualTerminateUsage(abortResult.aborted),
      },
    });

    if (updateResult.count > 0) {
      count += updateResult.count;
      if (abortResult.aborted) {
        abortedActiveCount += 1;
      }
    }
  }

  return { count, abortedActiveCount, skipped: false as const };
}

export function startPendingRequestCleanupScheduler(logger?: PendingRequestCleanupLogger) {
  const timer = setInterval(() => {
    void cleanupStalePendingRequests()
      .then((result) => {
        if (result.count > 0) {
          logger?.info?.(result, "Stale pending API requests manually terminated by timeout");
        }
      })
      .catch((error) => {
        logger?.error(error, "Stale pending API request cleanup failed");
      });
  }, cleanupIntervalMs);

  return () => clearInterval(timer);
}
