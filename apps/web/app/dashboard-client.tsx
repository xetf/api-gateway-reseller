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
import { FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
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
  upstreamProvider?: string | null;
  model: string;
  endpoint: string;
  method?: string;
  status: string;
  httpStatus?: number | null;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  chargedAmountUsd: string;
  upstreamCostUsd?: string;
  latencyMs?: number | null;
  firstTokenLatencyMs?: number | null;
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
    cachedInputTokens: number;
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

type AvailableModel = {
  model: string;
  status: "READY" | "UNAVAILABLE" | string;
  readyChannelCount: number;
};

type ModelPoolChannelStatus = "ACTIVE" | "FORCED_ACTIVE" | "DISABLED" | "UNAVAILABLE";

type ModelPoolChannel = {
  id: string;
  modelPoolId: string;
  upstreamProvider: string;
  status: ModelPoolChannelStatus | string;
  priority: number;
  consecutiveFailures: number;
  lastCheckStatus?: string | null;
  lastCheckedAt?: string | null;
  lastLatencyMs?: number | null;
  lastFirstTokenLatencyMs?: number | null;
  lastError?: string | null;
  checkIntervalSeconds?: number;
  nextCheckAt?: string | null;
  nextCheckRemainingSeconds?: number | null;
  healthCheckVersion?: string | null;
  hasPrice: boolean;
  priceEnabled: boolean;
  providerStatus: string;
  providerPriority?: number | null;
  isChecking?: boolean;
  checkingStartedAt?: string | null;
  effectiveStatus: "READY" | "FORCED_READY" | "UNAVAILABLE" | string;
};

type ModelPool = {
  id: string;
  model: string;
  status: "ACTIVE" | "DISABLED" | string;
  readyChannelCount: number;
  pricedChannelCount: number;
  channels: ModelPoolChannel[];
  createdAt: string;
  updatedAt: string;
};

type AvailablePoolChannel = {
  id: string;
  model: string;
  upstreamProvider: string;
  priceEnabled: boolean;
  providerStatus: string;
};

type ModelPoolHealthCheck = {
  intervalSeconds: number;
  minIntervalSeconds?: number;
  maxIntervalSeconds?: number;
  serverNow: string;
  receivedAtMs: number;
};

type ModelPoolResponse = {
  modelPools: ModelPool[];
  availableChannels: AvailablePoolChannel[];
  healthCheck: {
    intervalSeconds: number;
    minIntervalSeconds?: number;
    maxIntervalSeconds?: number;
    serverNow: string;
  };
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
  { id: "admin-overview", label: "后台总览", description: "收入、成本、余额", icon: Shield },
  { id: "admin-users", label: "用户管理", description: "账号、余额、权限", icon: Users },
  { id: "admin-redeem", label: "兑换码", description: "生成、启停、核销", icon: Ticket },
  { id: "admin-upstreams", label: "上游管理", description: "渠道、密钥、模型价格", icon: Server },
  { id: "admin-model-pools", label: "模型池", description: "模型、渠道、健康检测", icon: SlidersHorizontal },
  { id: "admin-requests", label: "全站调用", description: "账单、请求、审计", icon: Activity },
] as const;

const adminNavGroups = [
  {
    label: "运营",
    items: adminNav.filter((item) =>
      ["admin-overview", "admin-users", "admin-redeem"].includes(item.id),
    ),
  },
  {
    label: "网关",
    items: adminNav.filter((item) =>
      ["admin-upstreams", "admin-model-pools"].includes(item.id),
    ),
  },
  {
    label: "审计",
    items: adminNav.filter((item) => item.id === "admin-requests"),
  },
] as const;

type FrontTab = (typeof frontNav)[number]["id"];
type AdminTab = (typeof adminNav)[number]["id"];
type Tab = FrontTab | AdminTab;
type DashboardMode = "user" | "admin";

const pageMeta: Record<
  Tab,
  {
    eyebrow: string;
    title: string;
    description: string;
  }
> = {
  overview: {
    eyebrow: "前台",
    title: "前台总览",
    description: "账户余额、API Key 和最近调用集中在这里。",
  },
  keys: {
    eyebrow: "前台",
    title: "API Key",
    description: "创建、查看和停用你的调用密钥。",
  },
  wallet: {
    eyebrow: "前台",
    title: "余额兑换",
    description: "兑换余额并查看钱包流水。",
  },
  requests: {
    eyebrow: "前台",
    title: "我的调用",
    description: "查看最近请求、token 用量和扣费。",
  },
  test: {
    eyebrow: "前台",
    title: "调用测试",
    description: "用当前网关快速验证模型调用链路。",
  },
  "admin-overview": {
    eyebrow: "运营中心",
    title: "后台总览",
    description: "收入、成本、毛利、用户余额和全站请求的汇总视图。",
  },
  "admin-users": {
    eyebrow: "运营中心",
    title: "用户管理",
    description: "集中处理账号开通、余额调整、模型白名单和用户状态。",
  },
  "admin-redeem": {
    eyebrow: "运营中心",
    title: "兑换码",
    description: "生成充值码、查看核销记录，并控制兑换码状态。",
  },
  "admin-upstreams": {
    eyebrow: "网关配置",
    title: "上游管理",
    description: "维护上游渠道、访问密钥，以及每个渠道自己的模型价格。",
  },
  "admin-model-pools": {
    eyebrow: "网关配置",
    title: "模型池",
    description: "把用户可见模型映射到可用上游，并查看自动检测状态。",
  },
  "admin-requests": {
    eyebrow: "审计与账单",
    title: "全站调用",
    description: "按用户、模型、状态和时间筛选调用记录与利润数据。",
  },
};

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
  const [modelPools, setModelPools] = useState<ModelPool[]>([]);
  const [poolAvailableChannels, setPoolAvailableChannels] = useState<AvailablePoolChannel[]>([]);
  const [modelPoolHealthCheck, setModelPoolHealthCheck] = useState<ModelPoolHealthCheck | null>(null);
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
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
  const loadingModelPoolsRef = useRef(false);

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
    } catch (refreshError) {
      setError(errorToText(refreshError));
      clearToken();
      setTokenState(null);
      setUser(null);
      setLoading(false);
      return;
    }

    setLoading(false);

    const loadData = async (label: string, task: () => Promise<void>) => {
      try {
        await task();
      } catch (loadError) {
        setError(`${label}加载失败：${errorToText(loadError)}`);
      }
    };

    if (mode === "user") {
      setAdminOverview(null);
      setAdminUsers([]);
      setUpstreamProviders([]);
      setModelPrices([]);
      setModelPools([]);
      setPoolAvailableChannels([]);
      setModelPoolHealthCheck(null);
      setRedeemCodes([]);
      setAdminRequests([]);

      void Promise.allSettled([
        loadData("可用模型", async () => {
          const result = await apiFetch<{ models: AvailableModel[] }>("/models", {
            token: authToken,
          });
          setAvailableModels(result.models);
        }),
        loadData("API Key", async () => {
          const result = await apiFetch<{ apiKeys: ApiKey[] }>("/api-keys", {
            token: authToken,
          });
          setApiKeys(result.apiKeys);
        }),
        loadData("钱包", async () => {
          const result = await apiFetch<{ wallet: Wallet | null; transactions: Transaction[] }>(
            "/wallet",
            { token: authToken },
          );
          setWallet(result.wallet);
          setTransactions(result.transactions);
        }),
        loadData("用量", async () => {
          const result = await apiFetch<Summary>("/usage/summary", { token: authToken });
          setSummary(result);
        }),
      ]);
      return;
    }

    setApiKeys([]);
    setWallet(null);
    setTransactions([]);
    setSummary(null);
    setAvailableModels([]);

    void Promise.allSettled([
      loadData("后台总览", async () => {
        const result = await apiFetch<AdminOverview>("/admin/overview", { token: authToken });
        setAdminOverview(result);
      }),
      loadData("用户", async () => {
        const result = await apiFetch<{ users: AdminUser[] }>("/admin/users", {
          token: authToken,
        });
        setAdminUsers(result.users);
      }),
      loadData("上游", async () => {
        const result = await apiFetch<{ providers: UpstreamProvider[] }>(
          "/admin/upstream-providers",
          { token: authToken },
        );
        setUpstreamProviders(result.providers);
      }),
      loadData("价格", async () => {
        const result = await apiFetch<{ modelPrices: ModelPrice[] }>(
          "/admin/model-prices",
          { token: authToken },
        );
        setModelPrices(result.modelPrices);
      }),
      loadData("模型池", async () => {
        await refreshModelPools(authToken);
      }),
      loadData("兑换码", async () => {
        const result = await apiFetch<{ codes: RedeemCode[] }>("/admin/redeem-codes", {
          token: authToken,
        });
        setRedeemCodes(result.codes);
      }),
      loadData("调用记录", async () => {
        const result = await apiFetch<{ requests: ApiRequest[] }>(
          `/admin/requests${toQueryString(requestFilters)}`,
          { token: authToken },
        );
        setAdminRequests(result.requests);
      }),
    ]);
  }

  const refreshModelPools = useCallback(async (authToken = token) => {
    if (!authToken || loadingModelPoolsRef.current) {
      return;
    }

    loadingModelPoolsRef.current = true;
    try {
      const result = await apiFetch<ModelPoolResponse>("/admin/model-pools", { token: authToken });
      setModelPools(result.modelPools);
      setPoolAvailableChannels(result.availableChannels);
      setModelPoolHealthCheck({
        ...result.healthCheck,
        receivedAtMs: Date.now(),
      });
    } finally {
      loadingModelPoolsRef.current = false;
    }
  }, [token]);

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

  const currentPage = pageMeta[activeTab];

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">A</span>
          API Gateway
        </div>
        <nav className="nav">
          {mode === "admin" ? (
            adminNavGroups.map((group) => (
              <div className="nav-group" key={group.label}>
                <div className="nav-heading">{group.label}</div>
                {group.items.map((item) => (
                  <NavButton
                    key={item.id}
                    item={item}
                    active={activeTab === item.id}
                    onClick={() => setActiveTab(item.id)}
                  />
                ))}
              </div>
            ))
          ) : (
            <div className="nav-group">
              <div className="nav-heading">前台</div>
              {frontNav.map((item) => (
                <NavButton
                  key={item.id}
                  item={item}
                  active={activeTab === item.id}
                  onClick={() => setActiveTab(item.id)}
                />
              ))}
            </div>
          )}
        </nav>
      </aside>
      <section className="main">
        <div className="topbar">
          <div className="page-heading">
            <span className="eyebrow">{currentPage.eyebrow}</span>
            <h1>{currentPage.title}</h1>
            <p>{currentPage.description}</p>
          </div>
          <div className="topbar-side">
            <div className="account-chip">
              <span>{mode === "admin" ? user.username ?? user.email : user.email}</span>
              {user.role === "ADMIN" ? <strong>管理员</strong> : null}
            </div>
            <div className="button-row">
              <button className="button secondary" onClick={() => refreshAll()} type="button">
                <RefreshCw size={17} />
                <span>刷新</span>
              </button>
              <button className="button secondary" onClick={logout} type="button">
                <LogOut size={17} />
                <span>退出</span>
              </button>
            </div>
          </div>
        </div>

        <div className="workspace">
          {error ? <div className="notice">{error}</div> : null}
          {loading ? <p className="muted">加载中...</p> : null}

          {mode === "user" && activeTab === "overview" ? (
            <Overview wallet={wallet} summary={summary} apiKeys={apiKeys} availableModels={availableModels} />
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
            <CallTester availableModels={availableModels} onChanged={() => refreshAll()} onError={setError} />
          ) : null}
          {mode === "admin" && activeTab === "admin-overview" ? (
            <AdminOverviewPanel overview={adminOverview} />
          ) : null}
          {mode === "admin" && activeTab === "admin-upstreams" ? (
            <UpstreamProviders
              providers={upstreamProviders}
              modelPrices={modelPrices}
              onChanged={() => refreshAll()}
              onError={setError}
            />
          ) : null}
          {mode === "admin" && activeTab === "admin-model-pools" ? (
            <AdminModelPools
              modelPools={modelPools}
              availableChannels={poolAvailableChannels}
              healthCheck={modelPoolHealthCheck}
              onRefreshModelPools={() => refreshModelPools()}
              onChanged={() => refreshAll()}
              onError={setError}
            />
          ) : null}
          {mode === "admin" && activeTab === "admin-users" ? (
            <AdminUsers
              users={adminUsers}
              modelPools={modelPools}
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
          {mode === "admin" && activeTab === "admin-requests" ? (
            <AdminRequests
              requests={adminRequests}
              users={adminUsers}
              filters={requestFilters}
              onFiltersChange={setRequestFilters}
              onSearch={() => refreshAll()}
            />
          ) : null}
        </div>
      </section>
    </main>
  );
}

