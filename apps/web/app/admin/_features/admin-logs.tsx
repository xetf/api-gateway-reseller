"use client";

import { FileSearch, RefreshCw } from "lucide-react";
import { useState } from "react";
import { dateTime } from "../_components/admin-format";
import { useAdminResource } from "../_components/admin-hooks";
import {
  AdminDataTable,
  AdminPanel,
  MobileEmpty,
  MobileField,
  MobileRecord,
  StatusPill,
  StatusTile,
} from "../_components/admin-ui";

type AdminAuditLog = {
  id: string;
  adminUserId?: string | null;
  adminEmail?: string | null;
  action: string;
  method: string;
  path: string;
  targetType?: string | null;
  targetId?: string | null;
  requestBody?: unknown | null;
  responseStatus?: number | null;
  outcome?: "success" | "failure" | "unknown" | string | null;
  errorMessage?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  createdAt: string;
};

type AdminAuditLogsPage = {
  logs: AdminAuditLog[];
  nextCursor?: string | null;
};

type LoginLog = {
  id: string;
  userId?: string | null;
  email?: string | null;
  username?: string | null;
  method: string;
  success: boolean;
  failureReason?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  createdAt: string;
  user?: {
    id: string;
    email: string;
    role: string;
    status: string;
  } | null;
};

type LoginLogsPage = {
  logs: LoginLog[];
  total: number;
};

