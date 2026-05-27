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
