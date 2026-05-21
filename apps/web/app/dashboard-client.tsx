"use client";

import {
  Activity,
  BarChart3,
  CreditCard,
  KeyRound,
  LogOut,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Send,
  Server,
  Shield,
  SlidersHorizontal,
  Ticket,
  Trash2,
  Users,
} from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { apiBaseUrl, apiFetch, clearToken, getToken, setToken } from "../lib/api";

type User = {
  id: string;
  email: string;
  username?: string | null;
  name?: string | null;
  role: "USER" | "ADMIN";
  status: "ACTIVE" | "DISABLED" | string;
  allowedModels: string[];
  createdAt?: string;
  wallet?: Wallet | null;
};

type Wallet = {
  id: string;
  balance: string;
  currency: string;
};

type ApiKey = {
  id: string;
  name: string;
  keyPrefix: string;
  keySecret?: string | null;
  status: "ACTIVE" | "DISABLED" | "REVOKED" | string;
  rateLimitPerMinute: number;
  allowedModels: string[];
  lastUsedAt?: string | null;
  createdAt: string;
};

type ApiRequest = {
  id: string;
  model: string;
  endpoint: string;
  method?: string;
  status: string;
  httpStatus?: number | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  chargedAmountUsd: string;
  upstreamCostUsd?: string;
  latencyMs?: number | null;
  errorMessage?: string | null;
  createdAt: string;
  user?: {
    email: string;
  };
};

type Transaction = {
  id: string;
  type: string;
  amount: string;
  balanceBefore: string;
  balanceAfter: string;
  remark?: string | null;
  createdAt: string;
};

type Summary = {
  totals: {
    requests: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    chargedAmountUsd: number;
  };
  requests: ApiRequest[];
};

type AdminOverview = {
  users: number;
  requests: number;
  totalWalletBalance: string;
  revenue: string;
  upstreamCost: string;
  grossProfit: string;
  totalTokens: number;
};

type AdminUser = User & {
  createdAt: string;
  wallet?: Wallet | null;
  walletTransactions?: Transaction[];
  _count: {
    apiKeys: number;
    apiRequests: number;
  };
};

type UpstreamProvider = {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  status: "ACTIVE" | "DISABLED";
  priority: number;
  timeoutMs: number;
  createdAt: string;
  updatedAt: string;
};

type ModelPrice = {
  id: string;
  model: string;
  upstreamProvider: string;
  currency: string;
  upstreamInputPer1MTok: string;
  upstreamCachedInputPer1MTok: string;
  upstreamOutputPer1MTok: string;
  upstreamPriceMultiplier: string;
  customerInputPer1MTok: string;
  customerCachedInputPer1MTok: string;
  customerOutputPer1MTok: string;
  customerPriceMultiplier: string;
  minimumChargeUsd: string;
  enabled: boolean;
};

type RedeemCode = {
  id: string;
  code?: string;
  codePrefix: string;
  amount: string;
  currency: string;
  status: "ACTIVE" | "DISABLED";
  maxRedemptions: number;
  redeemedCount: number;
  expiresAt?: string | null;
  remark?: string | null;
  createdAt: string;
  redemptions?: Array<{
    id: string;
    amount: string;
    createdAt: string;
    user: {
      email: string;
    };
  }>;
};

type RequestFilters = {
  q: string;
  userId: string;
  model: string;
  status: "" | "PENDING" | "SUCCESS" | "FAILED";
  dateFrom: string;
  dateTo: string;
};

const frontNav = [
  { id: "overview", label: "前台总览", icon: BarChart3 },
  { id: "keys", label: "API Key", icon: KeyRound },
  { id: "wallet", label: "余额兑换", icon: CreditCard },
  { id: "requests", label: "我的调用", icon: Activity },
  { id: "test", label: "调用测试", icon: Send },
] as const;

const adminNav = [
  { id: "admin-overview", label: "后台总览", icon: Shield },
  { id: "admin-upstreams", label: "上游管理", icon: Server },
  { id: "admin-users", label: "用户管理", icon: Users },
  { id: "admin-redeem", label: "兑换码", icon: Ticket },
  { id: "admin-prices", label: "价格管理", icon: SlidersHorizontal },
  { id: "admin-requests", label: "全站调用", icon: Activity },
] as const;

type FrontTab = (typeof frontNav)[number]["id"];
type AdminTab = (typeof adminNav)[number]["id"];
type Tab = FrontTab | AdminTab;
type DashboardMode = "user" | "admin";

export default function DashboardClient({ mode }: { mode: DashboardMode }) {
  const [token, setTokenState] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>(
    mode === "admin" ? "admin-overview" : "overview",
  );
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [adminOverview, setAdminOverview] = useState<AdminOverview | null>(null);
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [adminRequests, setAdminRequests] = useState<ApiRequest[]>([]);
  const [upstreamProviders, setUpstreamProviders] = useState<UpstreamProvider[]>([]);
  const [modelPrices, setModelPrices] = useState<ModelPrice[]>([]);
  const [redeemCodes, setRedeemCodes] = useState<RedeemCode[]>([]);
  const [requestFilters, setRequestFilters] = useState<RequestFilters>({
    q: "",
    userId: "",
    model: "",
    status: "",
    dateFrom: "",
    dateTo: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const saved = getToken();
    if (saved) {
      setTokenState(saved);
      void refreshAll(saved);
    }
  }, [mode]);

  async function refreshAll(authToken = token) {
    if (!authToken) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const me = await apiFetch<{ user: User }>("/auth/me", { token: authToken });
      if (mode === "admin" && me.user.role !== "ADMIN") {
        throw new Error("请使用管理员账号登录后台。");
      }
      if (mode === "user" && me.user.role === "ADMIN") {
        throw new Error("管理员请从 /admin 登录后台。");
      }
      setUser(me.user);

      if (mode === "user") {
        const [keysResult, walletResult, usageResult] = await Promise.all([
          apiFetch<{ apiKeys: ApiKey[] }>("/api-keys", { token: authToken }),
          apiFetch<{ wallet: Wallet | null; transactions: Transaction[] }>("/wallet", {
            token: authToken,
          }),
          apiFetch<Summary>("/usage/summary", { token: authToken }),
        ]);
        setApiKeys(keysResult.apiKeys);
        setWallet(walletResult.wallet);
        setTransactions(walletResult.transactions);
        setSummary(usageResult);
      } else {
        setApiKeys([]);
        setWallet(null);
        setTransactions([]);
        setSummary(null);
      }

      if (mode === "admin") {
        const [
          overviewResult,
          usersResult,
          providersResult,
          pricesResult,
          codesResult,
          requestsResult,
        ] = await Promise.all([
          apiFetch<AdminOverview>("/admin/overview", { token: authToken }),
          apiFetch<{ users: AdminUser[] }>("/admin/users", { token: authToken }),
          apiFetch<{ providers: UpstreamProvider[] }>("/admin/upstream-providers", {
            token: authToken,
          }),
          apiFetch<{ modelPrices: ModelPrice[] }>("/admin/model-prices", {
            token: authToken,
          }),
          apiFetch<{ codes: RedeemCode[] }>("/admin/redeem-codes", {
            token: authToken,
          }),
          apiFetch<{ requests: ApiRequest[] }>(
            `/admin/requests${toQueryString(requestFilters)}`,
            {
            token: authToken,
            },
          ),
        ]);
        setAdminOverview(overviewResult);
        setAdminUsers(usersResult.users);
        setUpstreamProviders(providersResult.providers);
        setModelPrices(pricesResult.modelPrices);
        setRedeemCodes(codesResult.codes);
        setAdminRequests(requestsResult.requests);
      } else {
        setAdminOverview(null);
        setAdminUsers([]);
        setUpstreamProviders([]);
        setModelPrices([]);
        setRedeemCodes([]);
        setAdminRequests([]);
      }
    } catch (refreshError) {
      setError(errorToText(refreshError));
      clearToken();
      setTokenState(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }

  function logout() {
    clearToken();
    setTokenState(null);
    setUser(null);
    setActiveTab(mode === "admin" ? "admin-overview" : "overview");
  }

  if (!token || !user) {
    return (
      <Login
        mode={mode}
        onLogin={(nextToken, nextUser) => {
          setToken(nextToken);
          setTokenState(nextToken);
          setUser(nextUser);
          setActiveTab(mode === "admin" ? "admin-overview" : "overview");
          void refreshAll(nextToken);
        }}
      />
    );
  }

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">A</span>
          API Gateway
        </div>
        <nav className="nav">
          <div className="nav-heading">{mode === "admin" ? "后台" : "前台"}</div>
          {(mode === "admin" ? adminNav : frontNav).map((item) => (
            <NavButton
              key={item.id}
              item={item}
              active={activeTab === item.id}
              onClick={() => setActiveTab(item.id)}
            />
          ))}
        </nav>
      </aside>
      <section className="main">
        <div className="topbar">
          <div>
            <h1>{titleForTab(activeTab)}</h1>
            <p>
              {mode === "admin" ? user.username ?? user.email : user.email}
              {user.role === "ADMIN" ? " · 管理员" : ""}
            </p>
          </div>
          <div className="button-row">
            <button className="button secondary" onClick={() => refreshAll()} type="button">
              <RefreshCw size={17} />
              刷新
            </button>
            <button className="button secondary" onClick={logout} type="button">
              <LogOut size={17} />
              退出
            </button>
          </div>
        </div>

        {error ? <div className="notice">{error}</div> : null}
        {loading ? <p className="muted">加载中...</p> : null}

        {mode === "user" && activeTab === "overview" ? (
          <Overview wallet={wallet} summary={summary} apiKeys={apiKeys} />
        ) : null}
        {mode === "user" && activeTab === "keys" ? (
          <Keys apiKeys={apiKeys} onChanged={() => refreshAll()} onError={setError} />
        ) : null}
        {mode === "user" && activeTab === "wallet" ? (
          <WalletView
            wallet={wallet}
            transactions={transactions}
            onChanged={() => refreshAll()}
            onError={setError}
          />
        ) : null}
        {mode === "user" && activeTab === "requests" ? <Requests requests={summary?.requests ?? []} /> : null}
        {mode === "user" && activeTab === "test" ? (
          <CallTester onChanged={() => refreshAll()} onError={setError} />
        ) : null}
        {mode === "admin" && activeTab === "admin-overview" ? (
          <AdminOverviewPanel overview={adminOverview} />
        ) : null}
        {mode === "admin" && activeTab === "admin-upstreams" ? (
          <UpstreamProviders
            providers={upstreamProviders}
            onChanged={() => refreshAll()}
            onError={setError}
          />
        ) : null}
        {mode === "admin" && activeTab === "admin-users" ? (
          <AdminUsers
            users={adminUsers}
            modelPrices={modelPrices}
            onChanged={() => refreshAll()}
            onError={setError}
          />
        ) : null}
        {mode === "admin" && activeTab === "admin-redeem" ? (
          <AdminRedeemCodes
            codes={redeemCodes}
            onChanged={() => refreshAll()}
            onError={setError}
          />
        ) : null}
        {mode === "admin" && activeTab === "admin-prices" ? (
          <ModelPrices
            modelPrices={modelPrices}
            onChanged={() => refreshAll()}
            onError={setError}
          />
        ) : null}
        {mode === "admin" && activeTab === "admin-requests" ? (
          <AdminRequests
            requests={adminRequests}
            users={adminUsers}
            filters={requestFilters}
            onFiltersChange={setRequestFilters}
            onSearch={() => refreshAll()}
          />
        ) : null}
      </section>
    </main>
  );
}

