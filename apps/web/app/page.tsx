import DashboardClient from "./dashboard-client";
import { headers } from "next/headers";
import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

type CharityDashboard = {
  generatedAt: string;
  totals: {
    charityUsers: number;
    requests: number;
    successRequests: number;
    failedRequests: number;
    successRate: number;
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    totalTokens: number;
    chargedAmountUsd: string;
    upstreamCostUsd: string;
  };
  trend30d: Array<{
    date: string;
    requests: number;
    totalTokens: number;
    chargedAmountUsd: string;
  }>;
  ranking: Array<{
    name: string;
    requests: number;
    successRate: number;
    totalTokens: number;
    chargedAmountUsd: string;
  }>;
  models: Array<{
    model: string;
    requests: number;
    successRate: number;
    totalTokens: number;
    chargedAmountUsd: string;
  }>;
};

export default async function Home() {
  const host = (await headers()).get("host") ?? "";
  if (host.split(":")[0] === "free.l-kx.cn") {
    const data = await loadCharityDashboard();
    return <CharityHome data={data} />;
  }

  return <DashboardClient mode="user" />;
}

async function loadCharityDashboard(): Promise<CharityDashboard | null> {
  try {
    const response = await fetch(
      `${serverApiBaseUrl()}/public/charity-dashboard`,
      {
        cache: "no-store",
      },
    );
    if (!response.ok) {
      return null;
    }
    return response.json() as Promise<CharityDashboard>;
  } catch {
    return null;
  }
}

function serverApiBaseUrl() {
  const configured = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (configured) {
    return configured.replace(/\/+$/, "");
  }
  return `http://127.0.0.1:${process.env.API_PORT || "4100"}`;
}

