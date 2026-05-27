"use client";

export function firstFormError(error: unknown) {
  if (!error || typeof error !== "object" || !("issues" in error)) {
    return null;
  }

  const issues = (error as { issues?: Array<{ message?: string }> }).issues;
  return issues?.[0]?.message ?? null;
}