function NavButton({
  item,
  active,
  onClick,
}: {
  item: { id: string; label: string; icon: typeof BarChart3 };
  active: boolean;
  onClick: () => void;
}) {
  const Icon = item.icon;
  return (
    <button className={active ? "active" : ""} onClick={onClick} type="button">
      <Icon size={18} />
      {item.label}
    </button>
  );
}

function Login({
  mode,
  onLogin,
}: {
  mode: DashboardMode;
  onLogin: (token: string, user: User) => void;
}) {
  const [identifier, setIdentifier] = useState(mode === "admin" ? "admin" : "");
  const [password, setPassword] = useState(mode === "admin" ? "Gateway@2026#Secure" : "");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const result =
        mode === "admin"
          ? await apiFetch<{ token: string; user: User }>("/auth/admin-login", {
              method: "POST",
              body: JSON.stringify({ username: identifier, password }),
              token: null,
            })
          : await apiFetch<{ token: string; user: User }>("/auth/login", {
              method: "POST",
              body: JSON.stringify({ email: identifier, password }),
              token: null,
            });
      onLogin(result.token, result.user);
    } catch (loginError) {
      setError(errorToText(loginError));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-page">
      <div className="login-panel">
        <h1>{mode === "admin" ? "Admin Console" : "API Gateway"}</h1>
        <p>{mode === "admin" ? "管理员后台入口。" : "登录后管理 API Key、余额和调用账单。"}</p>
        <form className="form" onSubmit={submit}>
          <label className="field">
            <span>{mode === "admin" ? "用户名" : "邮箱"}</span>
            <input
              className="input"
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              type={mode === "admin" ? "text" : "email"}
            />
          </label>
          <label className="field">
            <span>密码</span>
            <input
              className="input"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
            />
          </label>
          {error ? <div className="error">{error}</div> : null}
          <button className="button" disabled={loading} type="submit">
            {loading ? "登录中..." : "登录"}
          </button>
        </form>
      </div>
    </main>
  );
}

