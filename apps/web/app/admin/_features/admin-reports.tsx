"use client";

import { RefreshCw, Save } from "lucide-react";
import { useState } from "react";
import { adminDownload } from "../_components/admin-api";
import { useAdminResource } from "../_components/admin-hooks";
import { dateTime, formatNumber, money } from "../_components/admin-format";
import {
  AdminDataTable,
  AdminPanel,
  ConsoleNavButton,
  Metric,
  SettingsConsoleLayout,
  StatusTile,
} from "../_components/admin-ui";

type AdminRequestsSummary = {
  totalCount: number;
  totalTokens: number;
  chargedAmountUsd: string;
  upstreamCostUsd?: string;
  grossProfitUsd?: string;
};

type ReportDimensionRow = {
  id?: string | null;
  label: string;
  requestCount: number;
  totalTokens: number;
  chargedAmountUsd: string;
  upstreamCostUsd: string;
  grossProfitUsd: string;
};

export type AdminReportSummary = {
  dateFrom: string;
  dateTo: string;
  summary: AdminRequestsSummary;
  dimensions: {
    users: ReportDimensionRow[];
    models: ReportDimensionRow[];
    upstreams: ReportDimensionRow[];
    tiers: ReportDimensionRow[];
    dedicatedRoutes: ReportDimensionRow[];
  };
};

export function AdminReports({
  token,
}: {
  token: string;
}) {
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<
    "summary" | "users" | "models" | "upstreams" | "tiers" | "routes"
  >("summary");
  const {
    data: report,
    error,
    isFetching,
    refetch,
  } = useAdminResource<AdminReportSummary>(
    "reports",
    "/admin/reports/summary",
    Boolean(token),
  );

  async function exportReportCsv() {
    setExporting(true);
    setExportError(null);
    try {
      await adminDownload(
        "/admin/reports/summary/export",
        `admin-report-${new Date().toISOString().slice(0, 10)}.csv`,
        token,
      );
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "未知错误");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="stack admin-reports-page">
      <section className="admin-hero-panel">
        <div>
          <span className="eyebrow">Operations Report</span>
          <h2>运营报表工作台</h2>
          <p>
            {report
              ? `${dateTime(report.dateFrom)} - ${dateTime(report.dateTo)}`
              : "正在汇总最近 30 天经营数据"}
          </p>
        </div>
        <div className="admin-hero-status">
          <StatusTile
            label="请求数"
            ok={report ? true : undefined}
            value={formatNumber(report?.summary.totalCount ?? 0)}
          />
          <StatusTile
            label="毛利"
            ok={report ? true : undefined}
            value={`$${money(report?.summary.grossProfitUsd ?? "0")}`}
          />
        </div>
      </section>

      <SettingsConsoleLayout
        className="admin-reports-console"
        nav={
          <>
            <ConsoleNavButton
              active={activeView === "summary"}
              title="总览"
              description="收入、成本、毛利"
              meta={formatNumber(report?.summary.totalCount ?? 0)}
              onClick={() => setActiveView("summary")}
            />
            <ConsoleNavButton active={activeView === "users"} title="用户" description="用户收入排行" meta={`${report?.dimensions.users.length ?? 0} 项`} onClick={() => setActiveView("users")} />
            <ConsoleNavButton active={activeView === "models"} title="模型" description="模型收入排行" meta={`${report?.dimensions.models.length ?? 0} 项`} onClick={() => setActiveView("models")} />
            <ConsoleNavButton active={activeView === "upstreams"} title="上游" description="上游收入排行" meta={`${report?.dimensions.upstreams.length ?? 0} 项`} onClick={() => setActiveView("upstreams")} />
            <ConsoleNavButton active={activeView === "tiers"} title="等级" description="等级收入排行" meta={`${report?.dimensions.tiers.length ?? 0} 项`} onClick={() => setActiveView("tiers")} />
            <ConsoleNavButton active={activeView === "routes"} title="专线" description="专线收入排行" meta={`${report?.dimensions.dedicatedRoutes.length ?? 0} 项`} onClick={() => setActiveView("routes")} />
          </>
        }
        summary={
          <div className="admin-summary-card">
            <strong>报表操作</strong>
            <p>{report ? `${dateTime(report.dateFrom)} - ${dateTime(report.dateTo)}` : "等待数据加载"}</p>
            <div className="button-row">
              <button className="button secondary" disabled={exporting || !report} onClick={exportReportCsv} type="button">
                <Save size={17} />
                {exporting ? "导出中..." : "导出 CSV"}
              </button>
              <button className="button secondary" disabled={isFetching} onClick={() => void refetch()} type="button">
                <RefreshCw size={17} />
                {isFetching ? "刷新中..." : "刷新"}
              </button>
            </div>
          </div>
        }
      >
        {error ? <div className="error compact-error">{error instanceof Error ? error.message : "报表加载失败。"}</div> : null}
        {exportError ? <div className="error compact-error">{exportError}</div> : null}
        {activeView === "summary" ? (
          <AdminPanel title="30 天经营汇总" description="收入、成本、毛利和请求量总览。">
            <div className="metric-grid">
              <Metric label="请求数" value={formatNumber(report?.summary.totalCount ?? 0)} />
              <Metric label="收入" value={`$${money(report?.summary.chargedAmountUsd ?? "0")}`} />
              <Metric label="上游成本" value={`$${money(report?.summary.upstreamCostUsd ?? "0")}`} />
              <Metric label="毛利" value={`$${money(report?.summary.grossProfitUsd ?? "0")}`} />
            </div>
          </AdminPanel>
        ) : null}
        {activeView === "users" ? <ReportDimensionTable title="用户收入排行" rows={report?.dimensions.users ?? []} /> : null}
        {activeView === "models" ? <ReportDimensionTable title="模型收入排行" rows={report?.dimensions.models ?? []} /> : null}
        {activeView === "upstreams" ? <ReportDimensionTable title="上游收入排行" rows={report?.dimensions.upstreams ?? []} /> : null}
        {activeView === "tiers" ? <ReportDimensionTable title="等级收入排行" rows={report?.dimensions.tiers ?? []} /> : null}
        {activeView === "routes" ? <ReportDimensionTable title="专线收入排行" rows={report?.dimensions.dedicatedRoutes ?? []} /> : null}
      </SettingsConsoleLayout>
    </div>
  );
}

function ReportDimensionTable({
  title,
  rows,
}: {
  title: string;
  rows: ReportDimensionRow[];
}) {
  const columns = [
    {
      header: "对象",
      cell: ({ row }: { row: { original: ReportDimensionRow } }) => (
        <>
          <strong>{row.original.label}</strong>
          <div className="muted">
            {formatNumber(row.original.totalTokens)} tokens
          </div>
        </>
      ),
    },
    {
      header: "请求",
      cell: ({ row }: { row: { original: ReportDimensionRow } }) =>
        formatNumber(row.original.requestCount),
    },
    {
      header: "收入",
      cell: ({ row }: { row: { original: ReportDimensionRow } }) =>
        `$${money(row.original.chargedAmountUsd)}`,
    },
    {
      header: "毛利",
      cell: ({ row }: { row: { original: ReportDimensionRow } }) =>
        `$${money(row.original.grossProfitUsd)}`,
    },
  ];

  return (
    <AdminPanel title={title}>
      <AdminDataTable columns={columns} data={rows} empty={`暂无${title}`} />
    </AdminPanel>
  );
}
