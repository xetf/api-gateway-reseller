const postgresNulPattern = /\u0000/g;

export function sanitizePostgresText(value: string) {
  return value.replace(postgresNulPattern, "");
}

export function sanitizeJsonForPostgres(value: unknown): unknown {
  if (typeof value === "string") {
    return sanitizePostgresText(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeJsonForPostgres(item));
  }

  if (isPlainRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [
          sanitizePostgresText(key),
          sanitizeJsonForPostgres(item),
        ]),
    );
  }

  return value;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}
