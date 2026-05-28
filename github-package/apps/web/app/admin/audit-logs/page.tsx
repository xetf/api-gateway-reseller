"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";

import { getAuditLogs, type AuditLog } from "../../../lib/api/settings";

export default function AdminAuditLogsPage() {
  const [q, setQ] = useState("");
  const [outcome, setOutcome] = useState("");
  const logsQuery = useInfiniteQuery({
    queryKey: ["admin", "audit-logs", q, outcome],
    queryFn: ({ pageParam }) => getAuditLogs({ q, outcome: outcome as AuditLog["outcome"] | undefined, cursor: pageParam || undefined, take: 80 }),
    initialPageParam: "",
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
  const logs = logsQuery.data?.pages.flatMap((page) => page.logs) ?? [];

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-sm font-medium text-blue-700">Audit Logs</p>
        <h2 className="mt-1 text-2xl font-semibold text-slate-950">审计日志</h2>
        <p className="mt-2 text-sm text-slate-500">只读展示所有管理端写操作，关键密钥已由后端脱敏。</p>
      </section>
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
          <label className="grid gap-2"><span className={labelClass}>搜索</span><input value={q} onChange={(event) => setQ(event.target.value)} className={inputClass} placeholder="动作 / 路径 / 操作人 / IP" /></label>
          <label className="grid gap-2"><span className={labelClass}>结果</span><select value={outcome} onChange={(event) => setOutcome(event.target.value)} className={inputClass}><option value="">全部</option><option value="success">success</option><option value="failure">failure</option><option value="unknown">unknown</option></select></label>
        </div>
      </section>
      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        {logsQuery.isLoading ? <SkeletonRows /> : logsQuery.isError ? <div className="p-5 text-sm font-medium text-red-600">审计日志加载失败。</div> : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-[1280px] w-full text-left">
                <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-500">
                  <tr><th className="px-5 py-3">时间</th><th className="px-5 py-3">操作人</th><th className="px-5 py-3">动作</th><th className="px-5 py-3">结果</th><th className="px-5 py-3">目标</th><th className="px-5 py-3">Payload</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {logs.map((log) => (
                    <tr key={log.id} className="align-top hover:bg-slate-50/70">
                      <td className="px-5 py-4 text-sm text-slate-600">{formatDate(log.createdAt)}</td>
                      <td className="px-5 py-4"><div className="font-medium text-slate-950">{log.adminEmail ?? "-"}</div><div className="mt-1 text-xs text-slate-500">{log.ip ?? "-"}</div></td>
                      <td className="px-5 py-4"><Badge tone={actionTone(log.action)}>{log.action}</Badge><div className="mt-2 text-xs text-slate-500">{log.method} {log.path}</div></td>
                      <td className="px-5 py-4"><Badge tone={log.outcome === "success" ? "green" : log.outcome === "failure" ? "red" : "slate"}>{log.outcome}</Badge>{log.statusCode ? <div className="mt-2 text-xs text-slate-500">HTTP {log.statusCode}</div> : null}</td>
                      <td className="px-5 py-4 text-sm text-slate-600">{log.targetType ?? "-"}<div className="mt-1 font-mono text-xs text-slate-400">{log.targetId ?? ""}</div></td>
                      <td className="px-5 py-4"><Payload log={log} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-center border-t border-slate-200 p-5">
              {logsQuery.hasNextPage ? <button type="button" onClick={() => logsQuery.fetchNextPage()} disabled={logsQuery.isFetchingNextPage} className="inline-flex h-10 items-center rounded-md bg-blue-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-60">{logsQuery.isFetchingNextPage ? "加载中" : "加载下一页"}</button> : <span className="text-sm text-slate-500">没有更多日志</span>}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function Payload({ log }: { log: AuditLog }) {
  const value = { requestBody: log.requestBody, responseBody: log.responseBody, errorMessage: log.errorMessage };
  return <pre className="max-h-48 max-w-xl overflow-auto rounded-md bg-slate-950 p-3 text-xs leading-5 text-slate-100"><code>{JSON.stringify(value, null, 2)}</code></pre>;
}
function Badge({ children, tone }: { children: React.ReactNode; tone: "green" | "red" | "blue" | "amber" | "slate" }) {
  const styles = { green: "border-emerald-200 bg-emerald-50 text-emerald-700", red: "border-red-200 bg-red-50 text-red-700", blue: "border-blue-200 bg-blue-50 text-blue-700", amber: "border-amber-200 bg-amber-50 text-amber-700", slate: "border-slate-200 bg-slate-50 text-slate-600" };
  return <span className={`inline-flex rounded-md border px-2 py-1 text-xs font-semibold ${styles[tone]}`}>{children}</span>;
}
function actionTone(action: string): "green" | "red" | "blue" | "amber" | "slate" {
  const upper = action.toUpperCase();
  if (upper.includes("DELETE")) return "red";
  if (upper.includes("POST") || upper.includes("CREATE")) return "green";
  if (upper.includes("PATCH") || upper.includes("PUT") || upper.includes("UPDATE")) return "blue";
  return "slate";
}
function formatDate(value: string) { return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value)); }
function SkeletonRows() { return <div className="space-y-3 p-5">{Array.from({ length: 8 }).map((_, index) => <div key={index} className="h-16 animate-pulse rounded-md bg-slate-100" />)}</div>; }
const labelClass = "text-sm font-medium text-slate-700";
const inputClass = "h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
