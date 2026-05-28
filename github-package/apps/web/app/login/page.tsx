"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AxiosError } from "axios";
import { LockKeyhole, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { loginAdmin } from "../../lib/api/auth";

const loginSchema = z.object({
  username: z.string().trim().min(1, "请输入用户名"),
  password: z.string().trim().min(1, "请输入密码"),
});

type LoginFormValues = z.infer<typeof loginSchema>;

function extractErrorMessage(error: unknown) {
  if (error instanceof AxiosError) {
    const data = error.response?.data as { message?: string; error?: { message?: string } } | undefined;

    return data?.message ?? data?.error?.message ?? "登录失败，请检查账号或密码";
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "登录失败，请稍后重试";
}

function clearAdminToken() {
  window.localStorage.removeItem("admin_token");
  window.localStorage.removeItem("gateway_admin_token");
}

export default function LoginPage() {
  const router = useRouter();
  const [errorMessage, setErrorMessage] = useState("");

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      username: "",
      password: "",
    },
  });

  async function onSubmit(values: LoginFormValues) {
    setErrorMessage("");

    try {
      const response = await loginAdmin(values);

      if (response.user.role !== "ADMIN") {
        clearAdminToken();
        throw new Error("请使用管理员账号登录后台");
      }

      window.localStorage.setItem("admin_token", response.token);
      window.localStorage.setItem("gateway_admin_token", response.token);
      router.push("/admin/overview");
    } catch (error) {
      setErrorMessage(extractErrorMessage(error));
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <section className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-8 shadow-xl shadow-slate-200/70">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg border border-blue-200 bg-blue-50 text-blue-700">
            <LockKeyhole className="h-5 w-5" aria-hidden="true" />
          </div>
          <h1 className="text-2xl font-semibold text-slate-950">管理后台登录</h1>
          <p className="mt-2 text-sm text-slate-500">请输入管理员账号进入控制台</p>
        </div>

        {errorMessage ? (
          <div className="mb-5 rounded-md border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-600">
            {errorMessage}
          </div>
        ) : null}

        <form className="space-y-5" onSubmit={handleSubmit(onSubmit)}>
          <div className="space-y-2">
            <label htmlFor="username" className="text-sm font-medium text-slate-700">
              用户名
            </label>
            <input
              id="username"
              type="text"
              autoComplete="username"
              className="h-11 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none transition-colors placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              placeholder="请输入用户名"
              aria-invalid={Boolean(errors.username)}
              {...register("username")}
            />
            {errors.username ? <p className="text-sm text-red-600">{errors.username.message}</p> : null}
          </div>

          <div className="space-y-2">
            <label htmlFor="password" className="text-sm font-medium text-slate-700">
              密码
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              className="h-11 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none transition-colors placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              placeholder="请输入密码"
              aria-invalid={Boolean(errors.password)}
              {...register("password")}
            />
            {errors.password ? <p className="text-sm text-red-600">{errors.password.message}</p> : null}
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {isSubmitting ? "登录中" : "登录"}
          </button>
        </form>
      </section>
    </main>
  );
}