function formatAuditBody(value: unknown) {
  if (value === null || value === undefined) {
    return "-";
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function auditLogsPath(query: string, outcome: string) {
  const params = new URLSearchParams({ take: "120" });
  if (query.trim()) {
    params.set("q", query.trim());
  }
  if (outcome) {
    params.set("outcome", outcome);
  }
  return `/admin/audit-logs?${params.toString()}`;
}

function loginLogsPath(query: string, success: string) {
  const params = new URLSearchParams({ take: "120" });
  if (query.trim()) {
    const trimmed = query.trim();
    if (trimmed.includes("@")) {
      params.set("email", trimmed);
    } else if (/^(\d{1,3}\.){3}\d{1,3}$/.test(trimmed) || trimmed.includes(":")) {
      params.set("ip", trimmed);
    } else {
      params.set("method", trimmed);
    }
  }
  if (success) {
    params.set("success", success);
  }
  return `/admin/login-logs?${params.toString()}`;
}

export function AdminAuditLogs() {
  const [queryDraft, setQueryDraft] = useState("");
  const [outcomeDraft, setOutcomeDraft] = useState("");
  const [query, setQuery] = useState("");
  const [outcome, setOutcome] = useState("");
  const { data, error, isFetching, refetch } =
    useAdminResource<AdminAuditLogsPage>(
      "auditLogs",
      auditLogsPath(query, outcome),
    );
  const logs = data?.logs ?? [];

  const columns = [
    {
      header: "时间",
      cell: ({ row }: { row: { original: AdminAuditLog } }) => {
        const log = row.original;
        return (
          <>
            <strong>{dateTime(log.createdAt)}</strong>
            <span className="muted">
              {log.method} {log.path}
            </span>
          </>
        );
      },
    },
    {
      header: "管理员",
      cell: ({ row }: { row: { original: AdminAuditLog } }) => {
        const log = row.original;
        return (
          <>
            <strong>{log.adminEmail ?? "-"}</strong>
            <span className="muted">{log.adminUserId ?? "-"}</span>
          </>
        );
      },
    },
    {
      header: "动作",
      cell: ({ row }: { row: { original: AdminAuditLog } }) => {
        const log = row.original;
        return (
          <>
            <StatusPill status={log.action} />
            <span className="muted">HTTP {log.responseStatus ?? "-"}</span>
          </>
        );
      },
    },
    {
      header: "结果",
      cell: ({ row }: { row: { original: AdminAuditLog } }) => {
        const log = row.original;
        return (
          <>
            <StatusPill status={log.outcome ?? "unknown"} />
            <span className="muted truncate">{log.errorMessage ?? "-"}</span>
          </>
        );
      },
    },
    {
      header: "目标",
      cell: ({ row }: { row: { original: AdminAuditLog } }) => {
        const log = row.original;
        return (
          <>
            <strong>{log.targetType ?? "-"}</strong>
            <span className="muted">{log.targetId ?? "-"}</span>
          </>
        );
      },
    },
    {
      header: "来源",
      cell: ({ row }: { row: { original: AdminAuditLog } }) => {
        const log = row.original;
        return (
          <>
            <strong>{log.ip ?? "-"}</strong>
            <span className="muted truncate">{log.userAgent ?? "-"}</span>
          </>
        );
      },
    },
    {
      header: "内容",
      cell: ({ row }: { row: { original: AdminAuditLog } }) => (
        <pre className="json-snippet">
          {formatAuditBody(row.original.requestBody)}
        </pre>
      ),
    },
  ];

  return (
    <section className="stack admin-log-page">
      <section className="admin-hero-panel">
        <div>
          <span className="eyebrow">Audit Trail</span>
          <h2>操作审计工作台</h2>
          <p>按管理员、动作、路径、目标或 IP 查询后台写操作，重点查看失败和异常来源。</p>
        </div>
        <div className="admin-hero-status">
          <StatusTile
            label="已加载"
            ok={logs.length > 0 ? true : undefined}
            value={`${logs.length} 条`}
          />
        </div>
      </section>
      <div className="toolbar admin-log-toolbar">
        <form
          className="filter-row"
          onSubmit={(event) => {
            event.preventDefault();
            setQuery(queryDraft);
            setOutcome(outcomeDraft);
          }}
        >
          <label>
            搜索
            <input
              placeholder="管理员、动作、路径、目标、IP"
              value={queryDraft}
              onChange={(event) => setQueryDraft(event.target.value)}
            />
          </label>
          <label>
            结果
            <select
              value={outcomeDraft}
              onChange={(event) => setOutcomeDraft(event.target.value)}
            >
              <option value="">全部</option>
              <option value="failure">失败</option>
              <option value="success">成功</option>
              <option value="unknown">未知</option>
            </select>
          </label>
          <button className="button" type="submit">
            <FileSearch size={16} />
            <span>查询</span>
          </button>
        </form>
        <button
          className="button secondary"
          disabled={isFetching}
          onClick={() => void refetch()}
          type="button"
        >
          <RefreshCw size={16} />
          <span>{isFetching ? "刷新中..." : "刷新"}</span>
        </button>
      </div>

      {error ? (
        <div className="error compact-error">
          {error instanceof Error ? error.message : "操作审计加载失败。"}
        </div>
      ) : null}
      <AdminPanel title="后台操作" description={`已加载 ${logs.length} 条`}>
        <AdminDataTable
          columns={columns}
          data={logs}
          empty="暂无操作审计记录"
        />
        <div className="mobile-record-list">
          {logs.map((log) => (
            <MobileRecord
              key={log.id}
              title={log.action}
              meta={`${dateTime(log.createdAt)} · ${log.method} ${log.path}`}
              badges={<StatusPill status={log.outcome ?? "unknown"} />}
            >
              <MobileField label="管理员" wide>
                {log.adminEmail ?? log.adminUserId ?? "-"}
              </MobileField>
              <MobileField label="HTTP">HTTP {log.responseStatus ?? "-"}</MobileField>
              <MobileField label="目标" wide>
                {log.targetType ?? "-"} · {log.targetId ?? "-"}
              </MobileField>
              <MobileField label="来源" wide>
                {log.ip ?? "-"}
              </MobileField>
              <MobileField label="错误" wide>
                {log.errorMessage ?? "-"}
              </MobileField>
            </MobileRecord>
          ))}
          {logs.length === 0 ? <MobileEmpty>暂无操作审计记录</MobileEmpty> : null}
        </div>
      </AdminPanel>
    </section>
  );
}

export function AdminLoginLogs() {
  const [queryDraft, setQueryDraft] = useState("");
  const [successDraft, setSuccessDraft] = useState("");
  const [query, setQuery] = useState("");
  const [success, setSuccess] = useState("");
  const { data, error, isFetching, refetch } = useAdminResource<LoginLogsPage>(
    "loginLogs",
    loginLogsPath(query, success),
  );
  const logs = data?.logs ?? [];

  const columns = [
    {
      header: "时间",
      cell: ({ row }: { row: { original: LoginLog } }) =>
        dateTime(row.original.createdAt),
    },
    {
      header: "账号",
      cell: ({ row }: { row: { original: LoginLog } }) => {
        const log = row.original;
        return (
          <>
            <strong>{log.email ?? log.user?.email ?? "-"}</strong>
            <span className="muted">{log.username ?? log.userId ?? "-"}</span>
          </>
        );
      },
    },
    {
      header: "方式",
      cell: ({ row }: { row: { original: LoginLog } }) => (
        <StatusPill status={row.original.method} />
      ),
    },
    {
      header: "结果",
      cell: ({ row }: { row: { original: LoginLog } }) => {
        const log = row.original;
        return (
          <>
            <StatusPill status={log.success ? "success" : "failure"} />
            <span className="muted truncate">{log.failureReason ?? "-"}</span>
          </>
        );
      },
    },
    {
      header: "来源",
      cell: ({ row }: { row: { original: LoginLog } }) => {
        const log = row.original;
        return (
          <>
            <strong>{log.ip ?? "-"}</strong>
            <span className="muted truncate">{log.userAgent ?? "-"}</span>
          </>
        );
      },
    },
  ];

  return (
    <section className="stack admin-log-page">
      <section className="admin-hero-panel">
        <div>
          <span className="eyebrow">Login Trail</span>
          <h2>登录日志工作台</h2>
          <p>集中排查管理员和用户登录成功、失败、来源 IP 与失败原因。</p>
        </div>
        <div className="admin-hero-status">
          <StatusTile
            label="已加载"
            ok={logs.length > 0 ? true : undefined}
            value={`${logs.length} 条`}
          />
        </div>
      </section>
      <div className="toolbar admin-log-toolbar">
        <form
          className="filter-row"
          onSubmit={(event) => {
            event.preventDefault();
            setQuery(queryDraft);
            setSuccess(successDraft);
          }}
        >
          <label>
            搜索
            <input
              placeholder="邮箱、IP 或登录方式"
              value={queryDraft}
              onChange={(event) => setQueryDraft(event.target.value)}
            />
          </label>
          <label>
            结果
            <select
              value={successDraft}
              onChange={(event) => setSuccessDraft(event.target.value)}
            >
              <option value="">全部</option>
              <option value="false">失败</option>
              <option value="true">成功</option>
            </select>
          </label>
          <button className="button" type="submit">
            <FileSearch size={16} />
            <span>查询</span>
          </button>
        </form>
        <button
          className="button secondary"
          disabled={isFetching}
          onClick={() => void refetch()}
          type="button"
        >
          <RefreshCw size={16} />
          <span>{isFetching ? "刷新中..." : "刷新"}</span>
        </button>
      </div>

      {error ? (
        <div className="error compact-error">
          {error instanceof Error ? error.message : "登录日志加载失败。"}
        </div>
      ) : null}
      <AdminPanel title="登录记录" description={`已加载 ${logs.length} 条`}>
        <AdminDataTable columns={columns} data={logs} empty="暂无登录日志" />
        <div className="mobile-record-list">
          {logs.map((log) => (
            <MobileRecord
              key={log.id}
              title={log.email ?? log.user?.email ?? "-"}
              meta={dateTime(log.createdAt)}
              badges={<StatusPill status={log.success ? "success" : "failure"} />}
            >
              <MobileField label="方式">{log.method}</MobileField>
              <MobileField label="来源" wide>
                {log.ip ?? "-"}
              </MobileField>
              <MobileField label="用户" wide>
                {log.username ?? log.userId ?? "-"}
              </MobileField>
              <MobileField label="失败原因" wide>
                {log.failureReason ?? "-"}
              </MobileField>
            </MobileRecord>
          ))}
          {logs.length === 0 ? <MobileEmpty>暂无登录日志</MobileEmpty> : null}
        </div>
      </AdminPanel>
    </section>
  );
}