function NavButton({
  item,
  active,
  onClick,
}: {
  item: { id: string; label: string; description?: string; icon: typeof BarChart3 };
  active: boolean;
  onClick: () => void;
}) {
  const Icon = item.icon;
  return (
    <button className={active ? "active" : ""} onClick={onClick} type="button">
      <Icon size={18} />
      <span>
        <strong>{item.label}</strong>
        {item.description ? <small>{item.description}</small> : null}
      </span>
    </button>
  );
}

function ModalShell({
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
    <div className="modal-backdrop" role="presentation">
      <div className={wide ? "form-modal modal-wide" : "form-modal"} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-header">
          <div>
            <h2>{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>
          <button className="modal-close" onClick={onClose} type="button">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
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
  const [password, setPassword] = useState("");
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
  availableModels,
}: {
  wallet: Wallet | null;
  summary: Summary | null;
  apiKeys: ApiKey[];
  availableModels: AvailableModel[];
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
      <AvailableModelsPanel models={availableModels} />
      <Requests requests={summary?.requests.slice(0, 8) ?? []} compact />
    </div>
  );
}

function AvailableModelsPanel({ models }: { models: AvailableModel[] }) {
  return (
    <section className="card">
      <div className="section-head">
        <div>
          <h2 className="section-title">可用模型</h2>
          <p className="section-subtitle">这里只显示当前可以调用的模型池。</p>
        </div>
        <StatusPill status={models.length > 0 ? "READY" : "UNAVAILABLE"} />
      </div>
      {models.length > 0 ? (
        <div className="chip-row">
          {models.map((item) => (
            <span className="chip info-chip" key={item.model}>
              {item.model} · {item.readyChannelCount} 个上游
            </span>
          ))}
        </div>
      ) : (
        <div className="empty-cell">暂无可用模型</div>
      )}
    </section>
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
          <div className="mobile-record-list">
            {apiKeys.map((key) => (
              <MobileRecord
                key={key.id}
                title={key.name}
                meta={dateTime(key.createdAt)}
                badges={<StatusPill status={key.status} />}
                actions={
                  <>
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
                  </>
                }
              >
                <MobileField label="API Key" wide>
                  <code className="inline-secret">{key.keySecret ?? key.keyPrefix}</code>
                </MobileField>
                <MobileField label="限流">{key.rateLimitPerMinute}/min</MobileField>
                <MobileField label="创建时间">{dateTime(key.createdAt)}</MobileField>
              </MobileRecord>
            ))}
            {apiKeys.length === 0 ? <MobileEmpty>暂无 API Key</MobileEmpty> : null}
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
      <div className="mobile-record-list">
        {transactions.map((item) => (
          <MobileRecord
            key={item.id}
            title={item.type}
            meta={dateTime(item.createdAt)}
            badges={<span className="pill strong">${money(item.amount)}</span>}
          >
            <MobileField label="之前">${money(item.balanceBefore)}</MobileField>
            <MobileField label="之后">${money(item.balanceAfter)}</MobileField>
            <MobileField label="备注" wide>
              {item.remark || "-"}
            </MobileField>
          </MobileRecord>
        ))}
        {transactions.length === 0 ? <MobileEmpty>暂无账本流水</MobileEmpty> : null}
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
              {showCost ? <th>上游</th> : null}
              <th>模型</th>
              <th>状态</th>
              <th>输入</th>
              <th>缓存</th>
              <th>输出</th>
              <th>总 token</th>
              <th>扣费</th>
              {showCost ? <th>上游成本</th> : null}
              {showCost ? <th>毛利</th> : null}
              <th>总时间</th>
              <th>首 token</th>
              <th>时间</th>
            </tr>
          </thead>
          <tbody>
            {requests.map((item) => (
              <tr key={item.id}>
                {showCost ? <td>{item.user?.email ?? "-"}</td> : null}
                {showCost ? <td>{item.upstreamProvider ?? "-"}</td> : null}
                <td>{item.model}</td>
                <td>
                  <StatusPill status={item.status} />
                </td>
                <td>{formatNumber(item.inputTokens)}</td>
                <td>{formatNumber(item.cachedInputTokens)}</td>
                <td>{formatNumber(item.outputTokens)}</td>
                <td>{formatNumber(item.totalTokens)}</td>
                <td>${money(item.chargedAmountUsd)}</td>
                {showCost ? <td>${money(item.upstreamCostUsd ?? "0")}</td> : null}
                {showCost ? (
                  <td>${money(Number(item.chargedAmountUsd) - Number(item.upstreamCostUsd ?? 0))}</td>
                ) : null}
                <td>{seconds(item.latencyMs)}</td>
                <td>{seconds(item.firstTokenLatencyMs)}</td>
                <td>{dateTime(item.createdAt)}</td>
              </tr>
            ))}
            {requests.length === 0 ? <EmptyRow colSpan={showCost ? 14 : 10} /> : null}
          </tbody>
        </table>
      </div>
      <div className="mobile-record-list">
        {requests.map((item) => (
          <MobileRecord
            key={item.id}
            title={item.model}
            meta={dateTime(item.createdAt)}
            badges={<StatusPill status={item.status} />}
          >
            {showCost ? (
              <>
                <MobileField label="用户" wide>
                  {item.user?.email ?? "-"}
                </MobileField>
                <MobileField label="上游" wide>
                  {item.upstreamProvider ?? "-"}
                </MobileField>
              </>
            ) : null}
            <MobileField label="输入">{formatNumber(item.inputTokens)}</MobileField>
            <MobileField label="缓存">{formatNumber(item.cachedInputTokens)}</MobileField>
            <MobileField label="输出">{formatNumber(item.outputTokens)}</MobileField>
            <MobileField label="总 token">{formatNumber(item.totalTokens)}</MobileField>
            <MobileField label="扣费">${money(item.chargedAmountUsd)}</MobileField>
            {showCost ? (
              <>
                <MobileField label="上游成本">${money(item.upstreamCostUsd ?? "0")}</MobileField>
                <MobileField label="毛利">
                  ${money(Number(item.chargedAmountUsd) - Number(item.upstreamCostUsd ?? 0))}
                </MobileField>
              </>
            ) : null}
            <MobileField label="总时间">{seconds(item.latencyMs)}</MobileField>
            <MobileField label="首 token">{seconds(item.firstTokenLatencyMs)}</MobileField>
          </MobileRecord>
        ))}
        {requests.length === 0 ? <MobileEmpty>暂无调用记录</MobileEmpty> : null}
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
    <div className="grid admin-page">
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
  availableModels,
  onChanged,
  onError,
}: {
  availableModels: AvailableModel[];
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
  const readyModelNames = availableModels.map((item) => item.model);
  const readyModelKey = readyModelNames.join("|");

  useEffect(() => {
    if (readyModelNames.length > 0 && !readyModelNames.includes(model)) {
      setModel(readyModelNames[0] ?? model);
    }
  }, [readyModelKey, model]);

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
              {readyModelNames.length > 0 ? (
                <select className="input" value={model} onChange={(event) => setModel(event.target.value)}>
                  {readyModelNames.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              ) : (
                <input className="input" value={model} onChange={(event) => setModel(event.target.value)} />
              )}
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
            <Metric label="耗时" value={seconds(result.latencyMs)} />
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
    <div className="grid admin-page">
      <div className="grid cols-3 metric-row">
        <Metric label="用户数" value={String(overview?.users ?? 0)} />
        <Metric label="总请求数" value={String(overview?.requests ?? 0)} />
        <Metric label="总 token" value={formatNumber(overview?.totalTokens ?? 0)} />
      </div>
      <div className="grid cols-3 metric-row">
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
  modelPools,
  onChanged,
  onError,
}: {
  users: AdminUser[];
  modelPools: ModelPool[];
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
  const [userModal, setUserModal] = useState<"create" | "balance" | "models" | null>(null);
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [editEmail, setEditEmail] = useState("");
  const [editName, setEditName] = useState("");
  const [editRole, setEditRole] = useState<"USER" | "ADMIN">("USER");
  const [editStatus, setEditStatus] = useState<"ACTIVE" | "DISABLED">("ACTIVE");
  const [editPassword, setEditPassword] = useState("");
  const [editAllowedModels, setEditAllowedModels] = useState("");
  const selectedUserId = targetUserId || users[0]?.id || "";
  const selectedUser = users.find((item) => item.id === selectedUserId);
  const modelSuggestions = modelPools.map((pool) => pool.model);
  const filteredUsers = users.filter((item) =>
    `${item.email} ${item.role} ${item.status}`
      .toLowerCase()
      .includes(userSearch.trim().toLowerCase()),
  );

  useEffect(() => {
    setAllowedModelsText((selectedUser?.allowedModels ?? []).join("\n"));
  }, [selectedUser?.id]);

  function beginEditUser(item: AdminUser) {
    setUserModal(null);
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
      setUserModal(null);
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
      setUserModal(null);
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
      setUserModal(null);
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
    <>
      <div className="grid admin-page">
        <section className="action-panel">
          <div>
            <h2>用户操作</h2>
            <p>创建账号、调整余额和设置模型权限都从弹窗完成。</p>
          </div>
          <div className="button-row">
            <button
              className="button"
              onClick={() => {
                setEditingUser(null);
                setUserModal("create");
              }}
              type="button"
            >
              <Plus size={17} />
              创建用户
            </button>
            <button
              className="button secondary"
              onClick={() => {
                setEditingUser(null);
                setUserModal("balance");
              }}
              type="button"
            >
              <CreditCard size={17} />
              余额调整
            </button>
            <button
              className="button secondary"
              onClick={() => {
                setEditingUser(null);
                setUserModal("models");
              }}
              type="button"
            >
              <SlidersHorizontal size={17} />
              模型白名单
            </button>
          </div>
        </section>

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
          <div className="mobile-record-list">
            {filteredUsers.map((item) => (
              <MobileRecord
                key={item.id}
                title={item.email}
                meta={dateTime(item.createdAt)}
                badges={
                  <>
                    <StatusPill status={item.status} />
                    <span className="pill">{item.role}</span>
                  </>
                }
                actions={
                  <>
                    <button className="button secondary" onClick={() => beginEditUser(item)} type="button">
                      编辑
                    </button>
                    <button className="button secondary" onClick={() => toggleUserStatus(item)} type="button">
                      {item.status === "ACTIVE" ? "停用" : "启用"}
                    </button>
                    <button className="button danger" onClick={() => deleteUser(item)} type="button">
                      删除
                    </button>
                  </>
                }
              >
                <MobileField label="余额">${money(item.wallet?.balance ?? "0")}</MobileField>
                <MobileField label="Key">{item._count.apiKeys}</MobileField>
                <MobileField label="请求">{item._count.apiRequests}</MobileField>
                <MobileField label="模型白名单" wide>
                  {item.allowedModels.length > 0 ? item.allowedModels.join(", ") : "不限"}
                </MobileField>
              </MobileRecord>
            ))}
            {filteredUsers.length === 0 ? <MobileEmpty>暂无用户</MobileEmpty> : null}
          </div>
        </section>
      </div>

      {userModal === "create" ? (
        <ModalShell title="创建用户" description="给客户开账号和初始余额。" onClose={() => setUserModal(null)}>
          <form className="form" onSubmit={createUser}>
            <div className="modal-body">
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
            </div>
            <div className="modal-footer">
              <button className="button secondary" onClick={() => setUserModal(null)} type="button">
                取消
              </button>
              <button className="button" type="submit">
                <Users size={17} />
                创建用户
              </button>
            </div>
          </form>
        </ModalShell>
      ) : null}

      {userModal === "balance" ? (
        <ModalShell title="余额调整" description="正数加余额，负数扣余额。" onClose={() => setUserModal(null)}>
          <form className="form" onSubmit={adjustBalance}>
            <div className="modal-body">
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
            </div>
            <div className="modal-footer">
              <button className="button secondary" onClick={() => setUserModal(null)} type="button">
                取消
              </button>
              <button className="button" type="submit">
                <CreditCard size={17} />
                调整余额
              </button>
            </div>
          </form>
        </ModalShell>
      ) : null}

      {userModal === "models" ? (
        <ModalShell title="模型白名单" description="留空表示该用户不限模型。" onClose={() => setUserModal(null)}>
          <form className="form" onSubmit={saveAllowedModels}>
            <div className="modal-body">
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
                {modelSuggestions.slice(0, 8).map((modelName) => (
                  <button
                    className="chip"
                    key={modelName}
                    onClick={() =>
                      setAllowedModelsText((current) =>
                        Array.from(new Set([...parseModelList(current), modelName])).join("\n"),
                      )
                    }
                    type="button"
                  >
                    + {modelName}
                  </button>
                ))}
              </div>
            </div>
            <div className="modal-footer">
              <button className="button secondary" onClick={() => setUserModal(null)} type="button">
                取消
              </button>
              <button className="button" type="submit">
                <Save size={17} />
                保存白名单
              </button>
            </div>
          </form>
        </ModalShell>
      ) : null}

      {editingUser ? (
        <ModalShell title="编辑用户" description={editingUser.email} onClose={() => setEditingUser(null)} wide>
          <form className="form" onSubmit={saveEditingUser}>
            <div className="modal-body">
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
                {modelSuggestions.slice(0, 8).map((modelName) => (
                  <button
                    className="chip"
                    key={modelName}
                    onClick={() =>
                      setEditAllowedModels((current) =>
                        Array.from(new Set([...parseModelList(current), modelName])).join("\n"),
                      )
                    }
                    type="button"
                  >
                    + {modelName}
                  </button>
                ))}
              </div>
            </div>
            <div className="modal-footer">
              <button className="button secondary" onClick={() => setEditingUser(null)} type="button">
                取消
              </button>
              <button className="button" type="submit">
                <Save size={17} />
                保存用户
              </button>
            </div>
          </form>
        </ModalShell>
      ) : null}
    </>
  );
}

function AdminModelPools({
  modelPools,
  availableChannels,
  healthCheck,
  onRefreshModelPools,
  onChanged,
  onError,
}: {
  modelPools: ModelPool[];
  availableChannels: AvailablePoolChannel[];
  healthCheck: ModelPoolHealthCheck | null;
  onRefreshModelPools: () => void;
  onChanged: () => void;
  onError: (error: string | null) => void;
}) {
  const [createModel, setCreateModel] = useState("");
  const [healthIntervalSeconds, setHealthIntervalSeconds] = useState("30");
  const [channelSelections, setChannelSelections] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const refreshTriggeredForKeyRef = useRef("");
  const lastDueRefreshAtRef = useRef(0);
  const existingModels = new Set(modelPools.map((pool) => pool.model));
  const pricedModels = Array.from(new Set(availableChannels.map((channel) => channel.model))).sort();
  const creatableModels = pricedModels.filter((model) => !existingModels.has(model));
  const creatableModelKey = creatableModels.join("|");
  const selectedCreateModel = createModel || creatableModels[0] || "";

  useEffect(() => {
    if (healthCheck) {
      setHealthIntervalSeconds(String(healthCheck.intervalSeconds));
    }
  }, [healthCheck?.intervalSeconds]);

  useEffect(() => {
    if (creatableModels.length > 0 && (!createModel || !creatableModels.includes(createModel))) {
      setCreateModel(creatableModels[0] ?? "");
    }
  }, [creatableModelKey, createModel]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void onRefreshModelPools();
    }, 2000);

    return () => window.clearInterval(timer);
  }, [onRefreshModelPools]);

  useEffect(() => {
    const dueChannelIds = modelPools
      .flatMap((pool) => pool.channels)
      .filter((channel) => nextCheckState(channel, healthCheck, nowMs).isWaitingForResult)
      .map((channel) => `${channel.id}:${channel.nextCheckAt ?? ""}:${channel.isChecking ? "checking" : "due"}`)
      .sort();
    const dueKey = dueChannelIds.join("|");
    const canRetryDueRefresh = nowMs - lastDueRefreshAtRef.current > 2000;

    if (!dueKey || (refreshTriggeredForKeyRef.current === dueKey && !canRetryDueRefresh)) {
      return;
    }

    refreshTriggeredForKeyRef.current = dueKey;
    lastDueRefreshAtRef.current = nowMs;
    void onRefreshModelPools();
  }, [modelPools, healthCheck, nowMs, onRefreshModelPools]);

  function channelsForPool(pool: ModelPool) {
    const existingChannels = new Set(pool.channels.map((channel) => channel.upstreamProvider));
    return availableChannels.filter(
      (channel) =>
        channel.model === pool.model &&
        channel.upstreamProvider.trim().toLowerCase() !== "default" &&
        !existingChannels.has(channel.upstreamProvider),
    );
  }

  async function createPool(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onError(null);

    if (!selectedCreateModel) {
      onError("请先在上游管理里给模型配置价格。");
      return;
    }

    try {
      await apiFetch("/admin/model-pools", {
        method: "POST",
        body: JSON.stringify({ model: selectedCreateModel, status: "ACTIVE" }),
      });
      setCreateModel("");
      onChanged();
    } catch (createError) {
      onError(errorToText(createError));
    }
  }

  async function setPoolStatus(pool: ModelPool, status: "ACTIVE" | "DISABLED") {
    onError(null);
    setBusyId(pool.id);
    try {
      await apiFetch(`/admin/model-pools/${pool.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      onChanged();
    } catch (updateError) {
      onError(errorToText(updateError));
    } finally {
      setBusyId(null);
    }
  }

  async function deletePool(pool: ModelPool) {
    const confirmed = window.confirm(`确定删除模型池「${pool.model}」吗？池内上游渠道会一起移除，但上游定价不会被删除。`);

    if (!confirmed) {
      return;
    }

    onError(null);
    setBusyId(pool.id);
    try {
      await apiFetch(`/admin/model-pools/${pool.id}`, {
        method: "DELETE",
      });
      onChanged();
    } catch (deleteError) {
      onError(errorToText(deleteError));
    } finally {
      setBusyId(null);
    }
  }

  async function addChannel(pool: ModelPool) {
    const selectableChannels = channelsForPool(pool);
    const upstreamProvider = channelSelections[pool.id] || selectableChannels[0]?.upstreamProvider || "";

    if (!upstreamProvider) {
      onError("这个模型暂时没有可添加的上游渠道。");
      return;
    }

    onError(null);
    setBusyId(pool.id);
    try {
      await apiFetch(`/admin/model-pools/${pool.id}/channels`, {
        method: "POST",
        body: JSON.stringify({ upstreamProvider, status: "ACTIVE" }),
      });
      setChannelSelections((current) => ({ ...current, [pool.id]: "" }));
      onChanged();
    } catch (addError) {
      onError(errorToText(addError));
    } finally {
      setBusyId(null);
    }
  }

  async function setChannelStatus(channel: ModelPoolChannel, status: ModelPoolChannelStatus) {
    onError(null);
    setBusyId(channel.id);
    try {
      await apiFetch(`/admin/model-pool-channels/${channel.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      onChanged();
    } catch (updateError) {
      onError(errorToText(updateError));
    } finally {
      setBusyId(null);
    }
  }

  async function checkChannel(channel: ModelPoolChannel) {
    onError(null);
    setBusyId(channel.id);
    try {
      await apiFetch(`/admin/model-pool-channels/${channel.id}/check`, {
        method: "POST",
      });
      onChanged();
    } catch (checkError) {
      onError(errorToText(checkError));
    } finally {
      setBusyId(null);
    }
  }

  async function deleteChannel(channel: ModelPoolChannel) {
    const confirmed = window.confirm(`确定从模型池移除「${channel.upstreamProvider}」吗？`);

    if (!confirmed) {
      return;
    }

    onError(null);
    setBusyId(channel.id);
    try {
      await apiFetch(`/admin/model-pool-channels/${channel.id}`, {
        method: "DELETE",
      });
      onChanged();
    } catch (deleteError) {
      onError(errorToText(deleteError));
    } finally {
      setBusyId(null);
    }
  }

  async function updateHealthInterval(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onError(null);

    const intervalSeconds = Number(healthIntervalSeconds);
    const minIntervalSeconds = healthCheck?.minIntervalSeconds ?? 5;
    const maxIntervalSeconds = healthCheck?.maxIntervalSeconds ?? 3600;

    if (!Number.isInteger(intervalSeconds) || intervalSeconds < minIntervalSeconds || intervalSeconds > maxIntervalSeconds) {
      onError(`自动检测间隔必须是 ${minIntervalSeconds}-${maxIntervalSeconds} 秒之间的整数。`);
      return;
    }

    setBusyId("health-check");
    try {
      await apiFetch("/admin/model-pools/health-check", {
        method: "PATCH",
        body: JSON.stringify({ intervalSeconds }),
      });
      onChanged();
    } catch (updateError) {
      onError(errorToText(updateError));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="grid admin-page">
      <section className="action-panel">
        <div>
          <h2>模型池操作</h2>
          <p>模型池决定用户侧能看到和能调用的模型。</p>
        </div>
        <div className="action-panel-tools">
          <form className="button-row" onSubmit={updateHealthInterval}>
            <label className="inline-field">
              <span>自动检测间隔</span>
              <input
                className="input interval-input"
                max={healthCheck?.maxIntervalSeconds ?? 3600}
                min={healthCheck?.minIntervalSeconds ?? 5}
                step={1}
                type="number"
                value={healthIntervalSeconds}
                onChange={(event) => setHealthIntervalSeconds(event.target.value)}
              />
              <span>秒</span>
            </label>
            <button className="button secondary" disabled={busyId === "health-check"} type="submit">
              <Save size={16} />
              保存间隔
            </button>
          </form>
          <form className="button-row" onSubmit={createPool}>
            <select
              className="input compact-select"
              disabled={creatableModels.length === 0}
              value={selectedCreateModel}
              onChange={(event) => setCreateModel(event.target.value)}
            >
              {creatableModels.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
              {creatableModels.length === 0 ? <option value="">暂无可添加模型</option> : null}
            </select>
            <button className="button" disabled={creatableModels.length === 0} type="submit">
              <Plus size={17} />
              添加模型池
            </button>
          </form>
        </div>
      </section>

      <section className="card">
        <div className="section-head">
          <div>
            <h2 className="section-title">模型池列表</h2>
            <p className="section-subtitle">只有 ACTIVE 模型池且至少一个渠道 READY 时，用户侧才可调用。</p>
          </div>
          <StatusPill status={modelPools.some((pool) => pool.readyChannelCount > 0) ? "READY" : "UNAVAILABLE"} />
        </div>
        <div className="provider-stack">
          {modelPools.map((pool) => {
            const selectableChannels = channelsForPool(pool);
            const selectedChannel =
              channelSelections[pool.id] || selectableChannels[0]?.upstreamProvider || "";

            return (
              <section className="provider-panel" key={pool.id}>
                <div className="provider-head">
                  <div>
                    <div className="provider-title">
                      <strong>{pool.model}</strong>
                      <StatusPill status={pool.status} />
                      <StatusPill status={pool.readyChannelCount > 0 ? "READY" : "UNAVAILABLE"} />
                    </div>
                    <p>
                      可调用 {pool.readyChannelCount} 个 · 已定价 {pool.pricedChannelCount} 个 · 已加入 {pool.channels.length} 个
                    </p>
                  </div>
                  <div className="button-row">
                    {pool.status === "ACTIVE" ? (
                      <button
                        className="button secondary"
                        disabled={busyId === pool.id}
                        onClick={() => setPoolStatus(pool, "DISABLED")}
                        type="button"
                      >
                        停用模型池
                      </button>
                    ) : (
                      <button
                        className="button"
                        disabled={busyId === pool.id}
                        onClick={() => setPoolStatus(pool, "ACTIVE")}
                        type="button"
                      >
                        启用模型池
                      </button>
                    )}
                    <button
                      className="button danger"
                      disabled={busyId === pool.id}
                      onClick={() => deletePool(pool)}
                      type="button"
                    >
                      <Trash2 size={15} />
                      删除模型池
                    </button>
                  </div>
                </div>

                <div className="section-head compact-head">
                  <div>
                    <h3 className="section-title">上游渠道</h3>
                    <p className="section-subtitle">
                      自动检测按当前设置每 {healthCheck?.intervalSeconds ?? 30} 秒执行一次，连续两次失败会标记为 UNAVAILABLE；人工可用不会被自动检测降级。
                    </p>
                  </div>
                  <div className="button-row">
                    <select
                      className="input compact-select"
                      disabled={selectableChannels.length === 0}
                      value={selectedChannel}
                      onChange={(event) =>
                        setChannelSelections((current) => ({ ...current, [pool.id]: event.target.value }))
                      }
                    >
                      {selectableChannels.map((channel) => (
                        <option key={channel.id} value={channel.upstreamProvider}>
                          {channel.upstreamProvider} · {channel.priceEnabled ? "价格启用" : "价格停用"} · {channel.providerStatus}
                        </option>
                      ))}
                      {selectableChannels.length === 0 ? <option value="">暂无可添加渠道</option> : null}
                    </select>
                    <button
                      className="button secondary"
                      disabled={busyId === pool.id || !selectedChannel}
                      onClick={() => addChannel(pool)}
                      type="button"
                    >
                      <Plus size={17} />
                      添加渠道
                    </button>
                  </div>
                </div>

                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>上游</th>
                        <th>可调用</th>
                        <th>池状态</th>
                        <th>价格</th>
                        <th>上游状态</th>
                        <th>优先级</th>
                        <th>连续失败</th>
                        <th>上次检测</th>
                        <th>下次检测</th>
                        <th>首字</th>
                        <th>总耗时</th>
                        <th>错误</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pool.channels.map((channel) => (
                        <tr key={channel.id}>
                          <td>{channel.upstreamProvider}</td>
                          <td>
                            <StatusPill status={channel.effectiveStatus} strong />
                          </td>
                          <td>
                            <StatusPill status={channel.status} />
                          </td>
                          <td>
                            <StatusPill status={channel.hasPrice && channel.priceEnabled ? "ACTIVE" : "DISABLED"} />
                          </td>
                          <td>
                            <StatusPill status={channel.providerStatus} />
                          </td>
                          <td>{channel.priority}</td>
                          <td>{channel.consecutiveFailures}</td>
                          <td>{channel.lastCheckedAt ? dateTime(channel.lastCheckedAt) : "-"}</td>
                          <td>{nextCheckCountdown(channel, healthCheck, nowMs)}</td>
                          <td>{seconds(channel.lastFirstTokenLatencyMs)}</td>
                          <td>{seconds(channel.lastLatencyMs)}</td>
                          <td className="muted-cell">{channel.lastError ?? "-"}</td>
                          <td>
                            <div className="button-row compact">
                              <button
                                className="button secondary"
                                disabled={busyId === channel.id}
                                onClick={() => checkChannel(channel)}
                                type="button"
                              >
                                检测
                              </button>
                              {channel.status !== "FORCED_ACTIVE" ? (
                                <button
                                  className="button"
                                  disabled={busyId === channel.id}
                                  onClick={() => setChannelStatus(channel, "FORCED_ACTIVE")}
                                  type="button"
                                >
                                  人工可用
                                </button>
                              ) : null}
                              {channel.status === "ACTIVE" || channel.status === "FORCED_ACTIVE" ? (
                                <button
                                  className="button secondary"
                                  disabled={busyId === channel.id}
                                  onClick={() => setChannelStatus(channel, "DISABLED")}
                                  type="button"
                                >
                                  停用
                                </button>
                              ) : (
                                <button
                                  className="button secondary"
                                  disabled={busyId === channel.id}
                                  onClick={() => setChannelStatus(channel, "ACTIVE")}
                                  type="button"
                                >
                                  自动可用
                                </button>
                              )}
                              <button
                                className="button danger"
                                disabled={busyId === channel.id}
                                onClick={() => deleteChannel(channel)}
                                type="button"
                              >
                                <Trash2 size={15} />
                                删除
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {pool.channels.length === 0 ? <EmptyRow colSpan={12} /> : null}
                    </tbody>
                </table>
              </div>
              <div className="mobile-record-list">
                {pool.channels.map((channel) => (
                  <MobileRecord
                    key={channel.id}
                    title={channel.upstreamProvider}
                    meta={channel.lastCheckedAt ? `上次检测 ${dateTime(channel.lastCheckedAt)}` : "尚未检测"}
                    badges={<StatusPill status={channel.effectiveStatus} strong />}
                    actions={
                      <>
                        <button
                          className="button secondary"
                          disabled={busyId === channel.id}
                          onClick={() => checkChannel(channel)}
                          type="button"
                        >
                          检测
                        </button>
                        {channel.status !== "FORCED_ACTIVE" ? (
                          <button
                            className="button"
                            disabled={busyId === channel.id}
                            onClick={() => setChannelStatus(channel, "FORCED_ACTIVE")}
                            type="button"
                          >
                            人工可用
                          </button>
                        ) : null}
                        {channel.status === "ACTIVE" || channel.status === "FORCED_ACTIVE" ? (
                          <button
                            className="button secondary"
                            disabled={busyId === channel.id}
                            onClick={() => setChannelStatus(channel, "DISABLED")}
                            type="button"
                          >
                            停用
                          </button>
                        ) : (
                          <button
                            className="button secondary"
                            disabled={busyId === channel.id}
                            onClick={() => setChannelStatus(channel, "ACTIVE")}
                            type="button"
                          >
                            自动可用
                          </button>
                        )}
                        <button
                          className="button danger"
                          disabled={busyId === channel.id}
                          onClick={() => deleteChannel(channel)}
                          type="button"
                        >
                          删除
                        </button>
                      </>
                    }
                  >
                    <MobileField label="池状态">
                      <StatusPill status={channel.status} />
                    </MobileField>
                    <MobileField label="价格">
                      <StatusPill status={channel.hasPrice && channel.priceEnabled ? "ACTIVE" : "DISABLED"} />
                    </MobileField>
                    <MobileField label="上游状态">
                      <StatusPill status={channel.providerStatus} />
                    </MobileField>
                    <MobileField label="优先级">{channel.priority}</MobileField>
                    <MobileField label="连续失败">{channel.consecutiveFailures}</MobileField>
                    <MobileField label="下次检测">{nextCheckCountdown(channel, healthCheck, nowMs)}</MobileField>
                    <MobileField label="首字">{seconds(channel.lastFirstTokenLatencyMs)}</MobileField>
                    <MobileField label="总耗时">{seconds(channel.lastLatencyMs)}</MobileField>
                    <MobileField label="错误" wide>
                      {channel.lastError ?? "-"}
                    </MobileField>
                  </MobileRecord>
                ))}
                {pool.channels.length === 0 ? <MobileEmpty>暂无上游渠道</MobileEmpty> : null}
              </div>
            </section>
            );
          })}
          {modelPools.length === 0 ? <div className="empty-cell">暂无模型池</div> : null}
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
  const [redeemModalOpen, setRedeemModalOpen] = useState(false);
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
      setRedeemModalOpen(false);
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
    <>
      <div className="grid admin-page">
        <section className="action-panel">
          <div>
            <h2>兑换码操作</h2>
            <p>生成规则放进弹窗，生成后的明文会在页面上保留一次。</p>
          </div>
          <button className="button" onClick={() => setRedeemModalOpen(true)} type="button">
            <Plus size={17} />
            生成兑换码
          </button>
        </section>

        {generated.length > 0 ? (
          <section className="card">
            <div className="section-head">
              <div>
                <h2 className="section-title">刚生成的兑换码</h2>
                <p className="section-subtitle">明文只在本次生成后显示。</p>
              </div>
            </div>
            <pre className="code-block">
              {generated.map((item) => `${item.code}  $${money(item.amount)}`).join("\n")}
            </pre>
          </section>
        ) : null}

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
          <div className="mobile-record-list">
            {filteredCodes.map((code) => (
              <MobileRecord
                key={code.id}
                title={code.codePrefix}
                meta={code.expiresAt ? `过期 ${dateTime(code.expiresAt)}` : "永不过期"}
                badges={<StatusPill status={code.status} />}
                actions={
                  <button className="button secondary" onClick={() => toggleCode(code)} type="button">
                    {code.status === "ACTIVE" ? "停用" : "启用"}
                  </button>
                }
              >
                <MobileField label="金额">${money(code.amount)}</MobileField>
                <MobileField label="兑换">
                  {code.redeemedCount}/{code.maxRedemptions}
                </MobileField>
                <MobileField label="最近兑换" wide>
                  {code.redemptions?.[0]?.user.email ?? "-"}
                </MobileField>
                <MobileField label="备注" wide>
                  {code.remark || "-"}
                </MobileField>
              </MobileRecord>
            ))}
            {filteredCodes.length === 0 ? <MobileEmpty>暂无兑换码</MobileEmpty> : null}
          </div>
        </section>
      </div>

      {redeemModalOpen ? (
        <ModalShell title="生成兑换码" description="选择额度和有效期，生成后明文只显示一次。" onClose={() => setRedeemModalOpen(false)} wide>
          <form className="form" onSubmit={createCodes}>
            <div className="modal-body">
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
            </div>
            <div className="modal-footer">
              <button className="button secondary" onClick={() => setRedeemModalOpen(false)} type="button">
                取消
              </button>
              <button className="button" type="submit">
                <Ticket size={17} />
                生成
              </button>
            </div>
          </form>
        </ModalShell>
      ) : null}
    </>
  );
}

function UpstreamProviders({
  providers,
  modelPrices,
  onChanged,
  onError,
}: {
  providers: UpstreamProvider[];
  modelPrices: ModelPrice[];
  onChanged: () => void;
  onError: (error: string | null) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("upstream-1");
  const [baseUrl, setBaseUrl] = useState("https://api.openai.com");
  const [apiKey, setApiKey] = useState("");
  const [priority, setPriority] = useState(100);
  const [timeoutSeconds, setTimeoutSeconds] = useState(120);
  const [busyProviderId, setBusyProviderId] = useState<string | null>(null);
  const [providerModalOpen, setProviderModalOpen] = useState(false);
  const [editingPriceId, setEditingPriceId] = useState<string | null>(null);
  const [priceProvider, setPriceProvider] = useState("");
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
  const [priceModalOpen, setPriceModalOpen] = useState(false);
  const [busyPriceId, setBusyPriceId] = useState<string | null>(null);
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

    if (!priceProvider) {
      onError("请选择上游渠道。");
      return;
    }

    try {
      await apiFetch(editingPriceId ? `/admin/model-prices/${editingPriceId}` : "/admin/model-prices", {
        method: editingPriceId ? "PUT" : "POST",
        body: JSON.stringify({
          model,
          upstreamProvider: priceProvider,
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
      setEditingPriceId(null);
      setPriceModalOpen(false);
      onChanged();
    } catch (saveError) {
      onError(errorToText(saveError));
    }
  }

  function editPrice(price: ModelPrice) {
    setEditingPriceId(price.id);
    setPriceProvider(price.upstreamProvider);
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
    setPriceModalOpen(true);
  }

  function openCreatePrice(providerName: string) {
    setEditingPriceId(null);
    setPriceProvider(providerName);
    setModel("gpt-4o-mini");
    setUpstreamInput("5");
    setUpstreamCachedInput("0.5");
    setUpstreamOutput("30");
    setUpstreamMultiplier("0.06");
    setCustomerInput("5");
    setCustomerCachedInput("0.5");
    setCustomerOutput("30");
    setCustomerMultiplier("0.12");
    setEnabled(true);
    setPriceModalOpen(true);
  }

  async function togglePrice(price: ModelPrice) {
    onError(null);
    setBusyPriceId(price.id);
    try {
      await apiFetch(`/admin/model-prices/${price.id}`, {
        method: "PUT",
        body: JSON.stringify({ enabled: !price.enabled }),
      });
      onChanged();
    } catch (updateError) {
      onError(errorToText(updateError));
    } finally {
      setBusyPriceId(null);
    }
  }

  async function deletePrice(price: ModelPrice) {
    const confirmed = window.confirm(`确定删除模型价格「${price.upstreamProvider} / ${price.model}」吗？`);

    if (!confirmed) {
      return;
    }

    onError(null);
    setBusyPriceId(price.id);

    try {
      await apiFetch(`/admin/model-prices/${price.id}`, {
        method: "DELETE",
      });
      onChanged();
    } catch (deleteError) {
      onError(errorToText(deleteError));
    } finally {
      setBusyPriceId(null);
    }
  }

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
      timeoutMs: Math.round(Number(timeoutSeconds) * 1000),
      status: "ACTIVE",
    };

    try {
      await apiFetch(editingId ? `/admin/upstream-providers/${editingId}` : "/admin/upstream-providers", {
        method: editingId ? "PATCH" : "POST",
        body: JSON.stringify(body),
      });
      clearForm();
      setProviderModalOpen(false);
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
    setTimeoutSeconds(provider.timeoutMs / 1000);
    setProviderModalOpen(true);
  }

  function clearForm() {
    setEditingId(null);
    setName("upstream-1");
    setBaseUrl("https://api.openai.com");
    setApiKey("");
    setPriority(100);
    setTimeoutSeconds(120);
  }

  function openCreateProvider() {
    clearForm();
    setProviderModalOpen(true);
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

  function pricesForProvider(providerName: string) {
    return modelPrices.filter((price) => price.upstreamProvider === providerName);
  }

  return (
    <>
      <div className="grid admin-page">
        <section className="action-panel">
          <div>
            <h2>上游操作</h2>
            <p>新增和编辑上游配置都在弹窗里完成，密钥不会占用列表空间。</p>
          </div>
          <button className="button" onClick={openCreateProvider} type="button">
            <Plus size={17} />
            添加上游
          </button>
        </section>

        <section className="card">
          <h2 className="section-title">上游渠道与模型价格</h2>
          <div className="provider-stack stack-top">
            {providers.map((provider) => {
              const providerPrices = pricesForProvider(provider.name);

              return (
                <section className="provider-panel" key={provider.id}>
                  <div className="provider-head">
                    <div>
                      <div className="provider-title">
                        <strong>{provider.name}</strong>
                        <StatusPill status={provider.status} />
                      </div>
                      <p>
                        优先级 {provider.priority} · 超时 {seconds(provider.timeoutMs)} · {provider.baseUrl}
                      </p>
                      <code>{provider.apiKey}</code>
                    </div>
                    <div className="button-row">
                      <button className="button secondary" onClick={() => editProvider(provider)} type="button">
                        编辑渠道
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
                  </div>

                  <div className="section-head compact-head">
                    <div>
                      <h3 className="section-title">模型价格</h3>
                      <p className="section-subtitle">输入 / 缓存输入 / 输出分别计价，再乘以倍率。</p>
                    </div>
                    <button className="button secondary" onClick={() => openCreatePrice(provider.name)} type="button">
                      <Plus size={17} />
                      新增价格
                    </button>
                  </div>

                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>模型</th>
                          <th>状态</th>
                          <th>上游原价 输入/缓存/输出</th>
                          <th>上游实价</th>
                          <th>站点售价</th>
                          <th>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {providerPrices.map((price) => (
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
                                <button
                                  className="button danger"
                                  disabled={busyPriceId === price.id}
                                  onClick={() => deletePrice(price)}
                                  type="button"
                                >
                                  <Trash2 size={15} />
                                  删除
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                        {providerPrices.length === 0 ? <EmptyRow colSpan={6} /> : null}
                      </tbody>
                    </table>
                  </div>
                  <div className="mobile-record-list">
                    {providerPrices.map((price) => (
                      <MobileRecord
                        key={price.id}
                        title={price.model}
                        meta={`上游渠道：${price.upstreamProvider}`}
                        badges={<StatusPill status={price.enabled ? "ACTIVE" : "DISABLED"} />}
                        actions={
                          <>
                            <button className="button secondary" onClick={() => editPrice(price)} type="button">
                              编辑
                            </button>
                            <button className="button secondary" onClick={() => togglePrice(price)} type="button">
                              {price.enabled ? "停用" : "启用"}
                            </button>
                            <button
                              className="button danger"
                              disabled={busyPriceId === price.id}
                              onClick={() => deletePrice(price)}
                              type="button"
                            >
                              删除
                            </button>
                          </>
                        }
                      >
                        <MobileField label="上游原价" wide>
                          {priceTriplet(
                            price.upstreamInputPer1MTok,
                            price.upstreamCachedInputPer1MTok,
                            price.upstreamOutputPer1MTok,
                          )}
                        </MobileField>
                        <MobileField label="上游实价" wide>
                          x{price.upstreamPriceMultiplier}:{" "}
                          {priceTriplet(
                            multiplied(price.upstreamInputPer1MTok, price.upstreamPriceMultiplier),
                            multiplied(price.upstreamCachedInputPer1MTok, price.upstreamPriceMultiplier),
                            multiplied(price.upstreamOutputPer1MTok, price.upstreamPriceMultiplier),
                          )}
                        </MobileField>
                        <MobileField label="站点售价" wide>
                          x{price.customerPriceMultiplier}:{" "}
                          {priceTriplet(
                            multiplied(price.customerInputPer1MTok, price.customerPriceMultiplier),
                            multiplied(price.customerCachedInputPer1MTok, price.customerPriceMultiplier),
                            multiplied(price.customerOutputPer1MTok, price.customerPriceMultiplier),
                          )}
                        </MobileField>
                      </MobileRecord>
                    ))}
                    {providerPrices.length === 0 ? <MobileEmpty>暂无模型价格</MobileEmpty> : null}
                  </div>
                </section>
              );
            })}
            {providers.length === 0 ? <div className="empty-cell">暂无上游渠道</div> : null}
          </div>
        </section>
      </div>

      {providerModalOpen ? (
        <ModalShell
          title={editingId ? "编辑上游" : "添加上游"}
          description={editingId ? "留空 API Key 则不修改现有密钥。" : "添加新的上游供应商和密钥。"}
          onClose={() => {
            clearForm();
            setProviderModalOpen(false);
          }}
        >
          <form className="form" onSubmit={saveProvider}>
            <div className="modal-body">
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
                  <span>超时（秒）</span>
                  <input
                    className="input"
                    max={600}
                    min={5}
                    onChange={(event) => setTimeoutSeconds(Number(event.target.value))}
                    type="number"
                    value={timeoutSeconds}
                  />
                </label>
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="button secondary"
                onClick={() => {
                  clearForm();
                  setProviderModalOpen(false);
                }}
                type="button"
              >
                取消
              </button>
              <button className="button" type="submit">
                <Server size={17} />
                {editingId ? "保存上游" : "添加上游"}
              </button>
            </div>
          </form>
        </ModalShell>
      ) : null}

      {priceModalOpen ? (
        <ModalShell
          title="模型定价"
          description={`上游渠道：${priceProvider || "未选择"}。缓存输入会单独使用缓存价格计算。`}
          onClose={() => {
            setEditingPriceId(null);
            setPriceModalOpen(false);
          }}
          wide
        >
          <form className="form" onSubmit={saveModelPrice}>
            <div className="modal-body">
              <div className="button-row">
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
              <div className="pricing-layout">
                <div className="pricing-form">
                  <div className="grid cols-2">
                    <label className="field">
                      <span>上游渠道</span>
                      <select className="input" value={priceProvider} onChange={(event) => setPriceProvider(event.target.value)}>
                        {providers.map((provider) => (
                          <option key={provider.id} value={provider.name}>
                            {provider.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span>模型</span>
                      <input className="input" value={model} onChange={(event) => setModel(event.target.value)} />
                    </label>
                  </div>
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
            </div>
            <div className="modal-footer">
              <button
                className="button secondary"
                onClick={() => {
                  setEditingPriceId(null);
                  setPriceModalOpen(false);
                }}
                type="button"
              >
                取消
              </button>
              <button className="button" type="submit">
                <Save size={17} />
                保存价格
              </button>
            </div>
          </form>
        </ModalShell>
      ) : null}
    </>
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

function StatusPill({ status, strong = false }: { status: string; strong?: boolean }) {
  const labelMap: Record<string, string> = {
    FORCED_ACTIVE: "人工可用",
    FORCED_READY: "人工可调用",
  };
  const ok =
    status === "ACTIVE" ||
    status === "SUCCESS" ||
    status === "READY" ||
    status === "FORCED_ACTIVE" ||
    status === "FORCED_READY";
  const danger =
    status === "FAILED" ||
    status === "REVOKED" ||
    status === "DISABLED" ||
    status === "UNAVAILABLE" ||
    status === "MISSING";
  return <span className={`pill ${ok ? "ok" : danger ? "warn" : ""} ${strong ? "strong" : ""}`}>{labelMap[status] ?? status}</span>;
}

function MobileRecord({
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

function MobileField({
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

function MobileEmpty({ children }: { children: ReactNode }) {
  return <div className="mobile-empty">{children}</div>;
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

function seconds(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return "-";
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "-";
  }
  return `${(numeric / 1000).toFixed(3)}s`;
}

function nextCheckState(
  channel: ModelPoolChannel,
  healthCheck: ModelPoolHealthCheck | null,
  nowMs: number,
) {
  if (!healthCheck) {
    return { secondsUntilNext: null, isWaitingForResult: false };
  }

  if (channel.isChecking) {
    return { secondsUntilNext: 0, isWaitingForResult: true };
  }

  const secondsUntilNext = channel.nextCheckRemainingSeconds;

  if (secondsUntilNext === null || secondsUntilNext === undefined) {
    return { secondsUntilNext: null, isWaitingForResult: false };
  }

  const elapsedSeconds = Math.max(0, Math.floor((nowMs - healthCheck.receivedAtMs) / 1000));
  const displayedSecondsUntilNext = Math.max(0, secondsUntilNext - elapsedSeconds);

  return {
    secondsUntilNext: displayedSecondsUntilNext,
    isWaitingForResult: displayedSecondsUntilNext === 0,
  };
}

function nextCheckCountdown(
  channel: ModelPoolChannel,
  healthCheck: ModelPoolHealthCheck | null,
  nowMs: number,
) {
  const state = nextCheckState(channel, healthCheck, nowMs);

  if (state.secondsUntilNext === null) {
    return "-";
  }

  return state.isWaitingForResult ? "检测中" : `${state.secondsUntilNext}s`;
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
