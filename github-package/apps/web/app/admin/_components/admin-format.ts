"use client";

export function money(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return "0.00000000";
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "0.00000000";
  }

  return numeric.toFixed(8);
}

export function seconds(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return "-";
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "-";
  }

  return `${(numeric / 1000).toFixed(3)}s`;
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

export function dateTime(value: string) {
  return new Date(value).toLocaleString();
}

export function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "-";
  }

  return `${Math.max(0, value).toFixed(value >= 10 ? 1 : 2)}%`;
}

export function formatLoadAverage(values: number[] | null | undefined) {
  if (!values || values.length === 0) {
    return "-";
  }

  return values
    .slice(0, 3)
    .map((value) => value.toFixed(2))
    .join(" / ");
}

export function formatBytes(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "-";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let current = value;
  let unit = 0;

  while (current >= 1024 && unit < units.length - 1) {
    current /= 1024;
    unit += 1;
  }

  return `${current.toFixed(current >= 100 ? 0 : current >= 10 ? 1 : 2)} ${units[unit]}`;
}

export function formatDuration(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "-";
  }

  const secondsValue = Math.max(0, Math.floor(value));
  const days = Math.floor(secondsValue / 86400);
  const hours = Math.floor((secondsValue % 86400) / 3600);
  const minutes = Math.floor((secondsValue % 3600) / 60);
  const secondsRest = secondsValue % 60;

  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${secondsRest}s`;
  }
  return `${secondsRest}s`;
}

export function splitList(value: string) {
  return Array.from(
    new Set(
      value
        .split(/\s|,|，/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

export function parseModelList(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[\n,，\s]+/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}