function Overview({
  wallet,
  summary,
  apiKeys,
}: {
  wallet: Wallet | null;
  summary: Summary | null;
  apiKeys: ApiKey[];
}) {
  return (
    <div className="grid">
      <div className="grid cols-3">
        <Metric
          label="当前余额"
          value={`$${money(wallet?.balance ?? "0")}`}
          caption={wallet?.currency ?? "USD"}
        />
        <Metric label="30 天请求数" value={String(summary?.totals.requests ?? 0)} />
        <Metric
          label="活跃 Key"
          value={String(apiKeys.filter((key) => key.status === "ACTIVE").length)}
        />
      </div>
      <div className="grid cols-3">
        <Metric label="总 token" value={formatNumber(summary?.totals.totalTokens ?? 0)} />
        <Metric label="我的扣费" value={`$${money(summary?.totals.chargedAmountUsd ?? 0)}`} />
        <Metric label="Base URL" value={apiBaseUrl.replace(/^https?:\/\//, "")} small />
      </div>
      <BaseUrlPanel />
      <Requests requests={summary?.requests.slice(0, 8) ?? []} compact />
    </div>
  );
}

function BaseUrlPanel() {
  return (
    <section className="card">
      <h2 className="section-title">接入地址</h2>
      <div className="endpoint-grid">
        <CopyField label="Base URL" value={apiBaseUrl} />
        <CopyField label="Responses" value={`${apiBaseUrl}/v1/responses`} />
        <CopyField label="Chat Completions" value={`${apiBaseUrl}/v1/chat/completions`} />
      </div>
    </section>
  );
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard?.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <div className="copy-field">
      <span>{label}</span>
      <code>{value}</code>
      <button className="button secondary icon-button" onClick={copy} type="button">
        {copied ? <Save size={16} /> : <Pencil size={16} />}
      </button>
    </div>
  );
}

function Keys({
  apiKeys,
  onChanged,
  onError,
}: {
  apiKeys: ApiKey[];
  onChanged: () => void;
  onError: (error: string | null) => void;
}) {
  const [name, setName] = useState("default");
  const [rateLimit, setRateLimit] = useState(60);
  const [secret, setSecret] = useState<string | null>(null);
  const [busyKeyId, setBusyKeyId] = useState<string | null>(null);
  const [configKey, setConfigKey] = useState<ApiKey | null>(null);

  async function createKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onError(null);
    try {
      const result = await apiFetch<{ apiKey: ApiKey; secret: string }>("/api-keys", {
        method: "POST",
        body: JSON.stringify({
          name,
          rateLimitPerMinute: Number(rateLimit),
          allowedModels: [],
        }),
      });
      const createdKey = {
        ...result.apiKey,
        keySecret: result.apiKey.keySecret ?? result.secret,
      };
      setSecret(result.secret);
      setConfigKey(createdKey);
      onChanged();
    } catch (createError) {
      onError(errorToText(createError));
    }
  }

  async function updateKeyStatus(key: ApiKey, status: "ACTIVE" | "DISABLED" | "REVOKED") {
    onError(null);
    setBusyKeyId(key.id);
    try {
      await apiFetch(`/api-keys/${key.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      onChanged();
    } catch (updateError) {
      onError(errorToText(updateError));
    } finally {
      setBusyKeyId(null);
    }
  }

  return (
    <>
      <div className="grid cols-2">
        <section className="card">
          <h2 className="section-title">创建 API Key</h2>
          <form className="form" onSubmit={createKey}>
            <label className="field">
              <span>名称</span>
              <input className="input" value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <label className="field">
              <span>每分钟限流</span>
              <input
                className="input"
                value={rateLimit}
                min={1}
                max={10000}
                onChange={(event) => setRateLimit(Number(event.target.value))}
                type="number"
              />
            </label>
            <button className="button" type="submit">
              <Plus size={17} />
              创建
            </button>
          </form>
          {secret ? (
            <div className="stack-top">
              <div className="notice">API Key 已创建，可在列表中一直查看和配置。</div>
              <div className="secret">{secret}</div>
            </div>
          ) : null}
        </section>
        <section className="card wide-card">
          <h2 className="section-title">API Key 列表</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>名称</th>
                  <th>API Key</th>
                  <th>状态</th>
                  <th>限流</th>
                  <th>创建时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {apiKeys.map((key) => (
                  <tr key={key.id}>
                    <td>{key.name}</td>
                    <td>
                      <code className="inline-secret">{key.keySecret ?? key.keyPrefix}</code>
                    </td>
                    <td>
                      <StatusPill status={key.status} />
                    </td>
                    <td>{key.rateLimitPerMinute}/min</td>
                    <td>{dateTime(key.createdAt)}</td>
                    <td>
                      <div className="button-row compact">
                        <button
                          className="button secondary"
                          disabled={!key.keySecret}
                          onClick={() => setConfigKey(key)}
                          type="button"
                        >
                          使用 / 配置
                        </button>
                        {key.status === "ACTIVE" ? (
                          <button
                            className="button secondary"
                            disabled={busyKeyId === key.id}
                            onClick={() => updateKeyStatus(key, "DISABLED")}
                            type="button"
                          >
                            停用
                          </button>
                        ) : (
                          <button
                            className="button"
                            disabled={busyKeyId === key.id || key.status === "REVOKED"}
                            onClick={() => updateKeyStatus(key, "ACTIVE")}
                            type="button"
                          >
                            启用
                          </button>
                        )}
                        <button
                          className="button danger"
                          disabled={busyKeyId === key.id || key.status === "REVOKED"}
                          onClick={() => updateKeyStatus(key, "REVOKED")}
                          type="button"
                        >
                          吊销
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {apiKeys.length === 0 ? <EmptyRow colSpan={6} /> : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>
      {configKey?.keySecret ? (
        <ApiKeyConfigModal apiKey={configKey.keySecret} onClose={() => setConfigKey(null)} />
      ) : null}
    </>
  );
}

function ApiKeyConfigModal({ apiKey, onClose }: { apiKey: string; onClose: () => void }) {
  const [tool, setTool] = useState("Codex CLI");
  const [os, setOs] = useState("macOS / Linux");
  const configPath = os === "Windows" ? "%USERPROFILE%\\.codex\\config.toml" : "~/.codex/config.toml";
  const authPath = os === "Windows" ? "%USERPROFILE%\\.codex\\auth.json" : "~/.codex/auth.json";
  const mkdirCommand = os === "Windows" ? "mkdir %USERPROFILE%\\.codex" : "mkdir -p ~/.codex";
  const config = codexConfigToml(tool);
  const auth = JSON.stringify({ OPENAI_API_KEY: apiKey }, null, 2);

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="config-modal" role="dialog" aria-modal="true" aria-label="使用 API 密钥">
        <div className="modal-header">
          <div>
            <h2>使用 API 密钥</h2>
            <p>将以下配置文件添加到 Codex CLI 配置目录中。</p>
          </div>
          <button className="modal-close" onClick={onClose} type="button">
            ×
          </button>
        </div>
        <div className="tab-row">
          {["Codex CLI", "Codex CLI (WebSocket)", "Claude Code", "OpenCode"].map((item) => (
            <button
              className={tool === item ? "tab active" : "tab"}
              key={item}
              onClick={() => setTool(item)}
              type="button"
            >
              ▻ {item}
            </button>
          ))}
        </div>
        <div className="tab-row os-tabs">
          {["macOS / Linux", "Windows"].map((item) => (
            <button
              className={os === item ? "tab active" : "tab"}
              key={item}
              onClick={() => setOs(item)}
              type="button"
            >
              {item}
            </button>
          ))}
        </div>
        <div className="config-tip">请确保以下内容位于 config.toml 文件的开头部分。</div>
        <ConfigBlock title={configPath} value={config} />
        <ConfigBlock title={authPath} value={auth} />
        <div className="info-box">请确保配置目录存在。{os} 用户可运行 <code>{mkdirCommand}</code> 创建目录。</div>
      </div>
    </div>
  );
}

function ConfigBlock({ title, value }: { title: string; value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard?.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <div className="config-block">
      <div className="config-block-title">
        <span>{title}</span>
        <button onClick={copy} type="button">{copied ? "已复制" : "复制"}</button>
      </div>
      <pre>{value}</pre>
    </div>
  );
}

function codexConfigToml(tool: string) {
  const providerName = tool === "Codex CLI (WebSocket)" ? "codex_local_access" : "OpenAI";

  return `model_provider = "${providerName}"
model = "gpt-5.5"
review_model = "gpt-5.5"
model_reasoning_effort = "xhigh"
disable_response_storage = true
network_access = "enabled"
windows_wsl_setup_acknowledged = true
model_context_window = 1000000
model_auto_compact_token_limit = 900000

[model_providers.OpenAI]
name = "OpenAI"
base_url = "${apiBaseUrl}"
wire_api = "responses"
requires_openai_auth = true

[model_providers.codex_local_access]
name = "OpenAI"
base_url = "${apiBaseUrl}"
wire_api = "responses"
requires_openai_auth = true`;
}

function WalletView({
  wallet,
  transactions,
  onChanged,
  onError,
}: {
  wallet: Wallet | null;
  transactions: Transaction[];
  onChanged: () => void;
  onError: (error: string | null) => void;
}) {
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  async function redeem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onError(null);
    setMessage(null);
    try {
      const result = await apiFetch<{ redeemed: { amount: string; currency: string } }>(
        "/redeem-codes/redeem",
        {
          method: "POST",
          body: JSON.stringify({ code }),
        },
      );
      setCode("");
      setMessage(`已兑换 $${money(result.redeemed.amount)} ${result.redeemed.currency}`);
      onChanged();
    } catch (redeemError) {
      onError(errorToText(redeemError));
    }
  }

  return (
    <div className="grid">
      <div className="grid cols-3">
        <Metric label="余额" value={`$${money(wallet?.balance ?? "0")}`} />
        <Metric label="币种" value={wallet?.currency ?? "USD"} />
        <Metric label="流水数量" value={String(transactions.length)} />
      </div>
      <section className="card">
        <h2 className="section-title">兑换余额</h2>
        <form className="form inline-form" onSubmit={redeem}>
          <label className="field">
            <span>兑换码</span>
            <input
              className="input"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="rdm_..."
            />
          </label>
          <button className="button" type="submit">
            <Ticket size={17} />
            兑换
          </button>
        </form>
        {message ? <div className="success">{message}</div> : null}
      </section>
      <Transactions transactions={transactions} />
    </div>
  );
}

function Transactions({ transactions }: { transactions: Transaction[] }) {
  return (
    <section className="card">
      <h2 className="section-title">账本流水</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>类型</th>
              <th>金额</th>
              <th>之前</th>
              <th>之后</th>
              <th>备注</th>
              <th>时间</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((item) => (
              <tr key={item.id}>
                <td>{item.type}</td>
                <td>{money(item.amount)}</td>
                <td>{money(item.balanceBefore)}</td>
                <td>{money(item.balanceAfter)}</td>
                <td>{item.remark}</td>
                <td>{dateTime(item.createdAt)}</td>
              </tr>
            ))}
            {transactions.length === 0 ? <EmptyRow colSpan={6} /> : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Requests({
  requests,
  compact = false,
  showCost = false,
}: {
  requests: ApiRequest[];
  compact?: boolean;
  showCost?: boolean;
}) {
  return (
    <section className="card">
      <h2 className="section-title">{compact ? "最近调用" : showCost ? "全站调用" : "调用记录"}</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {showCost ? <th>用户</th> : null}
              <th>模型</th>
              <th>状态</th>
              <th>输入</th>
              <th>输出</th>
              <th>总 token</th>
              <th>扣费</th>
              {showCost ? <th>上游成本</th> : null}
              {showCost ? <th>毛利</th> : null}
              <th>延迟</th>
              <th>时间</th>
            </tr>
          </thead>
          <tbody>
            {requests.map((item) => (
              <tr key={item.id}>
                {showCost ? <td>{item.user?.email ?? "-"}</td> : null}
                <td>{item.model}</td>
                <td>
                  <StatusPill status={item.status} />
                </td>
                <td>{formatNumber(item.inputTokens)}</td>
                <td>{formatNumber(item.outputTokens)}</td>
                <td>{formatNumber(item.totalTokens)}</td>
                <td>${money(item.chargedAmountUsd)}</td>
                {showCost ? <td>${money(item.upstreamCostUsd ?? "0")}</td> : null}
                {showCost ? (
                  <td>${money(Number(item.chargedAmountUsd) - Number(item.upstreamCostUsd ?? 0))}</td>
                ) : null}
                <td>{item.latencyMs ?? 0}ms</td>
                <td>{dateTime(item.createdAt)}</td>
              </tr>
            ))}
            {requests.length === 0 ? <EmptyRow colSpan={showCost ? 11 : 8} /> : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AdminRequests({
  requests,
  users,
  filters,
  onFiltersChange,
  onSearch,
}: {
  requests: ApiRequest[];
  users: AdminUser[];
  filters: RequestFilters;
  onFiltersChange: (filters: RequestFilters) => void;
  onSearch: () => void;
}) {
  function update<K extends keyof RequestFilters>(key: K, value: RequestFilters[K]) {
    onFiltersChange({ ...filters, [key]: value });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSearch();
  }

  return (
    <div className="grid">
      <section className="card">
        <div className="section-head">
          <div>
            <h2 className="section-title">账单与调用筛选</h2>
            <p className="section-subtitle">按用户、模型、状态和时间快速查账。</p>
          </div>
          <button
            className="button secondary"
            onClick={() => {
              onFiltersChange({
                q: "",
                userId: "",
                model: "",
                status: "",
                dateFrom: "",
                dateTo: "",
              });
              window.setTimeout(onSearch, 0);
            }}
            type="button"
          >
            重置
          </button>
        </div>
        <form className="filter-bar" onSubmit={submit}>
          <label className="field">
            <span>关键词</span>
            <input
              className="input"
              value={filters.q}
              onChange={(event) => update("q", event.target.value)}
              placeholder="用户邮箱 / 模型 / 接口"
            />
          </label>
          <label className="field">
            <span>用户</span>
            <select className="input" value={filters.userId} onChange={(event) => update("userId", event.target.value)}>
              <option value="">全部用户</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.email}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>模型</span>
            <input
              className="input"
              value={filters.model}
              onChange={(event) => update("model", event.target.value)}
              placeholder="gpt-5.5"
            />
          </label>
          <label className="field">
            <span>状态</span>
            <select
              className="input"
              value={filters.status}
              onChange={(event) => update("status", event.target.value as RequestFilters["status"])}
            >
              <option value="">全部状态</option>
              <option value="SUCCESS">SUCCESS</option>
              <option value="FAILED">FAILED</option>
              <option value="PENDING">PENDING</option>
            </select>
          </label>
          <label className="field">
            <span>开始</span>
            <input
              className="input"
              value={filters.dateFrom}
              onChange={(event) => update("dateFrom", event.target.value)}
              type="datetime-local"
            />
          </label>
          <label className="field">
            <span>结束</span>
            <input
              className="input"
              value={filters.dateTo}
              onChange={(event) => update("dateTo", event.target.value)}
              type="datetime-local"
            />
          </label>
          <button className="button" type="submit">
            查询
          </button>
        </form>
      </section>
      <Requests requests={requests} showCost />
    </div>
  );
}

function CallTester({
  onChanged,
  onError,
}: {
  onChanged: () => void;
  onError: (error: string | null) => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const [endpoint, setEndpoint] = useState<"chat" | "responses">("responses");
  const [model, setModel] = useState("gpt-4o-mini");
  const [prompt, setPrompt] = useState("用一句话回复：API 网关测试成功。");
  const [stream, setStream] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    ok: boolean;
    status: number;
    latencyMs: number;
    outputText?: string;
    body: string;
    usage?: unknown;
  } | null>(null);

  async function createTestKey() {
    onError(null);

    try {
      const created = await apiFetch<{ secret: string }>("/api-keys", {
        method: "POST",
        body: JSON.stringify({
          name: `test-${new Date().toISOString().slice(0, 19)}`,
          rateLimitPerMinute: 60,
          allowedModels: [],
        }),
      });
      setApiKey(created.secret);
      onChanged();
    } catch (createError) {
      onError(errorToText(createError));
    }
  }

  async function runTest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onError(null);
    setResult(null);

    if (!apiKey.trim()) {
      onError("请先粘贴 API Key，或者点“创建测试 Key”。");
      return;
    }

    setLoading(true);
    const startedAt = performance.now();

    try {
      const path = endpoint === "responses" ? "/v1/responses" : "/v1/chat/completions";
      const requestBody =
        endpoint === "responses"
          ? {
              model,
              stream,
              input: prompt,
            }
          : {
              model,
              stream,
              messages: [
                {
                  role: "user",
                  content: prompt,
                },
              ],
            };

      const response = await fetch(`${apiBaseUrl}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey.trim()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });
      const latencyMs = Math.round(performance.now() - startedAt);

      if (stream) {
        const text = await readStreamAsText(response);
        setResult({
          ok: response.ok,
          status: response.status,
          latencyMs,
          outputText: extractOutputTextFromStreamText(text),
          body: text,
          usage: extractUsageFromStreamText(text),
        });
        return;
      }

      const text = await response.text();
      const parsed = parseJsonOrNull(text);

      setResult({
        ok: response.ok,
        status: response.status,
        latencyMs,
        outputText: extractOutputText(parsed),
        body: parsed ? JSON.stringify(parsed, null, 2) : text,
        usage: parsed && typeof parsed === "object" && "usage" in parsed ? parsed.usage : undefined,
      });
    } catch (testError) {
      setResult({
        ok: false,
        status: 0,
        latencyMs: Math.round(performance.now() - startedAt),
        body: errorToText(testError),
      });
    } finally {
      setLoading(false);
      onChanged();
    }
  }

  return (
    <div className="grid">
      <section className="card">
        <h2 className="section-title">调用测试</h2>
        <form className="form" onSubmit={runTest}>
          <div className="button-row">
            <button className="button secondary" onClick={createTestKey} type="button">
              <KeyRound size={17} />
              创建测试 Key
            </button>
            <span className="pill">
              {apiBaseUrl}
              {endpoint === "responses" ? "/v1/responses" : "/v1/chat/completions"}
            </span>
          </div>
          <label className="field">
            <span>你的 API Key</span>
            <input
              className="input"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="sk_live_..."
            />
          </label>
          <div className="grid cols-2">
            <label className="field">
              <span>接口</span>
              <select
                className="input"
                value={endpoint}
                onChange={(event) =>
                  setEndpoint(event.target.value === "responses" ? "responses" : "chat")
                }
              >
                <option value="responses">Responses API</option>
                <option value="chat">Chat Completions</option>
              </select>
            </label>
            <label className="field">
              <span>模型</span>
              <input className="input" value={model} onChange={(event) => setModel(event.target.value)} />
            </label>
          </div>
          <label className="field">
            <span>响应模式</span>
            <select
              className="input"
              value={stream ? "stream" : "normal"}
              onChange={(event) => setStream(event.target.value === "stream")}
            >
              <option value="normal">非流式</option>
              <option value="stream">流式</option>
            </select>
          </label>
          <label className="field">
            <span>测试 Prompt</span>
            <textarea
              className="input textarea"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
            />
          </label>
          <button className="button" disabled={loading} type="submit">
            <Send size={17} />
            {loading ? "测试中..." : "发送测试请求"}
          </button>
        </form>
      </section>

      {result ? (
        <section className="card">
          <h2 className="section-title">测试结果</h2>
          <div className="grid cols-3">
            <Metric label="状态" value={result.ok ? "成功" : "失败"} />
            <Metric label="HTTP" value={String(result.status)} />
            <Metric label="耗时" value={`${result.latencyMs}ms`} />
          </div>
          {result.outputText ? (
            <div className="stack-top">
              <h3 className="section-title">模型回复</h3>
              <div className="answer-box">{result.outputText}</div>
            </div>
          ) : null}
          {result.usage ? (
            <div className="stack-top">
              <h3 className="section-title">Usage</h3>
              <pre className="code-block">{JSON.stringify(result.usage, null, 2)}</pre>
            </div>
          ) : null}
          <div className="stack-top">
            <h3 className="section-title">原始返回</h3>
            <pre className="code-block">{result.body}</pre>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function AdminOverviewPanel({ overview }: { overview: AdminOverview | null }) {
  return (
    <div className="grid">
      <div className="grid cols-3">
        <Metric label="用户数" value={String(overview?.users ?? 0)} />
        <Metric label="总请求数" value={String(overview?.requests ?? 0)} />
        <Metric label="总 token" value={formatNumber(overview?.totalTokens ?? 0)} />
      </div>
      <div className="grid cols-3">
        <Metric label="客户扣费" value={`$${money(overview?.revenue ?? "0")}`} />
        <Metric label="上游成本" value={`$${money(overview?.upstreamCost ?? "0")}`} />
        <Metric label="毛利" value={`$${money(overview?.grossProfit ?? "0")}`} />
      </div>
      <section className="card">
        <h2 className="section-title">资金概览</h2>
        <div className="info-list">
          <InfoLine label="用户余额总额" value={`$${money(overview?.totalWalletBalance ?? "0")}`} />
          <InfoLine label="累计收入" value={`$${money(overview?.revenue ?? "0")}`} />
          <InfoLine label="累计成本" value={`$${money(overview?.upstreamCost ?? "0")}`} />
        </div>
      </section>
    </div>
  );
}

function AdminUsers({
  users,
  modelPrices,
  onChanged,
  onError,
}: {
  users: AdminUser[];
  modelPrices: ModelPrice[];
  onChanged: () => void;
  onError: (error: string | null) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"USER" | "ADMIN">("USER");
  const [initialBalance, setInitialBalance] = useState("0");
  const [userSearch, setUserSearch] = useState("");
  const [targetUserId, setTargetUserId] = useState("");
  const [adjustAmount, setAdjustAmount] = useState("10");
  const [adjustRemark, setAdjustRemark] = useState("Admin balance adjustment");
  const [allowedModelsText, setAllowedModelsText] = useState("");
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [editEmail, setEditEmail] = useState("");
  const [editName, setEditName] = useState("");
  const [editRole, setEditRole] = useState<"USER" | "ADMIN">("USER");
  const [editStatus, setEditStatus] = useState<"ACTIVE" | "DISABLED">("ACTIVE");
  const [editPassword, setEditPassword] = useState("");
  const [editAllowedModels, setEditAllowedModels] = useState("");
  const selectedUserId = targetUserId || users[0]?.id || "";
  const selectedUser = users.find((item) => item.id === selectedUserId);
  const filteredUsers = users.filter((item) =>
    `${item.email} ${item.role} ${item.status}`
      .toLowerCase()
      .includes(userSearch.trim().toLowerCase()),
  );

  useEffect(() => {
    setAllowedModelsText((selectedUser?.allowedModels ?? []).join("\n"));
  }, [selectedUser?.id]);

  function beginEditUser(item: AdminUser) {
    setEditingUser(item);
    setEditEmail(item.email);
    setEditName(item.name ?? "");
    setEditRole(item.role === "ADMIN" ? "ADMIN" : "USER");
    setEditStatus(item.status === "DISABLED" ? "DISABLED" : "ACTIVE");
    setEditPassword("");
    setEditAllowedModels((item.allowedModels ?? []).join("\n"));
  }

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onError(null);

    if (!email.trim()) {
      onError("请填写用户邮箱。");
      return;
    }

    if (password.length < 8) {
      onError("新用户密码至少 8 位。可以点“生成密码”。");
      return;
    }

    try {
      await apiFetch("/admin/users", {
        method: "POST",
        body: JSON.stringify({
          email,
          password,
          role,
          initialBalance,
          allowedModels: [],
        }),
      });
      setEmail("");
      setPassword("");
      setInitialBalance("0");
      onChanged();
    } catch (createError) {
      onError(errorToText(createError));
    }
  }

  function generatePassword() {
    const generated = `u${Math.random().toString(36).slice(2, 8)}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    setPassword(generated);
  }

  async function adjustBalance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onError(null);
    if (!selectedUserId) {
      onError("请选择用户。");
      return;
    }

    try {
      await apiFetch(`/admin/users/${selectedUserId}/balance`, {
        method: "POST",
        body: JSON.stringify({ amount: adjustAmount, remark: adjustRemark }),
      });
      onChanged();
    } catch (adjustError) {
      onError(errorToText(adjustError));
    }
  }

  async function saveAllowedModels(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onError(null);
    if (!selectedUserId) {
      onError("请选择用户。");
      return;
    }

    const allowedModels = parseModelList(allowedModelsText);

    try {
      await apiFetch(`/admin/users/${selectedUserId}`, {
        method: "PATCH",
        body: JSON.stringify({ allowedModels }),
      });
      onChanged();
    } catch (updateError) {
      onError(errorToText(updateError));
    }
  }

  async function toggleUserStatus(item: AdminUser) {
    onError(null);
    try {
      await apiFetch(`/admin/users/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: item.status === "ACTIVE" ? "DISABLED" : "ACTIVE",
        }),
      });
      onChanged();
    } catch (updateError) {
      onError(errorToText(updateError));
    }
  }

  async function saveEditingUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onError(null);
    if (!editingUser) {
      return;
    }

    try {
      await apiFetch(`/admin/users/${editingUser.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          email: editEmail,
          name: editName || null,
          role: editRole,
          status: editStatus,
          allowedModels: parseModelList(editAllowedModels),
          ...(editPassword ? { password: editPassword } : {}),
        }),
      });
      setEditingUser(null);
      onChanged();
    } catch (updateError) {
      onError(errorToText(updateError));
    }
  }

  async function deleteUser(item: AdminUser) {
    const confirmed = window.confirm(`确定删除用户「${item.email}」吗？这个操作会删除该用户的 API Key、钱包流水和调用记录。`);

    if (!confirmed) {
      return;
    }

    onError(null);
    try {
      await apiFetch(`/admin/users/${item.id}`, {
        method: "DELETE",
      });
      if (editingUser?.id === item.id) {
        setEditingUser(null);
      }
      onChanged();
    } catch (deleteError) {
      onError(errorToText(deleteError));
    }
  }

  return (
    <div className="grid">
      {editingUser ? (
        <section className="card">
          <div className="section-head">
            <div>
              <h2 className="section-title">编辑用户</h2>
              <p className="section-subtitle">{editingUser.email}</p>
            </div>
            <button className="button secondary" onClick={() => setEditingUser(null)} type="button">
              取消
            </button>
          </div>
          <form className="form" onSubmit={saveEditingUser}>
            <div className="grid cols-3">
              <label className="field">
                <span>邮箱</span>
                <input className="input" value={editEmail} onChange={(event) => setEditEmail(event.target.value)} type="email" />
              </label>
              <label className="field">
                <span>名称</span>
                <input className="input" value={editName} onChange={(event) => setEditName(event.target.value)} />
              </label>
              <label className="field">
                <span>新密码</span>
                <input
                  className="input"
                  value={editPassword}
                  onChange={(event) => setEditPassword(event.target.value)}
                  placeholder="留空则不修改"
                  type="password"
                />
              </label>
            </div>
            <div className="grid cols-3">
              <label className="field">
                <span>角色</span>
                <select className="input" value={editRole} onChange={(event) => setEditRole(event.target.value === "ADMIN" ? "ADMIN" : "USER")}>
                  <option value="USER">USER</option>
                  <option value="ADMIN">ADMIN</option>
                </select>
              </label>
              <label className="field">
                <span>状态</span>
                <select
                  className="input"
                  value={editStatus}
                  onChange={(event) => setEditStatus(event.target.value === "DISABLED" ? "DISABLED" : "ACTIVE")}
                >
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="DISABLED">DISABLED</option>
                </select>
              </label>
              <label className="field">
                <span>模型白名单</span>
                <textarea
                  className="input textarea compact-textarea"
                  value={editAllowedModels}
                  onChange={(event) => setEditAllowedModels(event.target.value)}
                  placeholder="留空不限；每行一个模型"
                />
              </label>
            </div>
            <div className="chip-row">
              {modelPrices.slice(0, 8).map((price) => (
                <button
                  className="chip"
                  key={price.id}
                  onClick={() =>
                    setEditAllowedModels((current) =>
                      Array.from(new Set([...parseModelList(current), price.model])).join("\n"),
                    )
                  }
                  type="button"
                >
                  + {price.model}
                </button>
              ))}
            </div>
            <button className="button" type="submit">
              <Save size={17} />
              保存用户
            </button>
          </form>
        </section>
      ) : null}
      <div className="grid cols-3">
        <section className="card">
          <div className="section-head">
            <div>
              <h2 className="section-title">创建用户</h2>
              <p className="section-subtitle">给客户开账号和初始余额。</p>
            </div>
          </div>
          <form className="form" onSubmit={createUser}>
            <label className="field">
              <span>邮箱</span>
              <input className="input" value={email} onChange={(event) => setEmail(event.target.value)} type="email" />
            </label>
            <label className="field">
              <span>密码</span>
              <div className="input-with-action">
                <input
                  className="input"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="至少 8 位"
                  type="text"
                />
                <button className="button secondary" onClick={generatePassword} type="button">
                  生成
                </button>
              </div>
            </label>
            <div className="grid cols-2">
              <label className="field">
                <span>角色</span>
                <select
                  className="input"
                  value={role}
                  onChange={(event) => setRole(event.target.value === "ADMIN" ? "ADMIN" : "USER")}
                >
                  <option value="USER">USER</option>
                  <option value="ADMIN">ADMIN</option>
                </select>
              </label>
              <label className="field">
                <span>初始余额</span>
                <input className="input" value={initialBalance} onChange={(event) => setInitialBalance(event.target.value)} />
              </label>
            </div>
            <button className="button" type="submit">
              <Users size={17} />
              创建用户
            </button>
          </form>
        </section>
        <section className="card">
          <div className="section-head">
            <div>
              <h2 className="section-title">余额调整</h2>
              <p className="section-subtitle">正数加余额，负数扣余额。</p>
            </div>
          </div>
          <form className="form" onSubmit={adjustBalance}>
            <label className="field">
              <span>用户</span>
              <select className="input" value={selectedUserId} onChange={(event) => setTargetUserId(event.target.value)}>
                {users.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.email}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid cols-2">
              <label className="field">
                <span>金额</span>
                <input className="input" value={adjustAmount} onChange={(event) => setAdjustAmount(event.target.value)} />
              </label>
              <label className="field">
                <span>备注</span>
                <input className="input" value={adjustRemark} onChange={(event) => setAdjustRemark(event.target.value)} />
              </label>
            </div>
            <button className="button" type="submit">
              <CreditCard size={17} />
              调整余额
            </button>
          </form>
        </section>
        <section className="card">
          <div className="section-head">
            <div>
              <h2 className="section-title">模型白名单</h2>
              <p className="section-subtitle">留空表示该用户不限模型。</p>
            </div>
          </div>
          <form className="form" onSubmit={saveAllowedModels}>
            <label className="field">
              <span>用户</span>
              <select className="input" value={selectedUserId} onChange={(event) => setTargetUserId(event.target.value)}>
                {users.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.email}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>允许模型</span>
              <textarea
                className="input textarea compact-textarea"
                value={allowedModelsText}
                onChange={(event) => setAllowedModelsText(event.target.value)}
                placeholder="每行一个模型，比如 gpt-5.5"
              />
            </label>
            <div className="chip-row">
              {modelPrices.slice(0, 8).map((price) => (
                <button
                  className="chip"
                  key={price.id}
                  onClick={() =>
                    setAllowedModelsText((current) =>
                      Array.from(new Set([...parseModelList(current), price.model])).join("\n"),
                    )
                  }
                  type="button"
                >
                  + {price.model}
                </button>
              ))}
            </div>
            <button className="button" type="submit">
              <Save size={17} />
              保存白名单
            </button>
          </form>
        </section>
      </div>
      <section className="card">
        <div className="section-head">
          <div>
            <h2 className="section-title">用户列表</h2>
            <p className="section-subtitle">搜索用户、查看余额和模型限制。</p>
          </div>
          <input
            className="input search-input"
            value={userSearch}
            onChange={(event) => setUserSearch(event.target.value)}
            placeholder="搜索邮箱 / 状态 / 角色"
          />
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>邮箱</th>
                <th>角色</th>
                <th>状态</th>
                <th>余额</th>
                <th>模型白名单</th>
                <th>Key</th>
                <th>请求</th>
                <th>创建时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((item) => (
                <tr key={item.id}>
                  <td>{item.email}</td>
                  <td>{item.role}</td>
                  <td>
                    <StatusPill status={item.status} />
                  </td>
                  <td>${money(item.wallet?.balance ?? "0")}</td>
                  <td>{item.allowedModels.length > 0 ? item.allowedModels.join(", ") : "不限"}</td>
                  <td>{item._count.apiKeys}</td>
                  <td>{item._count.apiRequests}</td>
                  <td>{dateTime(item.createdAt)}</td>
                  <td>
                    <div className="button-row compact">
                      <button className="button secondary" onClick={() => beginEditUser(item)} type="button">
                        编辑
                      </button>
                      <button className="button secondary" onClick={() => toggleUserStatus(item)} type="button">
                        {item.status === "ACTIVE" ? "停用" : "启用"}
                      </button>
                      <button className="button danger" onClick={() => deleteUser(item)} type="button">
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredUsers.length === 0 ? <EmptyRow colSpan={9} /> : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function AdminRedeemCodes({
  codes,
  onChanged,
  onError,
}: {
  codes: RedeemCode[];
  onChanged: () => void;
  onError: (error: string | null) => void;
}) {
  const [amount, setAmount] = useState("10");
  const [count, setCount] = useState(1);
  const [maxRedemptions, setMaxRedemptions] = useState(1);
  const [expiryMode, setExpiryMode] = useState<"never" | "custom">("never");
  const [expiresAt, setExpiresAt] = useState("");
  const [remark, setRemark] = useState("");
  const [codeSearch, setCodeSearch] = useState("");
  const [generated, setGenerated] = useState<RedeemCode[]>([]);
  const filteredCodes = codes.filter((code) =>
    `${code.codePrefix} ${code.amount} ${code.status} ${code.remark ?? ""} ${code.redemptions?.[0]?.user.email ?? ""}`
      .toLowerCase()
      .includes(codeSearch.trim().toLowerCase()),
  );

  async function createCodes(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onError(null);
    try {
      const payload = {
        amount,
        count: Number(count),
        maxRedemptions: Number(maxRedemptions),
        remark: remark || undefined,
        expiresAt:
          expiryMode === "custom" && expiresAt
            ? new Date(expiresAt).toISOString()
            : null,
      };
      const result = await apiFetch<{ codes: RedeemCode[] }>("/admin/redeem-codes", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setGenerated(result.codes);
      onChanged();
    } catch (createError) {
      onError(errorToText(createError));
    }
  }

  async function toggleCode(code: RedeemCode) {
    onError(null);
    try {
      await apiFetch(`/admin/redeem-codes/${code.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: code.status === "ACTIVE" ? "DISABLED" : "ACTIVE",
        }),
      });
      onChanged();
    } catch (updateError) {
      onError(errorToText(updateError));
    }
  }

  return (
    <div className="grid">
      <section className="card">
        <div className="section-head">
          <div>
            <h2 className="section-title">生成兑换码</h2>
            <p className="section-subtitle">选择额度和有效期，生成后明文只显示一次。</p>
          </div>
        </div>
        <form className="form" onSubmit={createCodes}>
          <div className="quick-amounts">
            {["5", "10", "20", "50", "100", "500"].map((value) => (
              <button
                className={amount === value ? "quick active" : "quick"}
                key={value}
                onClick={() => setAmount(value)}
                type="button"
              >
                ${value}
              </button>
            ))}
          </div>
          <div className="grid cols-3">
            <label className="field">
              <span>单码额度</span>
              <input className="input" value={amount} onChange={(event) => setAmount(event.target.value)} />
            </label>
            <label className="field">
              <span>数量</span>
              <input className="input" value={count} min={1} max={100} onChange={(event) => setCount(Number(event.target.value))} type="number" />
            </label>
            <label className="field">
              <span>可兑换次数</span>
              <input
                className="input"
                value={maxRedemptions}
                min={1}
                max={1000}
                onChange={(event) => setMaxRedemptions(Number(event.target.value))}
                type="number"
              />
            </label>
          </div>
          <div className="segmented">
            <button
              className={expiryMode === "never" ? "active" : ""}
              onClick={() => setExpiryMode("never")}
              type="button"
            >
              永不过期
            </button>
            <button
              className={expiryMode === "custom" ? "active" : ""}
              onClick={() => setExpiryMode("custom")}
              type="button"
            >
              指定过期
            </button>
          </div>
          <div className="grid cols-2">
            {expiryMode === "custom" ? (
              <label className="field">
                <span>过期时间</span>
                <input className="input" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} type="datetime-local" />
              </label>
            ) : null}
            <label className="field">
              <span>备注</span>
              <input className="input" value={remark} onChange={(event) => setRemark(event.target.value)} />
            </label>
          </div>
          <button className="button" type="submit">
            <Ticket size={17} />
            生成
          </button>
        </form>
        {generated.length > 0 ? (
          <div className="stack-top">
            <div className="notice">兑换码明文只在本次生成后显示。</div>
            <pre className="code-block">
              {generated.map((item) => `${item.code}  $${money(item.amount)}`).join("\n")}
            </pre>
          </div>
        ) : null}
      </section>
      <section className="card">
        <div className="section-head">
          <div>
            <h2 className="section-title">兑换码列表</h2>
            <p className="section-subtitle">按前缀、金额、状态或兑换用户查找。</p>
          </div>
          <input
            className="input search-input"
            value={codeSearch}
            onChange={(event) => setCodeSearch(event.target.value)}
            placeholder="搜索兑换码"
          />
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>前缀</th>
                <th>金额</th>
                <th>状态</th>
                <th>兑换</th>
                <th>过期</th>
                <th>备注</th>
                <th>最近兑换</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredCodes.map((code) => (
                <tr key={code.id}>
                  <td>{code.codePrefix}</td>
                  <td>${money(code.amount)}</td>
                  <td>
                    <StatusPill status={code.status} />
                  </td>
                  <td>
                    {code.redeemedCount}/{code.maxRedemptions}
                  </td>
                  <td>{code.expiresAt ? dateTime(code.expiresAt) : "-"}</td>
                  <td>{code.remark}</td>
                  <td>{code.redemptions?.[0]?.user.email ?? "-"}</td>
                  <td>
                    <button className="button secondary" onClick={() => toggleCode(code)} type="button">
                      {code.status === "ACTIVE" ? "停用" : "启用"}
                    </button>
                  </td>
                </tr>
              ))}
              {filteredCodes.length === 0 ? <EmptyRow colSpan={8} /> : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function ModelPrices({
  modelPrices,
  onChanged,
  onError,
}: {
  modelPrices: ModelPrice[];
  onChanged: () => void;
  onError: (error: string | null) => void;
}) {
  const [model, setModel] = useState("gpt-4o-mini");
  const [upstreamInput, setUpstreamInput] = useState("5");
  const [upstreamCachedInput, setUpstreamCachedInput] = useState("0.5");
  const [upstreamOutput, setUpstreamOutput] = useState("30");
  const [upstreamMultiplier, setUpstreamMultiplier] = useState("0.06");
  const [customerInput, setCustomerInput] = useState("5");
  const [customerCachedInput, setCustomerCachedInput] = useState("0.5");
  const [customerOutput, setCustomerOutput] = useState("30");
  const [customerMultiplier, setCustomerMultiplier] = useState("0.12");
  const [enabled, setEnabled] = useState(true);
  const upstreamEffective = {
    input: multiplied(upstreamInput, upstreamMultiplier),
    cached: multiplied(upstreamCachedInput, upstreamMultiplier),
    output: multiplied(upstreamOutput, upstreamMultiplier),
  };
  const customerEffective = {
    input: multiplied(customerInput, customerMultiplier),
    cached: multiplied(customerCachedInput, customerMultiplier),
    output: multiplied(customerOutput, customerMultiplier),
  };

  async function saveModelPrice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onError(null);

    try {
      await apiFetch("/admin/model-prices", {
        method: "POST",
        body: JSON.stringify({
          model,
          upstreamInputPer1MTok: upstreamInput,
          upstreamCachedInputPer1MTok: upstreamCachedInput,
          upstreamOutputPer1MTok: upstreamOutput,
          upstreamPriceMultiplier: upstreamMultiplier,
          customerInputPer1MTok: customerInput,
          customerCachedInputPer1MTok: customerCachedInput,
          customerOutputPer1MTok: customerOutput,
          customerPriceMultiplier: customerMultiplier,
          minimumChargeUsd: "0",
          enabled,
        }),
      });
      onChanged();
    } catch (saveError) {
      onError(errorToText(saveError));
    }
  }

  function editPrice(price: ModelPrice) {
    setModel(price.model);
    setUpstreamInput(price.upstreamInputPer1MTok);
    setUpstreamCachedInput(price.upstreamCachedInputPer1MTok);
    setUpstreamOutput(price.upstreamOutputPer1MTok);
    setUpstreamMultiplier(price.upstreamPriceMultiplier);
    setCustomerInput(price.customerInputPer1MTok);
    setCustomerCachedInput(price.customerCachedInputPer1MTok);
    setCustomerOutput(price.customerOutputPer1MTok);
    setCustomerMultiplier(price.customerPriceMultiplier);
    setEnabled(price.enabled);
  }

  async function togglePrice(price: ModelPrice) {
    onError(null);
    try {
      await apiFetch(`/admin/model-prices/${price.id}`, {
        method: "PUT",
        body: JSON.stringify({ enabled: !price.enabled }),
      });
      onChanged();
    } catch (updateError) {
      onError(errorToText(updateError));
    }
  }

  return (
    <div className="grid">
      <section className="card">
        <div className="section-head">
          <div>
            <h2 className="section-title">模型定价</h2>
            <p className="section-subtitle">先填模型原价，再用倍率算出真实成本和对外售价。</p>
          </div>
          <button
            className="button secondary"
            onClick={() => {
              setCustomerInput(upstreamInput);
              setCustomerCachedInput(upstreamCachedInput);
              setCustomerOutput(upstreamOutput);
              setCustomerMultiplier("0.12");
            }}
            type="button"
          >
            套用 0.12 售价
          </button>
        </div>
        <form className="form" onSubmit={saveModelPrice}>
          <div className="pricing-layout">
            <div className="pricing-form">
              <label className="field">
                <span>模型</span>
                <input className="input" value={model} onChange={(event) => setModel(event.target.value)} />
              </label>
              <section className="subpanel">
                <h3>上游价格</h3>
                <div className="grid cols-2">
                  <label className="field">
                    <span>输入原价 / 1M</span>
                    <input className="input" value={upstreamInput} onChange={(event) => setUpstreamInput(event.target.value)} />
                  </label>
                  <label className="field">
                    <span>缓存原价 / 1M</span>
                    <input className="input" value={upstreamCachedInput} onChange={(event) => setUpstreamCachedInput(event.target.value)} />
                  </label>
                  <label className="field">
                    <span>输出原价 / 1M</span>
                    <input className="input" value={upstreamOutput} onChange={(event) => setUpstreamOutput(event.target.value)} />
                  </label>
                  <label className="field">
                    <span>上游倍率</span>
                    <input className="input" value={upstreamMultiplier} onChange={(event) => setUpstreamMultiplier(event.target.value)} />
                  </label>
                </div>
              </section>
              <section className="subpanel">
                <h3>站点售价</h3>
                <div className="grid cols-2">
                  <label className="field">
                    <span>输入原价 / 1M</span>
                    <input className="input" value={customerInput} onChange={(event) => setCustomerInput(event.target.value)} />
                  </label>
                  <label className="field">
                    <span>缓存原价 / 1M</span>
                    <input className="input" value={customerCachedInput} onChange={(event) => setCustomerCachedInput(event.target.value)} />
                  </label>
                  <label className="field">
                    <span>输出原价 / 1M</span>
                    <input className="input" value={customerOutput} onChange={(event) => setCustomerOutput(event.target.value)} />
                  </label>
                  <label className="field">
                    <span>站点倍率</span>
                    <input className="input" value={customerMultiplier} onChange={(event) => setCustomerMultiplier(event.target.value)} />
                  </label>
                </div>
              </section>
            </div>
            <aside className="pricing-preview">
              <h3>实时预览 / 1M token</h3>
              <InfoLine label="上游输入" value={`$${money(upstreamEffective.input)}`} />
              <InfoLine label="上游缓存" value={`$${money(upstreamEffective.cached)}`} />
              <InfoLine label="上游输出" value={`$${money(upstreamEffective.output)}`} />
              <InfoLine label="站点输入" value={`$${money(customerEffective.input)}`} />
              <InfoLine label="站点缓存" value={`$${money(customerEffective.cached)}`} />
              <InfoLine label="站点输出" value={`$${money(customerEffective.output)}`} />
            </aside>
          </div>
          <label className="check-row">
            <input checked={enabled} onChange={(event) => setEnabled(event.target.checked)} type="checkbox" />
            启用模型
          </label>
          <button className="button" type="submit">
            <Save size={17} />
            保存价格
          </button>
        </form>
      </section>

      <section className="card">
        <div className="section-head">
          <div>
            <h2 className="section-title">价格列表</h2>
            <p className="section-subtitle">显示原价、上游成本、站点售价，方便核对倍率。</p>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>模型</th>
                <th>状态</th>
                <th>原价输入/缓存/输出</th>
                <th>上游成本</th>
                <th>站点售价</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {modelPrices.map((price) => (
                <tr key={price.id}>
                  <td>{price.model}</td>
                  <td>
                    <StatusPill status={price.enabled ? "ACTIVE" : "DISABLED"} />
                  </td>
                  <td>
                    {priceTriplet(
                      price.upstreamInputPer1MTok,
                      price.upstreamCachedInputPer1MTok,
                      price.upstreamOutputPer1MTok,
                    )}
                  </td>
                  <td>
                    x{price.upstreamPriceMultiplier}:{" "}
                    {priceTriplet(
                      multiplied(price.upstreamInputPer1MTok, price.upstreamPriceMultiplier),
                      multiplied(price.upstreamCachedInputPer1MTok, price.upstreamPriceMultiplier),
                      multiplied(price.upstreamOutputPer1MTok, price.upstreamPriceMultiplier),
                    )}
                  </td>
                  <td>
                    x{price.customerPriceMultiplier}:{" "}
                    {priceTriplet(
                      multiplied(price.customerInputPer1MTok, price.customerPriceMultiplier),
                      multiplied(price.customerCachedInputPer1MTok, price.customerPriceMultiplier),
                      multiplied(price.customerOutputPer1MTok, price.customerPriceMultiplier),
                    )}
                  </td>
                  <td>
                    <div className="button-row compact">
                      <button className="button secondary" onClick={() => editPrice(price)} type="button">
                        编辑
                      </button>
                      <button className="button secondary" onClick={() => togglePrice(price)} type="button">
                        {price.enabled ? "停用" : "启用"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {modelPrices.length === 0 ? <EmptyRow colSpan={6} /> : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function UpstreamProviders({
  providers,
  onChanged,
  onError,
}: {
  providers: UpstreamProvider[];
  onChanged: () => void;
  onError: (error: string | null) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("upstream-1");
  const [baseUrl, setBaseUrl] = useState("https://api.openai.com");
  const [apiKey, setApiKey] = useState("");
  const [priority, setPriority] = useState(100);
  const [timeoutMs, setTimeoutMs] = useState(120000);
  const [busyProviderId, setBusyProviderId] = useState<string | null>(null);

  async function saveProvider(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onError(null);

    if (!editingId && !apiKey.trim()) {
      onError("添加上游时必须填写上游 API Key。");
      return;
    }

    const body = {
      name,
      baseUrl,
      ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      priority: Number(priority),
      timeoutMs: Number(timeoutMs),
      status: "ACTIVE",
    };

    try {
      await apiFetch(editingId ? `/admin/upstream-providers/${editingId}` : "/admin/upstream-providers", {
        method: editingId ? "PATCH" : "POST",
        body: JSON.stringify(body),
      });
      clearForm();
      onChanged();
    } catch (saveError) {
      onError(errorToText(saveError));
    }
  }

  function editProvider(provider: UpstreamProvider) {
    setEditingId(provider.id);
    setName(provider.name);
    setBaseUrl(provider.baseUrl);
    setApiKey("");
    setPriority(provider.priority);
    setTimeoutMs(provider.timeoutMs);
  }

  function clearForm() {
    setEditingId(null);
    setName("upstream-1");
    setBaseUrl("https://api.openai.com");
    setApiKey("");
    setPriority(100);
    setTimeoutMs(120000);
  }

  async function setProviderStatus(provider: UpstreamProvider, status: UpstreamProvider["status"]) {
    onError(null);
    setBusyProviderId(provider.id);

    try {
      await apiFetch(`/admin/upstream-providers/${provider.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      onChanged();
    } catch (updateError) {
      onError(errorToText(updateError));
    } finally {
      setBusyProviderId(null);
    }
  }

  async function deleteProvider(provider: UpstreamProvider) {
    const confirmed = window.confirm(`确定删除上游「${provider.name}」吗？`);

    if (!confirmed) {
      return;
    }

    onError(null);
    setBusyProviderId(provider.id);

    try {
      await apiFetch(`/admin/upstream-providers/${provider.id}`, {
        method: "DELETE",
      });
      onChanged();
    } catch (deleteError) {
      onError(errorToText(deleteError));
    } finally {
      setBusyProviderId(null);
    }
  }

  return (
    <div className="grid">
      <section className="card">
        <h2 className="section-title">{editingId ? "编辑上游" : "添加上游"}</h2>
        <form className="form" onSubmit={saveProvider}>
          <label className="field">
            <span>名称</span>
            <input className="input" value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="field">
            <span>Base URL</span>
            <input className="input" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} />
          </label>
          <label className="field">
            <span>上游 API Key</span>
            <input
              className="input"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={editingId ? "留空则不修改" : "sk-..."}
              type="password"
            />
          </label>
          <div className="grid cols-2">
            <label className="field">
              <span>优先级</span>
              <input className="input" value={priority} onChange={(event) => setPriority(Number(event.target.value))} type="number" />
            </label>
            <label className="field">
              <span>超时 ms</span>
              <input className="input" value={timeoutMs} onChange={(event) => setTimeoutMs(Number(event.target.value))} type="number" />
            </label>
          </div>
          <div className="button-row">
            <button className="button" type="submit">
              <Server size={17} />
              {editingId ? "保存上游" : "添加上游"}
            </button>
            {editingId ? (
              <button className="button secondary" onClick={clearForm} type="button">
                取消编辑
              </button>
            ) : null}
          </div>
        </form>
      </section>

      <section className="card">
        <h2 className="section-title">上游列表</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>名称</th>
                <th>状态</th>
                <th>优先级</th>
                <th>Base URL</th>
                <th>Key</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {providers.map((provider) => (
                <tr key={provider.id}>
                  <td>{provider.name}</td>
                  <td>
                    <StatusPill status={provider.status} />
                  </td>
                  <td>{provider.priority}</td>
                  <td>{provider.baseUrl}</td>
                  <td>{provider.apiKey}</td>
                  <td>
                    <div className="button-row compact">
                      <button className="button secondary" onClick={() => editProvider(provider)} type="button">
                        编辑
                      </button>
                      {provider.status === "ACTIVE" ? (
                        <button
                          className="button secondary"
                          disabled={busyProviderId === provider.id}
                          onClick={() => setProviderStatus(provider, "DISABLED")}
                          type="button"
                        >
                          停用
                        </button>
                      ) : (
                        <button
                          className="button"
                          disabled={busyProviderId === provider.id}
                          onClick={() => setProviderStatus(provider, "ACTIVE")}
                          type="button"
                        >
                          启用
                        </button>
                      )}
                      <button
                        className="button danger"
                        disabled={busyProviderId === provider.id}
                        onClick={() => deleteProvider(provider)}
                        type="button"
                      >
                        <Trash2 size={15} />
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {providers.length === 0 ? <EmptyRow colSpan={6} /> : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Metric({
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

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="info-line">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const ok = status === "ACTIVE" || status === "SUCCESS";
  const danger = status === "FAILED" || status === "REVOKED" || status === "DISABLED";
  return <span className={`pill ${ok ? "ok" : danger ? "warn" : ""}`}>{status}</span>;
}

function EmptyRow({ colSpan }: { colSpan: number }) {
  return (
    <tr>
      <td className="empty-cell" colSpan={colSpan}>
        暂无数据
      </td>
    </tr>
  );
}

function titleForTab(tab: Tab) {
  const item = [...frontNav, ...adminNav].find((nav) => nav.id === tab);
  return item?.label ?? "总览";
}

function money(value: string | number | null | undefined) {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) {
    return "0.00000000";
  }
  return numeric.toFixed(8);
}

function multiplied(value: string | number, multiplier: string | number) {
  return Number(value) * Number(multiplier);
}

function priceTriplet(input: string | number, cached: string | number, output: string | number) {
  return `$${money(input)} / $${money(cached)} / $${money(output)}`;
}

function parseModelList(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[\n,，\s]+/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

function toQueryString(filters: RequestFilters) {
  const params = new URLSearchParams();
  if (filters.q.trim()) {
    params.set("q", filters.q.trim());
  }
  if (filters.userId) {
    params.set("userId", filters.userId);
  }
  if (filters.model.trim()) {
    params.set("model", filters.model.trim());
  }
  if (filters.status) {
    params.set("status", filters.status);
  }
  if (filters.dateFrom) {
    params.set("dateFrom", new Date(filters.dateFrom).toISOString());
  }
  if (filters.dateTo) {
    params.set("dateTo", new Date(filters.dateTo).toISOString());
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function dateTime(value: string) {
  return new Date(value).toLocaleString();
}

function errorToText(error: unknown) {
  return error instanceof Error ? error.message : "未知错误";
}

async function readStreamAsText(response: Response) {
  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    text += decoder.decode(value, { stream: true });
  }

  text += decoder.decode();
  return text;
}

function parseJsonOrNull(text: string) {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function extractOutputText(value: unknown): string {
  if (!value || typeof value !== "object") {
    return "";
  }

  if ("output_text" in value && typeof value.output_text === "string") {
    return value.output_text;
  }

  if ("choices" in value && Array.isArray(value.choices)) {
    return value.choices
      .map((choice) => {
        if (!choice || typeof choice !== "object") {
          return "";
        }
        if (
          "message" in choice &&
          choice.message &&
          typeof choice.message === "object" &&
          "content" in choice.message &&
          typeof choice.message.content === "string"
        ) {
          return choice.message.content;
        }
        if ("text" in choice && typeof choice.text === "string") {
          return choice.text;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }

  if ("output" in value && Array.isArray(value.output)) {
    return value.output
      .flatMap((item) =>
        item && typeof item === "object" && "content" in item && Array.isArray(item.content)
          ? item.content
          : [],
      )
      .map((part) =>
        part && typeof part === "object" && "text" in part && typeof part.text === "string"
          ? part.text
          : "",
      )
      .filter(Boolean)
      .join("\n");
  }

  return "";
}

function extractOutputTextFromStreamText(text: string) {
  const events = text.split("\n\n");
  const fragments: string[] = [];
  let finalText = "";

  for (const event of events) {
    const lines = event
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trim());

    for (const line of lines) {
      if (!line || line === "[DONE]") {
        continue;
      }

      const parsed = parseJsonOrNull(line);
      if (!parsed || typeof parsed !== "object") {
        continue;
      }

      const extracted = extractOutputText(parsed);
      if (extracted) {
        finalText = extracted;
      }

      if (
        "delta" in parsed &&
        typeof parsed.delta === "string"
      ) {
        fragments.push(parsed.delta);
      }
    }
  }

  return finalText || fragments.join("");
}

function extractUsageFromStreamText(text: string) {
  const events = text.split("\n\n");
  let usage: unknown;

  for (const event of events) {
    const lines = event
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trim());

    for (const line of lines) {
      if (!line || line === "[DONE]") {
        continue;
      }

      const parsed = parseJsonOrNull(line);
      if (parsed && typeof parsed === "object" && "usage" in parsed) {
        usage = parsed.usage;
      }
    }
  }

  return usage;
}