function CharityHome({ data }: { data: CharityDashboard | null }) {
  const totals = data?.totals;
  const trend = data?.trend30d ?? [];
  const models = data?.models ?? [];
  const maxTokens = Math.max(1, ...trend.map((item) => item.totalTokens));
  const maxModelCost = Math.max(
    1,
    ...models.map((item) => Number(item.chargedAmountUsd)),
  );
  const today = trend.at(-1);
  const yesterday = trend.at(-2);

  return (
    <main className="charity-page">
      <section className="charity-top">
        <div className="charity-title-block">
          <span className="charity-status-pill">Public Status</span>
          <h1>APIshare Free</h1>
          <p>公益站实时状态，永久免费，定时轮换 Key，旧 Key 自动失效。</p>
        </div>
        <div className="charity-actions">
          <span className="charity-chip">QQ 群 1054851130</span>
          <span className="charity-chip ok">服务正常</span>
          <span className="charity-chip">5s 自动刷新</span>
          <span className="charity-code">API 地址 https://free.l-kx.cn</span>
        </div>
      </section>

      <section className="charity-service">
        <div className="charity-service-icon">✓</div>
        <div>
          <h2>
            服务状态 <span>正常</span>
          </h2>
          <p>
            服务正常，公益节点维护中。公开聚合用量，不展示请求内容和私密密钥。
          </p>
          <div className="charity-link-row">
            <a href="https://free.l-kx.cn">OpenAI Chat</a>
            <a href="https://free.l-kx.cn">GPT 生图</a>
            <a href="https://free.l-kx.cn">Claude</a>
            <a href="https://free.l-kx.cn">Codex</a>
          </div>
        </div>
      </section>

      <section className="charity-board">
        <Panel
          title="使用统计"
          subtitle="请求、词元与费用"
          badge={`实时请求 ${formatNumber(today?.requests ?? 0)}`}
        >
          <div className="charity-metric-grid">
            <MetricBlock
              label="总请求数"
              value={compactNumber(totals?.requests ?? 0)}
            />
            <MetricBlock
              label="今日请求"
              value={compactNumber(today?.requests ?? 0)}
            />
            <MetricBlock
              label="总计词元"
              value={compactNumber(totals?.totalTokens ?? 0)}
            />
            <MetricBlock
              label="今日词元"
              value={compactNumber(today?.totalTokens ?? 0)}
            />
            <MetricBlock
              label="总计费用"
              value={`$${money(totals?.chargedAmountUsd ?? "0")}`}
            />
            <MetricBlock
              label="今日费用"
              value={`$${money(today?.chargedAmountUsd ?? "0")}`}
            />
          </div>
        </Panel>

        <Panel title="账号状态" subtitle="账号类型、可用和限流">
          <div className="charity-count-grid">
            <MetricBlock
              label="总账号"
              value={formatNumber(totals?.charityUsers ?? 0)}
            />
            <MetricBlock
              label="可用"
              value={formatNumber(totals?.charityUsers ?? 0)}
            />
            <MetricBlock label="限流" value="0" />
            <MetricBlock label="封号" value="0" />
            <MetricBlock
              label="Free"
              value={formatNumber(totals?.charityUsers ?? 0)}
            />
            <MetricBlock label="Api" value={formatNumber(models.length)} />
          </div>
        </Panel>

        <Panel title="缓存 + 健康" subtitle="命中率、延迟和错误率">
          <div className="charity-metric-grid">
            <MetricBlock
              label="今日命中率"
              value={formatPercent(totals?.successRate ?? 0)}
            />
            <MetricBlock
              label="总命中率"
              value={formatPercent(totals?.successRate ?? 0)}
            />
            <MetricBlock
              label="今日缓存 Token"
              value={compactNumber(totals?.cachedInputTokens ?? 0)}
            />
            <MetricBlock
              label="错误率"
              value={formatPercent(1 - (totals?.successRate ?? 0))}
            />
          </div>
        </Panel>

        <Panel
          title="系统负载"
          subtitle="公开服务聚合视图"
          badge="限制 100 RPM"
        >
          <div className="charity-metric-grid">
            <MetricBlock
              label="RPM"
              value={formatNumber(today?.requests ?? 0)}
            />
            <MetricBlock
              label="TPM"
              value={compactNumber(today?.totalTokens ?? 0)}
            />
            <MetricBlock
              label="昨日请求"
              value={formatNumber(yesterday?.requests ?? 0)}
            />
            <MetricBlock
              label="昨日词元"
              value={compactNumber(yesterday?.totalTokens ?? 0)}
            />
          </div>
        </Panel>
      </section>

      <section className="charity-section wide">
        <div className="charity-section-head">
          <div>
            <h2>RPM / TPM 趋势</h2>
            <p>按天动态聚合</p>
          </div>
          <div className="charity-segments">
            <span>30M</span>
            <span>1H</span>
            <span>3H</span>
            <strong>30D</strong>
          </div>
        </div>
        <div className="charity-line-chart">
          <div className="charity-chart">
            {trend.map((item) => (
              <div className="charity-bar" key={item.date}>
                <span
                  style={{
                    height: `${Math.max(3, (item.totalTokens / maxTokens) * 100)}%`,
                  }}
                />
                <i
                  style={{
                    height: `${Math.max(3, (item.requests / Math.max(1, ...trend.map((row) => row.requests))) * 100)}%`,
                  }}
                />
                <small>{item.date.slice(5)}</small>
              </div>
            ))}
          </div>
          <div className="charity-legend">
            <span>RPM</span>
            <span>TPM</span>
          </div>
        </div>
      </section>

      <section className="charity-section wide">
        <div className="charity-section-head">
          <div>
            <h2>模型统计</h2>
            <p>按请求量和计费聚合</p>
          </div>
          <span>IP 排行榜 {formatNumber(data?.ranking.length ?? 0)}</span>
        </div>
        <div className="charity-model-list">
          {models.map((item) => (
            <div className="charity-model-row" key={item.model}>
              <div>
                <strong>{item.model}</strong>
                <em>${money(item.chargedAmountUsd)}</em>
              </div>
              <span>
                <i
                  style={{
                    width: `${Math.max(2, (Number(item.chargedAmountUsd) / maxModelCost) * 100)}%`,
                  }}
                />
              </span>
              <p>
                {formatNumber(item.requests)} requests{" "}
                <b>{compactNumber(item.totalTokens)} tokens</b>
              </p>
            </div>
          ))}
          {models.length ? null : (
            <p className="charity-empty">暂无公益调用记录。</p>
          )}
        </div>
      </section>

      <section className="charity-section wide">
        <div className="charity-section-head">
          <div>
            <h2>公益项目</h2>
            <p>按 Tokens 排序</p>
          </div>
        </div>
        <div className="charity-rank">
          {(data?.ranking ?? []).map((item, index) => (
            <div className="charity-rank-row" key={`${item.name}-${index}`}>
              <b>{index + 1}</b>
              <span>{item.name}</span>
              <em>{formatNumber(item.totalTokens)} Tokens</em>
            </div>
          ))}
          {data?.ranking.length ? null : (
            <p className="charity-empty">暂无公益调用记录。</p>
          )}
        </div>
      </section>
    </main>
  );
}

function MetricBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="charity-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Panel({
  title,
  subtitle,
  badge,
  children,
}: {
  title: string;
  subtitle: string;
  badge?: string;
  children: ReactNode;
}) {
  return (
    <div className="charity-panel">
      <div className="charity-panel-head">
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        {badge ? <span>{badge}</span> : null}
      </div>
      {children}
    </div>
  );
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function compactNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function money(value: string) {
  return Number(value).toFixed(4);
}
