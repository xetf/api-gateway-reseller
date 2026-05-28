"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";

import { exportReportSummaryCsv, getReportSummary, type ReportDimensionRow } from "../../../lib/api/operations";

export default function AdminReportsPage() {
  const reportQuery = useQuery({ queryKey: ["admin", "reports-summary"], queryFn: getReportSummary });
  const exportMutation = useMutation({ mutationFn: exportReportSummaryCsv });
  const report = reportQuery.data;

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div><p className="text-sm font-medium text-blue-700">Reports</p><h2 className="mt-1 text-2xl font-semibold text-slate-950">报表中心</h2><p className="mt-2 text-sm text-slate-500">最近 30 天经营汇总与多维度排行。</p></div>
          <button type="button" onClick={() => exportMutation.mutate()} className={secondaryButton}><Download className="h-4 w-4" />导出 CSV</button>
        </div>
      </section>
      {reportQuery.isLoading ? <SkeletonGrid /> : report ? (
        <>
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Metric label="总请求" value={num(report.summary.totalCount)} />
            <Metric label="总 Token" value={num(report.summary.totalTokens)} />
            <Metric label="收入" value={money(report.summary.chargedAmountUsd)} />
            <Metric label="毛利" value={money(report.summary.grossProfitUsd)} />
          </section>
          <section className="grid gap-5 xl:grid-cols-3">
            <TopList title="热门模型 Top 10" rows={report.dimensions.models.slice(0, 10)} metric="requestCount" />
            <TopList title="耗资上游 Top 10" rows={report.dimensions.upstreams.slice(0, 10)} metric="upstreamCostUsd" moneyMode />
            <TopList title="用户收入 Top 10" rows={report.dimensions.users.slice(0, 10)} metric="chargedAmountUsd" moneyMode />
          </section>
        </>
      ) : <div className="rounded-lg border border-red-100 bg-red-50 p-4 text-sm text-red-600">报表加载失败。</div>}
    </div>
  );
}

function TopList({ title, rows, metric, moneyMode = false }: { title: string; rows: ReportDimensionRow[]; metric: keyof ReportDimensionRow; moneyMode?: boolean }) {
  const max = Math.max(...rows.map((row) => Number(row[metric] ?? 0)), 1);
  return <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"><h3 className="text-base font-semibold text-slate-950">{title}</h3><div className="mt-5 space-y-4">{rows.map((row) => { const value = Number(row[metric] ?? 0); return <div key={`${row.id ?? row.label}:${title}`}><div className="mb-1 flex justify-between gap-3 text-sm"><span className="truncate font-medium text-slate-700">{row.label}</span><span className="tabular-nums text-slate-500">{moneyMode ? money(String(value)) : num(value)}</span></div><div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-600" style={{ width: `${Math.max(4, (value / max) * 100)}%` }} /></div></div>; })}</div></section>;
}
function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm text-slate-500">{label}</p><p className="mt-2 text-2xl font-semibold tabular-nums text-slate-950">{value}</p></div>; }
function SkeletonGrid() { return <div className="grid gap-4 md:grid-cols-4">{Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-28 animate-pulse rounded-lg bg-slate-100" />)}</div>; }
function num(value: number) { return value.toLocaleString("en-US"); }
function money(value: string) { return `$${Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 })}`; }
const secondaryButton = "inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50";
