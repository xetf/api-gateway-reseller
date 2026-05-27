"use client";

import { RefreshCw, Save } from "lucide-react";
import { useState } from "react";
import { adminDownload } from "../_components/admin-api";
import { useAdminResource } from "../_components/admin-hooks";
import { dateTime, formatNumber, money } from "../_components/admin-format";
import {
  AdminDataTable,
  AdminPanel,
  Metric,
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
    <div className="stack">
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

      <AdminPanel
        title="30 天经营汇总"
        description="收入、成本、毛利和请求量总览。"
        actions={
          <>
            <button
              className="button secondary"
              disabled={exporting || !report}
              onClick={exportReportCsv}
              type="button"
            >
              <Save size={17} />
              {exporting ? "导出中..." : "导出 CSV"}
            </button>
            <button
              className="button secondary"
              disabled={isFetching}
              onClick={() => void refetch()}
              type="button"
            >
              <RefreshCw size={17} />
              {isFetching ? "刷新中..." : "刷新"}
            </button>
          </>
        }
      >
        {error ? (
          <div className="error compact-error">
            {error instanceof Error ? error.message : "报表加载失败。"}
          </div>
        ) : null}
        {exportError ? (
          <div className="error compact-error">{exportError}</div>
        ) : null}
        <div className="metric-grid">
          <Metric
            label="请求数"
            value={formatNumber(report?.summary.totalCount ?? 0)}
          />
          <Metric
            label="收入"
            value={`$${money(report?.summary.chargedAmountUsd ?? "0")}`}
          />
          <Metric
            label="上游成本"
            value={`$${money(report?.summary.upstreamCostUsd ?? "0")}`}
          />
          <Metric
            label="毛利"
            value={`$${money(report?.summary.grossProfitUsd ?? "0")}`}
          />
        </div>
      </AdminPanel>

      <div className="split-grid">
        <ReportDimensionTable
          title="用户收入排行"
          rows={report?.dimensions.users ?? []}
        />
        <ReportDimensionTable
          title="模型收入排行"
          rows={report?.dimensions.models ?? []}
        />
        <ReportDimensionTable
          title="上游收入排行"
          rows={report?.dimensions.upstreams ?? []}
        />
        <ReportDimensionTable
          title="等级收入排行"
          rows={report?.dimensions.tiers ?? []}
        />
        <ReportDimensionTable
          title="专线收入排行"
          rows={report?.dimensions.dedicatedRoutes ?? []}
        />
      </div>
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
