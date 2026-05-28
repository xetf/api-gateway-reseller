import http from "../http";
import type { AdminUser } from "../types/auth";

export interface AdminLoginInput {
  username: string;
  password: string;
}

export interface AdminLoginResponse {
  token: string;
  user: AdminUser;
}

export async function loginAdmin(input: AdminLoginInput) {
  const response = await http.post<AdminLoginResponse>("/auth/admin-login", input);

  return response.data;
}

export async function getCurrentUser() {
  const response = await http.get<AdminUser>("/auth/me");

  return response.data;
}
