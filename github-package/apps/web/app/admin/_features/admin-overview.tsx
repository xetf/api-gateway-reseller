"use client";

import { useEffect } from "react";
import { dateTime, formatBytes, formatDuration, formatLoadAverage, formatNumber, formatPercent, money } from "../_components/admin-format";
import { useAdminResource } from "../_components/admin-hooks";
import { InfoLine, Metric, StatusPill, StatusTile } from "../_components/admin-ui";

type AdminOverview = {
  users: number;
  requests: number;
  totalWalletBalance: string;
  revenue: string;
  upstreamCost: string;
  grossProfit: string;
  totalTokens: number;
};

type SetupWizardStatus = {
  completed: number;
  total: number;
  percent: number;
  steps: Array<{ id: string; label: string; detail: string; completed: boolean }>;
};

type ServerStatus = {
  server: {
    nodeVersion: string;
    uptimeSeconds: number;
    memory: { rss: number; heapTotal: number; heapUsed: number; external: number; arrayBuffers: number };
    system: { platform: string; arch: string; cpuCount: number; loadAverage: number[]; totalMemoryBytes: number; freeMemoryBytes: number; usedMemoryBytes: number; memoryUsagePercent: number; cpuUsagePercent: number | null };
    cpu: { userMicros: number; systemMicros: number; percent: number | null };
    database: { ok: boolean; latencyMs?: number; error?: string };
    redis: { ok: boolean; latencyMs?: number; error?: string };
    pm2: { ok: boolean; processes?: Array<{ name: string; status: string; cpu?: number; memory?: number }>; error?: string };
  };
  apiKeys: {
    activeConcurrency: number;
    currentMinuteRequests: number;
    monitoredKeys: number;
    limitedKeys: number;
    sample: Array<{ id: string; name: string; keyPrefix: string; currentConcurrency: number; concurrencyLimit: number; currentMinuteRequests: number; rateLimitPerMinute: number }>;
  };
  modelPool: {
    totalChannels: number;
    activeChannels: number;
    penalizedChannels: number;
    unavailableChannels: number;
    recoveringChannels: number;
    inflightRequests: number;
    autoCheckEnabledPools: number;
    healthCheckIntervalSeconds: number;
    channels: Array<{ model: string; upstreamProvider: string; effectiveStatus: string; inflightRequests: number; activeKeys: number }>;
    upstreamKeys: { total: number; active: number; inflightRequests: number };
  };
  alerts: Array<{ severity: "info" | "warning" | "critical"; title: string; message: string }>;
  checkedAt: string;
};

function errorToText(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "操作失败，请稍后再试。";
}

export function AdminOverviewPage({ onError }: { onError: (error: string | null) => void }) {
  const overview = useAdminResource<AdminOverview>("overview", "/admin/overview");
  const wizard = useAdminResource<{ wizard: SetupWizardStatus }>("setupWizard", "/admin/setup-wizard");
  const server = useAdminResource<ServerStatus>("serverStatus", "/admin/server-status");

  useEffect(() => {
    const timer = setInterval(() => void server.refetch(), 5000);
    return () => clearInterval(timer);
  }, [server.refetch]);

  useEffect(() => {
    const firstError = overview.error ?? wizard.error ?? server.error;
    onError(firstError ? errorToText(firstError) : null);
  }, [overview.error, wizard.error, server.error, onError]);

  return (
    <AdminOverviewPanel
      overview={overview.data ?? null}
      setupWizard={wizard.data?.wizard ?? null}
      serverStatus={server.data ?? null}
    />
  );
}

