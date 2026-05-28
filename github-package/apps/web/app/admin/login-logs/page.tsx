"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { getLoginLogs, type LoginLog } from "../../../lib/api/operations";

export default function AdminLoginLogsPage() {
  const [success, setSuccess] = useState("");
  const [userId, setUserId] = useState("");
  const [take, setTake] = useState(100);
  const logsQuery = useQuery({
    queryKey: ["admin", "login-logs", success, userId, take],
    queryFn: () => getLoginLogs({ success: success as "true" | "false" | undefined, userId, take }),
  });
  const logs = logsQuery.data?.logs ?? [];
  const total = logsQuery.data?.total ?? 0;

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-sm font-medium text-blue-700">Login Logs</p>
        <h2 className="mt-1 text-2xl font-semibold text-slate-950">登录日志</h2>
        <p className="mt-2 text-sm text-slate-500">展示登录方式、成功/失败状态、IP 与 User Agent。</p>
      </section>
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="grid gap-4 md:grid-cols-[220px_minmax(0,1fr)_auto]">
          <label className="grid gap-2"><span className={labelClass}>状态</span><select value={success} onChange={(event) => { setTake(100); setSuccess(event.target.value); }} className={inputClass}><option value="">全部</option><option value="true">成功</option><option value="false">失败</option></select></label>
          <label className="grid gap-2"><span className={labelClass}>User ID</span><input value={userId} onChange={(event) => { setTake(100); setUserId(event.target.value); }} className={inputClass} /></label>
          <div className="flex items-end text-sm text-slate-500">共 {total} 条</div>
        </div>
      </section>
      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        {logsQuery.isLoading ? <SkeletonRows /> : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-[1080px] w-full text-left">
                <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-500"><tr><th className="px-5 py-3">时间</th><th className="px-5 py-3">用户</th><th className="px-5 py-3">方式</th><th className="px-5 py-3">状态</th><th className="px-5 py-3">IP</th><th className="px-5 py-3">User Agent</th></tr></thead>
                <tbody className="divide-y divide-slate-200">{logs.map((log) => <tr key={log.id} className="hover:bg-slate-50/70"><td className="px-5 py-4 text-sm text-slate-600">{formatDate(log.createdAt)}</td><td className="px-5 py-4"><div className="font-medium text-slate-950">{log.email ?? log.user?.email ?? "-"}</div><div className="mt-1 font-mono text-xs text-slate-400">{log.userId ?? ""}</div></td><td className="px-5 py-4 text-sm text-slate-600">{log.method}</td><td className="px-5 py-4"><Badge active={log.success}>{log.success ? "成功" : "失败"}</Badge>{log.failureReason ? <div className="mt-2 text-xs text-red-600">{log.failureReason}</div> : null}</td><td className="px-5 py-4 font-mono text-sm text-slate-600">{log.ip ?? "-"}</td><td className="px-5 py-4 max-w-md truncate text-sm text-slate-500">{log.userAgent ?? "-"}</td></tr>)}</tbody>
              </table>
            </div>
            <div className="flex justify-center border-t border-slate-200 p-5">{logs.length < total ? <button type="button" onClick={() => setTake((current) => current + 100)} className={primaryButton}>加载更多</button> : <span className="text-sm text-slate-500">没有更多日志</span>}</div>
          </>
        )}
      </section>
    </div>
  );
}

function Badge({ active, children }: { active: boolean; children: React.ReactNode }) { return <span className={`inline-flex rounded-md border px-2 py-1 text-xs font-semibold ${active ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700"}`}>{children}</span>; }
function SkeletonRows() { return <div className="space-y-3 p-5">{Array.from({ length: 8 }).map((_, index) => <div key={index} className="h-14 animate-pulse rounded-md bg-slate-100" />)}</div>; }
function formatDate(value: string) { return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value)); }
const labelClass = "text-sm font-medium text-slate-700";
const inputClass = "h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
const primaryButton = "inline-flex h-10 items-center justify-center rounded-md bg-blue-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-blue-700";
