"use client";

import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import type { ReactNode, UIEventHandler } from "react";

export function AdminEmptyState({ children }: { children: ReactNode }) {
  return <div className="admin-empty-state">{children}</div>;
}

export function Metric({
  label,
  value,
  caption,
  small = false,
}: {
  label: string;
  value: string;
  caption?: string;
  small?: boolean;
}) {
  return (
    <section className="card metric">
      <div className="metric-label">{label}</div>
      <div className={`metric-value ${small ? "small" : ""}`}>{value}</div>
      {caption ? <div className="metric-caption">{caption}</div> : null}
    </section>
  );
}

export function StatusTile({
  label,
  ok,
  value,
}: {
  label: string;
  ok: boolean | undefined;
  value: string;
}) {
  const status = ok === undefined ? "WAITING" : ok ? "HEALTHY" : "UNHEALTHY";

  return (
    <div className="status-tile">
      <div className="status-tile-head">
        <span>{label}</span>
        <StatusPill status={status} strong={ok === false} />
      </div>
      <strong>{value}</strong>
    </div>
  );
}

export function StatusPill({
  status,
  strong = false,
}: {
  status: string;
  strong?: boolean;
}) {
  const labelMap: Record<string, string> = {
    HEALTHY: "正常",
    UNHEALTHY: "异常",
    WAITING: "等待",
    FORCED_ACTIVE: "人工可用",
    FORCED_READY: "人工可调用",
    PENALIZED: "惩罚中",
    AUTO_CHECK_ON: "自动检测开",
    AUTO_CHECK_OFF: "自动检测关",
    AUTO_TERMINATE_ON: "自动终止开",
    AUTO_TERMINATE_OFF: "自动终止关",
    REASONING_TRANSFORM_ON: "强度转换开",
    REASONING_TRANSFORM_OFF: "强度转换关",
    TERMINATED: "已终止",
  };
  const ok =
    status === "ACTIVE" ||
    status === "SUCCESS" ||
    status === "HEALTHY" ||
    status === "READY" ||
    status === "FORCED_ACTIVE" ||
    status === "FORCED_READY" ||
    status === "AUTO_CHECK_ON" ||
    status === "AUTO_TERMINATE_ON" ||
    status === "REASONING_TRANSFORM_ON";
  const danger =
    status === "FAILED" ||
    status === "UNHEALTHY" ||
    status === "REVOKED" ||
    status === "DISABLED" ||
    status === "UNAVAILABLE" ||
    status === "PENALIZED" ||
    status === "MISSING" ||
    status === "AUTO_CHECK_OFF" ||
    status === "AUTO_TERMINATE_OFF" ||
    status === "REASONING_TRANSFORM_OFF";
  const special = status === "TERMINATED";

  return (
    <span
      className={`pill ${ok ? "ok" : danger ? "warn" : ""} ${special ? "terminated" : ""} ${strong ? "strong" : ""}`}
    >
      {labelMap[status] ?? status}
    </span>
  );
}

export function MobileRecord({
  title,
  meta,
  badges,
  children,
  actions,
}: {
  title: ReactNode;
  meta?: ReactNode;
  badges?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <article className="mobile-record">
      <div className="mobile-record-head">
        <div className="mobile-record-title-block">
          <strong className="mobile-record-title">{title}</strong>
          {meta ? <p>{meta}</p> : null}
        </div>
        {badges ? <div className="mobile-record-badges">{badges}</div> : null}
      </div>
      <div className="mobile-field-grid">{children}</div>
      {actions ? <div className="mobile-actions">{actions}</div> : null}
    </article>
  );
}

export function MobileField({
  label,
  children,
  wide = false,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "mobile-field wide" : "mobile-field"}>
      <span>{label}</span>
      <strong>{children}</strong>
    </div>
  );
}

export function AdminPanel({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="card admin-panel-v2">
      <div className="section-head">
        <div>
          <h2 className="section-title">{title}</h2>
          {description ? <p className="section-subtitle">{description}</p> : null}
        </div>
        {actions ? <div className="button-row">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function AdminDataTable<T>({
  data,
  columns,
  empty,
  className,
  onScroll,
  tableClassName,
}: {
  data: T[];
  columns: ColumnDef<T>[];
  empty?: ReactNode;
  className?: string;
  onScroll?: UIEventHandler<HTMLDivElement>;
  tableClassName?: string;
}) {
  const hasStickyActions = columns.some((column, index) => {
    if (index !== columns.length - 1) {
      return false;
    }

    const key = "accessorKey" in column ? column.accessorKey : undefined;
    return column.id === "actions" || key === "actions" || column.header === "操作";
  });
  const table = useReactTable({
    data,
    columns,
    getRowId: (row, index) => {
      if (row && typeof row === "object" && "id" in row) {
        const id = (row as { id?: unknown }).id;
        if (typeof id === "string" || typeof id === "number") {
          return String(id);
        }
      }

      return String(index);
    },
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div
      className={
        className
          ? `table-wrap admin-data-table-v2${hasStickyActions ? " has-sticky-actions" : ""} ${className}`
          : `table-wrap admin-data-table-v2${hasStickyActions ? " has-sticky-actions" : ""}`
      }
      onScroll={onScroll}
    >
      <table className={tableClassName}>
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th key={header.id}>
                  {header.isPlaceholder
                    ? null
                    : flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
          {data.length === 0 ? (
            <tr>
              <td colSpan={columns.length}>
                <AdminEmptyState>{empty ?? "暂无数据"}</AdminEmptyState>
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
