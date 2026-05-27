export const callableChannelStatuses = ["ACTIVE", "FORCED_ACTIVE"] as const;
export const healthCheckedChannelStatuses = ["ACTIVE", "UNAVAILABLE"] as const;
export const penalizedChannelStatus = "PENALIZED";

export type CallableChannelStatus = (typeof callableChannelStatuses)[number];
export type HealthCheckedChannelStatus =
  (typeof healthCheckedChannelStatuses)[number];

export function canRouteModelPoolChannel(status: string) {
  return callableChannelStatuses.includes(status as CallableChannelStatus);
}

export function canHealthCheckModelPoolChannel(status: string) {
  return healthCheckedChannelStatuses.includes(
    status as HealthCheckedChannelStatus,
  );
}

export function isPenalizedModelPoolChannel(status: string) {
  return status === penalizedChannelStatus;
}

export function shouldKeepCallableAfterHealthFailure(status: string) {
  return status === "FORCED_ACTIVE";
}

export function nextChannelStatusAfterHealthSuccess(
  status: string,
  recoverySuccesses: number,
  recoverySuccessThreshold: number,
) {
  if (status === "FORCED_ACTIVE") {
    return "FORCED_ACTIVE";
  }

  return status === "ACTIVE" || recoverySuccesses >= recoverySuccessThreshold
    ? "ACTIVE"
    : "UNAVAILABLE";
}

export function nextChannelStatusAfterHealthFailure(status: string) {
  return shouldKeepCallableAfterHealthFailure(status)
    ? "FORCED_ACTIVE"
    : "UNAVAILABLE";
}