function AdminOverviewPanel({
  overview,
  serverStatus,
  setupWizard,
}: {
  overview: AdminOverview | null;
  serverStatus: ServerStatus | null;
  setupWizard: SetupWizardStatus | null;
}) {
  const latestKeyStats = serverStatus?.apiKeys.sample.slice(0, 4) ?? [];
  const latestChannelStats =
    serverStatus?.modelPool.channels
      .slice()
      .sort((a, b) => (b.inflightRequests ?? 0) - (a.inflightRequests ?? 0))
      .slice(0, 4) ?? [];

  return (
    <div className="grid admin-page admin-dashboard-page">
      <section className="admin-hero-panel">
        <div>
          <span className="eyebrow">Control Overview</span>
          <h2>运营驾驶舱</h2>
          <p>先看经营指标，再看配置进度和实时健康状态。日常巡检不用在多个卡片之间来回跳。</p>
        </div>
        <div className="admin-hero-status">
          <StatusTile
            label="初始化"
            ok={
              setupWizard
                ? setupWizard.completed === setupWizard.total
                : undefined
            }
            value={`${setupWizard?.completed ?? 0}/${setupWizard?.total ?? 0}`}
          />
          <StatusTile
            label="网关"
            ok={serverStatus?.server.database.ok && serverStatus?.server.redis.ok}
            value={serverStatus ? dateTime(serverStatus.checkedAt) : "加载中"}
          />
        </div>
      </section>
      <div className="admin-kpi-strip">
        <Metric label="用户数" value={String(overview?.users ?? 0)} />
        <Metric label="总请求数" value={String(overview?.requests ?? 0)} />
        <Metric
          label="总 token"
          value={formatNumber(overview?.totalTokens ?? 0)}
        />
        <Metric
          label="客户扣费"
          value={`$${money(overview?.revenue ?? "0")}`}
        />
        <Metric
          label="上游成本"
          value={`$${money(overview?.upstreamCost ?? "0")}`}
        />
        <Metric
          label="毛利"
          value={`$${money(overview?.grossProfit ?? "0")}`}
        />
      </div>
      <div className="admin-dashboard-grid">
        <section className="card admin-command-card">
          <div className="card-head">
            <div>
              <h2 className="section-title">首次配置向导</h2>
              <p className="section-subtitle">按上线顺序检查关键配置是否已经完成。</p>
            </div>
            <StatusPill
              status={
                setupWizard && setupWizard.completed === setupWizard.total
                  ? "READY"
                  : "WAITING"
              }
            />
          </div>
          <div className="admin-progress-card">
            <strong>{setupWizard?.percent ?? 0}%</strong>
            <span>{setupWizard?.completed ?? 0} / {setupWizard?.total ?? 0}</span>
            <p>
              下一步：{setupWizard?.steps.find((step) => !step.completed)?.label ?? "已完成"}
            </p>
          </div>
          <div className="admin-step-list">
            {(setupWizard?.steps ?? []).map((step) => (
              <div className={step.completed ? "admin-step done" : "admin-step"} key={step.id}>
                <span>{step.completed ? "✓" : "•"}</span>
                <div>
                  <strong>{step.label}</strong>
                  <small>{step.detail}</small>
                </div>
              </div>
            ))}
            {!setupWizard ? <InfoLine label="状态" value="加载中" /> : null}
          </div>
        </section>
        <section className="card admin-command-card">
          <h2 className="section-title">资金概览</h2>
          <div className="info-list">
            <InfoLine
              label="用户余额总额"
              value={`$${money(overview?.totalWalletBalance ?? "0")}`}
            />
            <InfoLine
              label="累计收入"
              value={`$${money(overview?.revenue ?? "0")}`}
            />
            <InfoLine
              label="累计成本"
              value={`$${money(overview?.upstreamCost ?? "0")}`}
            />
          </div>
        </section>
      </div>
      <section className="card admin-monitor-panel">
        <div className="card-head">
          <div>
            <h2 className="section-title">实时状态</h2>
            <p className="section-subtitle">
              前端每 5 秒轮询一次，展示服务器、网关并发和模型池当前负载。
            </p>
          </div>
          <span className="muted">
            更新于 {serverStatus ? dateTime(serverStatus.checkedAt) : "-"}
          </span>
        </div>
        <div className="grid cols-3 metric-row monitor-metrics">
          <Metric
            label="服务器 CPU"
            value={`${formatPercent(serverStatus?.server.system.cpuUsagePercent ?? null)}`}
            caption={`进程 ${formatPercent(serverStatus?.server.cpu.percent ?? null)} · 负载 ${formatLoadAverage(serverStatus?.server.system.loadAverage)}`}
          />
          <Metric
            label="系统内存"
            value={`${formatPercent(serverStatus?.server.system.memoryUsagePercent ?? null)}`}
            caption={`${formatBytes(serverStatus?.server.system.usedMemoryBytes)} / ${formatBytes(serverStatus?.server.system.totalMemoryBytes)}`}
            small
          />
          <Metric
            label="进程内存"
            value={`${formatBytes(serverStatus?.server.memory.heapUsed)} / ${formatBytes(serverStatus?.server.memory.heapTotal)}`}
            small
          />
        </div>
        <div className="grid cols-3 metric-row monitor-metrics">
          <Metric
            label="API Key 当前并发"
            value={String(serverStatus?.apiKeys.activeConcurrency ?? 0)}
            caption={`当前分钟 ${serverStatus?.apiKeys.currentMinuteRequests ?? 0} 次`}
          />
          <Metric
            label="模型池进行中"
            value={String(serverStatus?.modelPool.inflightRequests ?? 0)}
            caption={`可用 ${serverStatus?.modelPool.activeChannels ?? 0} / 惩罚 ${serverStatus?.modelPool.penalizedChannels ?? 0} / 总 ${serverStatus?.modelPool.totalChannels ?? 0}`}
          />
          <Metric
            label="运行时间"
            value={formatDuration(serverStatus?.server.uptimeSeconds ?? 0)}
            caption={serverStatus?.server.nodeVersion ?? "-"}
            small
          />
        </div>
        <div className="monitor-status-grid">
          <StatusTile
            label="Redis"
            ok={serverStatus?.server.redis.ok}
            value={
              serverStatus?.server.redis.ok
                ? `${serverStatus.server.redis.latencyMs ?? 0} ms`
                : (serverStatus?.server.redis.error ?? "-")
            }
          />
          <StatusTile
            label="数据库"
            ok={serverStatus?.server.database.ok}
            value={
              serverStatus?.server.database.ok
                ? `${serverStatus.server.database.latencyMs ?? 0} ms`
                : (serverStatus?.server.database.error ?? "-")
            }
          />
          <StatusTile
            label="PM2"
            ok={serverStatus?.server.pm2.ok}
            value={
              (serverStatus?.server.pm2.processes ?? [])
                .map((process) => `${process.name}:${process.status}`)
                .join(" · ") || "-"
            }
          />
        </div>
        <div className="audit-stack">
          {(serverStatus?.alerts ?? []).map((alert) => (
            <div
              className={
                alert.severity === "critical"
                  ? "notice danger"
                  : alert.severity === "warning"
                    ? "notice"
                    : "success compact-success"
              }
              key={`${alert.severity}:${alert.title}`}
            >
              <strong>{alert.title}</strong>
              <span>{alert.message}</span>
            </div>
          ))}
        </div>
        <div className="monitor-split">
          <div className="info-list compact-info-list">
            <InfoLine
              label="模型池"
              value={`检测 ${serverStatus?.modelPool.autoCheckEnabledPools ?? 0} / 惩罚 ${serverStatus?.modelPool.penalizedChannels ?? 0} / 不可用 ${serverStatus?.modelPool.unavailableChannels ?? 0}`}
            />
            <InfoLine
              label="恢复待确认"
              value={`${serverStatus?.modelPool.recoveringChannels ?? 0} 个渠道`}
            />
            <InfoLine
              label="检测间隔"
              value={`${serverStatus?.modelPool.healthCheckIntervalSeconds ?? 0} 秒`}
            />
            {latestChannelStats.length > 0 ? (
              <InfoLine
                label="渠道负载"
                value={latestChannelStats
                  .map(
                    (channel) => `${channel.model}:${channel.inflightRequests}`,
                  )
                  .join(" · ")}
              />
            ) : null}
          </div>
          <div className="info-list compact-info-list">
            <InfoLine
              label="限额 Key"
              value={`监控 ${serverStatus?.apiKeys.monitoredKeys ?? 0} / 有限制 ${serverStatus?.apiKeys.limitedKeys ?? 0}`}
            />
            <InfoLine
              label="上游 Key"
              value={`总 ${serverStatus?.modelPool.upstreamKeys?.total ?? 0} / 可用 ${serverStatus?.modelPool.upstreamKeys?.active ?? 0} / 进行中 ${serverStatus?.modelPool.upstreamKeys?.inflightRequests ?? 0}`}
            />
            {latestKeyStats.length > 0 ? (
              <InfoLine
                label="Key 实时"
                value={latestKeyStats
                  .map(
                    (apiKey) =>
                      `${apiKey.name || apiKey.keyPrefix}: 并发 ${apiKey.currentConcurrency}/${apiKey.concurrencyLimit || "-"} · ${apiKey.currentMinuteRequests}/${apiKey.rateLimitPerMinute}/min`,
                  )
                  .join(" · ")}
              />
            ) : (
              <InfoLine label="Key 实时" value="暂无受限 Key" />
            )}
          </div>
        </div>
        <div className="info-list monitor-process-list">
          <InfoLine
            label="PM2 进程"
            value={
              (serverStatus?.server.pm2.processes ?? [])
                .map((process) => `${process.name}:${process.status}`)
                .join(" · ") || "-"
            }
          />
        </div>
      </section>
    </div>
  );
}
