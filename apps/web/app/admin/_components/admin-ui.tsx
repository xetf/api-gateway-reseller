"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { SlidersHorizontal } from "lucide-react";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import { useState, type ReactNode, type UIEventHandler } from "react";

export function AdminEmptyState({ children }: { children: ReactNode }) {
  return <div className="admin-empty-state">{children}</div>;
}

export function ModalShell({
  title,
  description,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-backdrop" />
        <Dialog.Content
          className={wide ? "form-modal modal-wide" : "form-modal"}
        >
          <div className="modal-header">
            <div>
              <Dialog.Title asChild>
                <h2>{title}</h2>
              </Dialog.Title>
              {description ? (
                <Dialog.Description asChild>
                  <p>{description}</p>
                </Dialog.Description>
              ) : null}
            </div>
            <Dialog.Close className="modal-close" type="button">
              ×
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
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
    success: "成功",
    failure: "失败",
    unknown: "未知",
  };
  const ok =
    status === "ACTIVE" ||
    status === "SUCCESS" ||
    status === "success" ||
    status === "HEALTHY" ||
    status === "READY" ||
    status === "FORCED_ACTIVE" ||
    status === "FORCED_READY" ||
    status === "AUTO_CHECK_ON" ||
    status === "AUTO_TERMINATE_ON" ||
    status === "REASONING_TRANSFORM_ON";
  const danger =
    status === "FAILED" ||
    status === "failure" ||
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

export function MobileEmpty({ children }: { children: ReactNode }) {
  return <div className="mobile-empty">{children}</div>;
}

export function AdminFoldout({
  title,
  description,
  badge,
  defaultOpen = false,
  children,
}: {
  title: string;
  description?: string;
  badge?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <>
      <section className="admin-action-card">
        <div>
          <strong>{title}</strong>
          {description ? <small>{description}</small> : null}
        </div>
        <div className="admin-action-card-side">
          {badge}
          <button
            className="button secondary compact"
            onClick={() => setOpen(true)}
            type="button"
          >
            <SlidersHorizontal size={16} />
            配置
          </button>
        </div>
      </section>
      {open ? (
        <ModalShell
          description={description}
          onClose={() => setOpen(false)}
          title={title}
          wide
        >
          <div className="modal-body">{children}</div>
        </ModalShell>
      ) : null}
    </>
  );
}

export function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="info-line">
      <span>{label}</span>
      <strong>{value}</strong>
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
