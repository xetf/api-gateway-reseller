export type UserRole = "USER" | "ADMIN";

export type UserStatus = "ACTIVE" | "DISABLED" | "SUSPENDED" | "TRIAL" | "RISK_REVIEW";

export interface AdminUser {
  id: string;
  email: string;
  username: string;
  role: UserRole;
  status: UserStatus;
  allowedModels: string[];
  rateLimitPerMinute: number;
  concurrencyLimit: number;
  tokenVersion: number;
}
