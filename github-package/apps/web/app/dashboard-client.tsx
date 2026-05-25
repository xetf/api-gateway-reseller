"use client";

import {
  Activity,
  BarChart3,
  CreditCard,
  FileSearch,
  KeyRound,
  LogIn,
  LogOut,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Send,
  Server,
  Settings,
  Shield,
  SlidersHorizontal,
  CircleStop,
  Ticket,
  Trash2,
  Users,
} from "lucide-react";
import {
  FormEvent,
  type ReactNode,
  type UIEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  apiBaseUrl,
  apiFetch,
  clearToken,
  getToken,
  setToken,
} from "../lib/api";

type User = {
  id: string;
  email: string;
  role: "USER" | "ADMIN";
  status: "ACTIVE" | "DISABLED" | string;
  allowedModels: string[];
  rateLimitPerMinute: number;
  concurrencyLimit: number;
  charityEnabled?: boolean;
  charityDisplayName?: string | null;
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
  userId?: string;
  name: string;
  keyPrefix: string;
  keySecret?: string | null;
  status: "ACTIVE" | "DISABLED" | "REVOKED" | string;
  rateLimitPerMinute: number;
  dailyLimitUsd?: string | null;
  totalLimitUsd?: string | null;
  totalUsedUsd?: string | null;
  totalRemainingUsd?: string | null;
  concurrencyLimit: number;
  allowedModels: string[];
  noticeEnabled?: boolean;
  noticeText?: string | null;
  expiresAt?: string | null;
  lastUsedAt?: string | null;
  createdAt: string;
};

type ApiRequest = {
  id: string;
  traceCode?: string | null;
  upstreamProvider?: string | null;
  upstreamProviderKey?: {
    id: string;
    name: string;
    keyPrefix: string;
  } | null;
  clientIp?: string | null;
  model: string;
  reasoningEffort?: string | null;
  reasoningEffortActual?: string | null;
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
  responseUsage?: unknown | null;
  createdAt: string;
  user?: {
    email: string;
  };
  apiKey?: {
    id: string;
    name: string;
    keyPrefix: string;
  } | null;
  compactFallbacks?: CompactFallbackSummary[];
};

type CompactFallbackSummary = {
  id: string;
  traceCode?: string | null;
  createdAt: string;
  status: string;
  upstreamProvider?: string | null;
  upstreamProviderKey?: ApiRequest["upstreamProviderKey"];
  sourceFingerprint?: string | null;
  targetFingerprint?: string | null;
  replacements?: number | null;
  fallbackSucceeded?: boolean | null;
};

type ApiRequestDetail = ApiRequest & {
  upstreamRequestId?: string | null;
  userAgent?: string | null;
  requestBody?: unknown | null;
  updatedAt?: string;
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

type AdminRequestsSummary = {
  totalCount: number;
  successCount: number;
  failedCount: number;
  pendingCount: number;
  failureRate: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  chargedAmountUsd: string;
  upstreamCostUsd: string;
  grossProfitUsd: string;
  avgLatencyMs: number | null;
  avgFirstTokenLatencyMs: number | null;
};

type AdminRequestsPage = {
  requests: ApiRequest[];
  summary: AdminRequestsSummary;
  ipBanRules?: IpBanRule[];
  hasMore: boolean;
  nextCursor?: string | null;
};

type IpBanMode = "error" | "notice";

type IpBanRule = {
  ip: string;
  mode: IpBanMode;
  message: string;
  reason?: string | null;
  createdAt: string;
  updatedAt: string;
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

type ServerStatus = {
  server: {
    nodeVersion: string;
    uptimeSeconds: number;
    memory: {
      rss: number;
      heapTotal: number;
      heapUsed: number;
      external: number;
      arrayBuffers: number;
    };
    system: {
      cpuCount: number;
      cpuUsagePercent: number;
      loadAverage: number[];
      totalMemoryBytes: number;
      freeMemoryBytes: number;
      usedMemoryBytes: number;
      memoryUsagePercent: number;
    };
    cpu: {
      percent: number;
      userMs: number;
      systemMs: number;
    };
    redis: {
      ok: boolean;
      latencyMs?: number | null;
      error?: string | null;
    };
    database: {
      ok: boolean;
      latencyMs?: number | null;
      error?: string | null;
    };
    pm2: {
      ok: boolean;
      processes: Array<{
        name: string;
        pid: number | null;
        status: string;
        cpu: number | null;
        memory: number | null;
      }>;
      error?: string | null;
    };
  };
  modelPool: {
    healthCheckIntervalSeconds: number;
    totalChannels: number;
    activeChannels: number;
    unavailableChannels: number;
    penalizedChannels: number;
    recoveringChannels: number;
    inflightRequests: number;
    upstreamKeys: {
      total: number;
      active: number;
      inflightRequests: number;
    };
    autoCheckEnabledPools: number;
    channels: Array<{
      id: string;
      model: string;
      status: string;
      priority: number;
      consecutiveFailures: number;
      recoverySuccesses: number;
      penalizedUntil?: string | null;
      lastCheckStatus?: string | null;
      lastCheckedAt?: string | null;
      lastLatencyMs?: number | null;
      lastFirstTokenLatencyMs?: number | null;
      inflightRequests: number;
    }>;
  };
  apiKeys: {
    monitoredKeys: number;
    limitedKeys: number;
    activeConcurrency: number;
    currentMinuteRequests: number;
    sample: Array<{
      id: string;
      name: string;
      keyPrefix: string;
      concurrencyLimit: number;
      currentConcurrency: number;
      rateLimitPerMinute: number;
      currentMinuteRequests: number;
    }>;
  };
  checkedAt: string;
};

type AdminUser = User & {
  createdAt: string;
  wallet?: Wallet | null;
  walletTransactions?: Transaction[];
  apiKeys?: ApiKey[];
  _count: {
    apiKeys: number;
    apiRequests: number;
  };
};

type UpstreamProviderKey = {
  id: string;
  upstreamProviderId: string;
  name: string;
  key: string;
  keyPrefix: string;
  status: "ACTIVE" | "DISABLED" | string;
  priority: number;
  lastUsedAt?: string | null;
  lastCheckStatus?: string | null;
  lastCheckedAt?: string | null;
  lastError?: string | null;
  createdAt: string;
  updatedAt: string;
};

type UpstreamProvider = {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  status: "ACTIVE" | "DISABLED";
  priority: number;
  timeoutMs: number;
  keys?: UpstreamProviderKey[];
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

type UnifiedPriceDraft = {
  customerInputPer1MTok: string;
  customerCachedInputPer1MTok: string;
  customerOutputPer1MTok: string;
  customerPriceMultiplier: string;
};

type UnifiedPriceSetting = UnifiedPriceDraft & {
  model: string;
  enabled: boolean;
};

type UnifiedPriceGroup = {
  model: string;
  prices: ModelPrice[];
  providerNames: string[];
  setting?: UnifiedPriceSetting;
  hasDifferentOriginalCustomerPricing: boolean;
};

type AvailableModel = {
  model: string;
  status: "READY" | "UNAVAILABLE" | string;
  readyChannelCount: number;
};

type ModelPoolHealthCheckEndpoint = "responses" | "chat.completions";

type ModelPoolChannelStatus =
  | "ACTIVE"
  | "FORCED_ACTIVE"
  | "DISABLED"
  | "UNAVAILABLE"
  | "PENALIZED";

type ModelPoolChannel = {
  id: string;
  modelPoolId: string;
  upstreamProvider: string;
  status: ModelPoolChannelStatus | string;
  priority: number;
  consecutiveFailures: number;
  recoverySuccesses: number;
  penalizedUntil?: string | null;
  penaltyReason?: string | null;
  lastCheckStatus?: string | null;
  lastCheckedAt?: string | null;
  lastLatencyMs?: number | null;
  lastFirstTokenLatencyMs?: number | null;
  lastError?: string | null;
  checkIntervalSeconds?: number;
  nextCheckAt?: string | null;
  nextCheckRemainingSeconds?: number | null;
  penaltyRemainingSeconds?: number | null;
  healthCheckVersion?: string | null;
  hasPrice: boolean;
  priceEnabled: boolean;
  providerStatus: string;
  providerPriority?: number | null;
  activeKeyCount: number;
  isChecking?: boolean;
  checkingStartedAt?: string | null;
  effectiveStatus: "READY" | "FORCED_READY" | "UNAVAILABLE" | string;
};

type ModelPool = {
  id: string;
  model: string;
  status: "ACTIVE" | "DISABLED" | string;
  autoHealthCheckEnabled: boolean;
  healthCheckEndpoint: ModelPoolHealthCheckEndpoint | string;
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
  activeKeyCount: number;
};

type ModelPoolHealthCheck = {
  intervalSeconds: number;
  minIntervalSeconds?: number;
  maxIntervalSeconds?: number;
  penaltySeconds: number;
  minPenaltySeconds?: number;
  maxPenaltySeconds?: number;
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
    penaltySeconds: number;
    minPenaltySeconds?: number;
    maxPenaltySeconds?: number;
    serverNow: string;
  };
};

type AuthSettings = {
  emailCodeLoginEnabled: boolean;
  emailCodeAutoRegisterEnabled: boolean;
  newUserBonusUsd: string;
  emailCodeTtlSeconds: number;
  emailCodeCooldownSeconds: number;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpFrom: string;
  smtpConfigured: boolean;
};

type PendingAutoTerminateSettings = {
  enabled: boolean;
  timeoutSeconds: number;
  minTimeoutSeconds?: number;
  maxTimeoutSeconds?: number;
};

type ReasoningEffortTransformSettings = {
  rules: ReasoningEffortTransformRule[];
};

type ReasoningEffortTransformRule = {
  enabled: boolean;
  from: string;
  to: string;
};

type PublicAuthSettings = Pick<
  AuthSettings,
  | "emailCodeLoginEnabled"
  | "emailCodeAutoRegisterEnabled"
  | "newUserBonusUsd"
  | "smtpConfigured"
>;

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
  clientIp: string;
  apiKey: string;
  upstreamProvider: string;
  upstreamKey: string;
  endpoint: string;
  httpStatus: string;
  resultType: "" | "notice" | "ip_ban" | "error";
  minTokens: string;
  maxTokens: string;
  minChargedUsd: string;
  maxChargedUsd: string;
  minUpstreamCostUsd: string;
  maxUpstreamCostUsd: string;
  minGrossProfitUsd: string;
  maxGrossProfitUsd: string;
  minLatencyMs: string;
  maxLatencyMs: string;
  minFirstTokenLatencyMs: string;
  maxFirstTokenLatencyMs: string;
};

const emptyRequestFilters: RequestFilters = {
  q: "",
  userId: "",
  model: "",
  status: "",
  dateFrom: "",
  dateTo: "",
  clientIp: "",
  apiKey: "",
  upstreamProvider: "",
  upstreamKey: "",
  endpoint: "",
  httpStatus: "",
  resultType: "",
  minTokens: "",
  maxTokens: "",
  minChargedUsd: "",
  maxChargedUsd: "",
  minUpstreamCostUsd: "",
  maxUpstreamCostUsd: "",
  minGrossProfitUsd: "",
  maxGrossProfitUsd: "",
  minLatencyMs: "",
  maxLatencyMs: "",
  minFirstTokenLatencyMs: "",
  maxFirstTokenLatencyMs: "",
};

const emptyAdminRequestsSummary: AdminRequestsSummary = {
  totalCount: 0,
  successCount: 0,
  failedCount: 0,
  pendingCount: 0,
  failureRate: 0,
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  chargedAmountUsd: "0",
  upstreamCostUsd: "0",
  grossProfitUsd: "0",
  avgLatencyMs: null,
  avgFirstTokenLatencyMs: null,
};

const advancedRequestFilterKeys = [
  "clientIp",
  "apiKey",
  "upstreamProvider",
  "upstreamKey",
  "endpoint",
  "httpStatus",
  "resultType",
  "minTokens",
  "maxTokens",
  "minChargedUsd",
  "maxChargedUsd",
  "minUpstreamCostUsd",
  "maxUpstreamCostUsd",
  "minGrossProfitUsd",
  "maxGrossProfitUsd",
  "minLatencyMs",
  "maxLatencyMs",
  "minFirstTokenLatencyMs",
  "maxFirstTokenLatencyMs",
] as const satisfies readonly (keyof RequestFilters)[];

const frontNav = [
  { id: "overview", label: "前台总览", icon: BarChart3 },
  { id: "keys", label: "API Key", icon: KeyRound },
  { id: "wallet", label: "余额兑换", icon: CreditCard },
  { id: "requests", label: "我的调用", icon: Activity },
  { id: "test", label: "调用测试", icon: Send },
] as const;

const adminNav = [
  {
    id: "admin-overview",
    label: "后台总览",
    description: "收入、成本、余额",
    icon: Shield,
  },
  {
    id: "admin-users",
    label: "用户管理",
    description: "账号、余额、权限",
    icon: Users,
  },
  {
    id: "admin-settings",
    label: "登录设置",
    description: "验证码、新用户赠额",
    icon: Settings,
  },
  {
    id: "admin-redeem",
    label: "兑换码",
    description: "生成、启停、核销",
    icon: Ticket,
  },
  {
    id: "admin-upstreams",
    label: "上游管理",
    description: "渠道、密钥、模型价格",
    icon: Server,
  },
  {
    id: "admin-model-pools",
    label: "模型池",
    description: "模型、渠道、健康检测",
    icon: SlidersHorizontal,
  },
  {
    id: "admin-requests",
    label: "全站调用",
    description: "账单、请求、审计",
    icon: Activity,
  },
] as const;

const adminNavGroups = [
  {
    label: "运营",
    items: adminNav.filter((item) =>
      [
        "admin-overview",
        "admin-users",
        "admin-settings",
        "admin-redeem",
      ].includes(item.id),
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
  "admin-settings": {
    eyebrow: "运营中心",
    title: "登录设置",
    description: "配置邮箱验证码登录、自动注册和新用户赠送余额。",
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
  const [adminOverview, setAdminOverview] = useState<AdminOverview | null>(
    null,
  );
  const [serverStatus, setServerStatus] = useState<ServerStatus | null>(null);
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [adminRequests, setAdminRequests] = useState<ApiRequest[]>([]);
  const [adminRequestsSummary, setAdminRequestsSummary] =
    useState<AdminRequestsSummary>(emptyAdminRequestsSummary);
  const [adminRequestsNextCursor, setAdminRequestsNextCursor] = useState<
    string | null
  >(null);
  const [adminRequestsHasMore, setAdminRequestsHasMore] = useState(false);
  const [adminRequestsLoadingMore, setAdminRequestsLoadingMore] =
    useState(false);
  const [ipBanRules, setIpBanRules] = useState<IpBanRule[]>([]);
  const [upstreamProviders, setUpstreamProviders] = useState<
    UpstreamProvider[]
  >([]);
  const [modelPrices, setModelPrices] = useState<ModelPrice[]>([]);
  const [unifiedPriceSettings, setUnifiedPriceSettings] = useState<
    UnifiedPriceSetting[]
  >([]);
  const [modelPools, setModelPools] = useState<ModelPool[]>([]);
  const [poolAvailableChannels, setPoolAvailableChannels] = useState<
    AvailablePoolChannel[]
  >([]);
  const [modelPoolHealthCheck, setModelPoolHealthCheck] =
    useState<ModelPoolHealthCheck | null>(null);
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  const [redeemCodes, setRedeemCodes] = useState<RedeemCode[]>([]);
  const [authSettings, setAuthSettings] = useState<AuthSettings | null>(null);
  const [pendingAutoTerminateSettings, setPendingAutoTerminateSettings] =
    useState<PendingAutoTerminateSettings | null>(null);
  const [
    reasoningEffortTransformSettings,
    setReasoningEffortTransformSettings,
  ] = useState<ReasoningEffortTransformSettings | null>(null);
  const [requestFilters, setRequestFilters] =
    useState<RequestFilters>(emptyRequestFilters);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const loadingModelPoolsRef = useRef(false);
  const loadingAdminRequestsRef = useRef(false);
  const adminRequestsLoadedFiltersRef = useRef<RequestFilters>(requestFilters);

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
      const me = await apiFetch<{ user: User }>("/auth/me", {
        token: authToken,
      });
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
      setServerStatus(null);
      setAdminUsers([]);
      setUpstreamProviders([]);
      setModelPrices([]);
      setUnifiedPriceSettings([]);
      setModelPools([]);
      setPoolAvailableChannels([]);
      setModelPoolHealthCheck(null);
      setRedeemCodes([]);
      setAuthSettings(null);
      setPendingAutoTerminateSettings(null);
      setReasoningEffortTransformSettings(null);
      setAdminRequests([]);
      setAdminRequestsSummary(emptyAdminRequestsSummary);
      setAdminRequestsNextCursor(null);
      setAdminRequestsHasMore(false);
      setAdminRequestsLoadingMore(false);
      setIpBanRules([]);

      void Promise.allSettled([
        loadData("可用模型", async () => {
          const result = await apiFetch<{ models: AvailableModel[] }>(
            "/models",
            {
              token: authToken,
            },
          );
          setAvailableModels(result.models);
        }),
        loadData("API Key", async () => {
          const result = await apiFetch<{ apiKeys: ApiKey[] }>("/api-keys", {
            token: authToken,
          });
          setApiKeys(result.apiKeys);
        }),
        loadData("钱包", async () => {
          const result = await apiFetch<{
            wallet: Wallet | null;
            transactions: Transaction[];
          }>("/wallet", { token: authToken });
          setWallet(result.wallet);
          setTransactions(result.transactions);
        }),
        loadData("用量", async () => {
          const result = await apiFetch<Summary>("/usage/summary", {
            token: authToken,
          });
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
    setServerStatus(null);

    void Promise.allSettled([
      loadData("后台总览", async () => {
        const result = await apiFetch<AdminOverview>("/admin/overview", {
          token: authToken,
        });
        setAdminOverview(result);
      }),
      loadData("服务器状态", async () => {
        const result = await apiFetch<ServerStatus>("/admin/server-status", {
          token: authToken,
        });
        setServerStatus(result);
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
        const result = await apiFetch<{
          modelPrices: ModelPrice[];
          unifiedPriceSettings?: UnifiedPriceSetting[];
        }>("/admin/model-prices", { token: authToken });
        setModelPrices(result.modelPrices);
        setUnifiedPriceSettings(result.unifiedPriceSettings ?? []);
      }),
      loadData("模型池", async () => {
        await refreshModelPools(authToken);
      }),
      loadData("兑换码", async () => {
        const result = await apiFetch<{ codes: RedeemCode[] }>(
          "/admin/redeem-codes",
          {
            token: authToken,
          },
        );
        setRedeemCodes(result.codes);
      }),
      loadData("登录设置", async () => {
        const result = await apiFetch<{ settings: AuthSettings }>(
          "/admin/auth-settings",
          {
            token: authToken,
          },
        );
        setAuthSettings(result.settings);
      }),
      loadData("自动终止设置", async () => {
        const result = await apiFetch<{
          settings: PendingAutoTerminateSettings;
        }>("/admin/pending-auto-terminate-settings", { token: authToken });
        setPendingAutoTerminateSettings(result.settings);
      }),
      loadData("推理强度转换", async () => {
        const result = await apiFetch<{
          settings: ReasoningEffortTransformSettings;
        }>("/admin/reasoning-effort-transform-settings", { token: authToken });
        setReasoningEffortTransformSettings(result.settings);
      }),
      loadData("调用记录", async () => {
        await refreshAdminRequests({ authToken, filters: requestFilters });
      }),
    ]);
  }

  async function refreshAdminRequests({
    authToken = token,
    filters = requestFilters,
    append = false,
    cursor = null,
  }: {
    authToken?: string | null;
    filters?: RequestFilters;
    append?: boolean;
    cursor?: string | null;
  } = {}) {
    if (!authToken || loadingAdminRequestsRef.current) {
      return;
    }

    loadingAdminRequestsRef.current = true;
    if (append) {
      setAdminRequestsLoadingMore(true);
    } else {
      adminRequestsLoadedFiltersRef.current = filters;
      setAdminRequestsNextCursor(null);
      setAdminRequestsHasMore(false);
    }

    try {
      const result = await apiFetch<AdminRequestsPage>(
        `/admin/requests${toQueryString(filters, { take: "120", cursor: cursor ?? undefined })}`,
        { token: authToken },
      );
      setAdminRequests((current) =>
        append ? mergeRequests(current, result.requests) : result.requests,
      );
      setAdminRequestsSummary(result.summary ?? emptyAdminRequestsSummary);
      if (result.ipBanRules) {
        setIpBanRules(result.ipBanRules);
      }
      setAdminRequestsNextCursor(result.nextCursor ?? null);
      setAdminRequestsHasMore(result.hasMore);
    } catch (loadError) {
      setError(`调用记录加载失败：${errorToText(loadError)}`);
    } finally {
      loadingAdminRequestsRef.current = false;
      setAdminRequestsLoadingMore(false);
    }
  }

  function loadMoreAdminRequests() {
    if (
      !adminRequestsHasMore ||
      !adminRequestsNextCursor ||
      adminRequestsLoadingMore
    ) {
      return;
    }

    void refreshAdminRequests({
      filters: adminRequestsLoadedFiltersRef.current,
      append: true,
      cursor: adminRequestsNextCursor,
    });
  }

  const refreshModelPools = useCallback(
    async (authToken = token) => {
      if (!authToken || loadingModelPoolsRef.current) {
        return;
      }

      loadingModelPoolsRef.current = true;
      try {
        const result = await apiFetch<ModelPoolResponse>("/admin/model-pools", {
          token: authToken,
        });
        setModelPools(result.modelPools);
        setPoolAvailableChannels(result.availableChannels);
        setModelPoolHealthCheck({
          ...result.healthCheck,
          receivedAtMs: Date.now(),
        });
      } finally {
        loadingModelPoolsRef.current = false;
      }
    },
    [token],
  );

  useEffect(() => {
    if (mode !== "admin" || activeTab !== "admin-overview" || !token) {
      return;
    }

    let cancelled = false;
    let inFlight = false;
    const tick = () => {
      if (cancelled || inFlight) {
        return;
      }

      inFlight = true;
      void apiFetch<ServerStatus>("/admin/server-status", { token })
        .then((result) => {
          if (!cancelled) {
            setServerStatus(result);
          }
        })
        .catch((fetchError) => {
          if (!cancelled) {
            setError(`服务器状态加载失败：${errorToText(fetchError)}`);
          }
        })
        .finally(() => {
          inFlight = false;
        });
    };

    tick();
    const timer = setInterval(tick, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [activeTab, mode, token]);

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
  const fixedWorkspace = mode === "admin" && activeTab === "admin-requests";

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">A</span>
          APIshare
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
      <section className={fixedWorkspace ? "main main-fixed-page" : "main"}>
        <div className="topbar">
          <div className="page-heading">
            <span className="eyebrow">{currentPage.eyebrow}</span>
            <h1>{currentPage.title}</h1>
            <p>{currentPage.description}</p>
          </div>
          <div className="topbar-side">
            <div className="account-chip">
              <span>{user.email}</span>
              {user.role === "ADMIN" ? <strong>管理员</strong> : null}
            </div>
            <div className="button-row">
              <button
                className="button secondary"
                onClick={() => refreshAll()}
                type="button"
              >
                <RefreshCw size={17} />
                <span>刷新</span>
              </button>
              <button
                className="button secondary"
                onClick={logout}
                type="button"
              >
                <LogOut size={17} />
                <span>退出</span>
              </button>
            </div>
          </div>
        </div>

        <div
          className={
            fixedWorkspace ? "workspace workspace-fixed-page" : "workspace"
          }
        >
          {error ? <div className="notice">{error}</div> : null}
          {loading ? <p className="muted">加载中...</p> : null}

          {mode === "user" && activeTab === "overview" ? (
            <Overview
              wallet={wallet}
              summary={summary}
              apiKeys={apiKeys}
              availableModels={availableModels}
            />
          ) : null}
          {mode === "user" && activeTab === "keys" ? (
            <Keys
              apiKeys={apiKeys}
              onChanged={() => refreshAll()}
              onError={setError}
            />
          ) : null}
          {mode === "user" && activeTab === "wallet" ? (
            <WalletView
              wallet={wallet}
              transactions={transactions}
              onChanged={() => refreshAll()}
              onError={setError}
            />
          ) : null}
          {mode === "user" && activeTab === "requests" ? (
            <Requests requests={summary?.requests ?? []} />
          ) : null}
          {mode === "user" && activeTab === "test" ? (
            <CallTester
              availableModels={availableModels}
              onChanged={() => refreshAll()}
              onError={setError}
            />
          ) : null}
          {mode === "admin" && activeTab === "admin-overview" ? (
            <AdminOverviewPanel
              overview={adminOverview}
              serverStatus={serverStatus}
            />
          ) : null}
          {mode === "admin" && activeTab === "admin-upstreams" ? (
            <UpstreamProviders
              providers={upstreamProviders}
              modelPrices={modelPrices}
              unifiedPriceSettings={unifiedPriceSettings}
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
          {mode === "admin" && activeTab === "admin-settings" ? (
            <AdminAuthSettings
              settings={authSettings}
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
              summary={adminRequestsSummary}
              ipBanRules={ipBanRules}
              users={adminUsers}
              filters={requestFilters}
              pendingAutoTerminateSettings={pendingAutoTerminateSettings}
              reasoningEffortTransformSettings={
                reasoningEffortTransformSettings
              }
              onFiltersChange={setRequestFilters}
              hasMore={adminRequestsHasMore}
              loadingMore={adminRequestsLoadingMore}
              onLoadMore={loadMoreAdminRequests}
              onSearch={(nextFilters) =>
                refreshAdminRequests({ filters: nextFilters })
              }
              onRulesChanged={setIpBanRules}
              onRequestTerminated={() =>
                refreshAdminRequests({ filters: requestFilters })
              }
              onPendingAutoTerminateSettingsChanged={
                setPendingAutoTerminateSettings
              }
              onReasoningEffortTransformSettingsChanged={
                setReasoningEffortTransformSettings
              }
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
  item: {
    id: string;
    label: string;
    description?: string;
    icon: typeof BarChart3;
  };
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
      <div
        className={wide ? "form-modal modal-wide" : "form-modal"}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
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
  const [emailCode, setEmailCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [publicAuthSettings, setPublicAuthSettings] =
    useState<PublicAuthSettings | null>(null);
  const [loadingAuthSettings, setLoadingAuthSettings] = useState(
    mode === "user",
  );
  const isUserMode = mode === "user";

  useEffect(() => {
    if (!isUserMode) {
      setPublicAuthSettings(null);
      setLoadingAuthSettings(false);
      return;
    }

    let cancelled = false;
    setLoadingAuthSettings(true);

    void apiFetch<{ settings: PublicAuthSettings }>("/auth/settings", {
      token: null,
    })
      .then((result) => {
        if (!cancelled) {
          setPublicAuthSettings(result.settings);
        }
      })
      .catch((fetchError) => {
        if (!cancelled) {
          setError(errorToText(fetchError));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingAuthSettings(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isUserMode]);

  async function sendCode() {
    setError(null);
    setMessage(null);
    if (publicAuthSettings?.emailCodeLoginEnabled === false) {
      setError("邮箱验证码登录已关闭。");
      return;
    }
    if (!identifier.trim()) {
      setError("请先填写邮箱。");
      return;
    }

    setSendingCode(true);
    try {
      const result = await apiFetch<{ expiresInSeconds: number }>(
        "/auth/email-code/send",
        {
          method: "POST",
          body: JSON.stringify({ email: identifier }),
          token: null,
        },
      );
      setMessage(
        `验证码已发送，${Math.ceil(result.expiresInSeconds / 60)} 分钟内有效。`,
      );
    } catch (sendError) {
      setError(errorToText(sendError));
    } finally {
      setSendingCode(false);
    }
  }

  async function submit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (isUserMode) {
        if (publicAuthSettings?.emailCodeLoginEnabled === false) {
          setError("邮箱验证码登录已关闭。");
          return;
        }

        if (!emailCode.trim()) {
          setError("请填写邮箱验证码。");
          return;
        }

        const result = await apiFetch<{ token: string; user: User }>(
          "/auth/email-code/login",
          {
            method: "POST",
            body: JSON.stringify({
              email: identifier,
              code: emailCode,
            }),
            token: null,
          },
        );
        onLogin(result.token, result.user);
        return;
      }

      const result = await apiFetch<{ token: string; user: User }>(
        "/auth/admin-login",
        {
          method: "POST",
          body: JSON.stringify({ username: identifier, password }),
          token: null,
        },
      );
      onLogin(result.token, result.user);
    } catch (loginError) {
      setError(errorToText(loginError));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-page">
      <section
        className="login-shell"
        aria-label={
          mode === "admin" ? "APIshare 管理员登录" : "APIshare 前台邮箱登录"
        }
      >
        <div className="login-brand-panel">
          <div className="login-brand-copy">
            {mode === "admin" ? (
              <span className="eyebrow auth-eyebrow">控制台</span>
            ) : null}
            <h1>{mode === "admin" ? "APIshare Admin" : "APIshare"}</h1>
            {mode === "admin" ? <p>运营、用户和网关配置集中管理。</p> : null}
          </div>
        </div>

        <div className="login-panel">
          <div className="login-header">
            <h2>{mode === "admin" ? "管理员登录" : "登录"}</h2>
            <p>
              {mode === "admin"
                ? "使用管理员账号进入后台。"
                : loadingAuthSettings
                  ? "登录配置加载中..."
                  : publicAuthSettings?.emailCodeLoginEnabled === false
                    ? "邮箱验证码登录已关闭"
                    : publicAuthSettings?.emailCodeAutoRegisterEnabled === false
                      ? "仅限已存在账户使用邮箱验证码登录"
                      : "新邮箱会自动创建账户"}
            </p>
          </div>

          {message ? (
            <div className="success auth-feedback">{message}</div>
          ) : null}
          {error ? <div className="error auth-feedback">{error}</div> : null}

          <form className="form login-form" onSubmit={submit}>
            <label className="field">
              <span>{mode === "admin" ? "用户名" : "邮箱"}</span>
              <input
                autoComplete={mode === "admin" ? "username" : "email"}
                className="input"
                onChange={(event) => setIdentifier(event.target.value)}
                required
                type={mode === "admin" ? "text" : "email"}
                value={identifier}
              />
            </label>
            {isUserMode ? (
              <label className="field">
                <span>验证码</span>
                <div className="input-with-action auth-code-action">
                  <input
                    autoComplete="one-time-code"
                    className="input"
                    inputMode="numeric"
                    maxLength={6}
                    onChange={(event) =>
                      setEmailCode(
                        event.target.value.replace(/\D/g, "").slice(0, 6),
                      )
                    }
                    required
                    type="text"
                    value={emailCode}
                  />
                  <button
                    className="button secondary"
                    disabled={
                      sendingCode ||
                      loadingAuthSettings ||
                      publicAuthSettings?.emailCodeLoginEnabled === false
                    }
                    onClick={sendCode}
                    type="button"
                  >
                    <span>{sendingCode ? "发送中" : "获取验证码"}</span>
                  </button>
                </div>
              </label>
            ) : (
              <label className="field">
                <span>密码</span>
                <input
                  autoComplete="current-password"
                  className="input"
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  type="password"
                  value={password}
                />
              </label>
            )}
            <button
              className="button login-submit"
              disabled={
                loading ||
                (isUserMode &&
                  (loadingAuthSettings ||
                    publicAuthSettings?.emailCodeLoginEnabled === false))
              }
              type="submit"
            >
              {isUserMode ? null : <LogIn size={17} />}
              <span>{loading ? "登录中..." : "登录"}</span>
            </button>
          </form>
        </div>
      </section>
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
        <Metric
          label="30 天请求数"
          value={String(summary?.totals.requests ?? 0)}
        />
        <Metric
          label="活跃 Key"
          value={String(
            apiKeys.filter((key) => key.status === "ACTIVE").length,
          )}
        />
      </div>
      <div className="grid cols-3">
        <Metric
          label="总 token"
          value={formatNumber(summary?.totals.totalTokens ?? 0)}
        />
        <Metric
          label="我的扣费"
          value={`$${money(summary?.totals.chargedAmountUsd ?? 0)}`}
        />
        <Metric
          label="Base URL"
          value={apiBaseUrl.replace(/^https?:\/\//, "")}
          small
        />
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
              {item.model}
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
        <CopyField
          label="Chat Completions"
          value={`${apiBaseUrl}/v1/chat/completions`}
        />
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
      <button
        className="button secondary icon-button"
        onClick={copy}
        type="button"
      >
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
  const [totalLimitUsd, setTotalLimitUsd] = useState("");
  const [concurrencyLimit, setConcurrencyLimit] = useState(0);
  const [expiresAt, setExpiresAt] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const [busyKeyId, setBusyKeyId] = useState<string | null>(null);
  const [configKey, setConfigKey] = useState<ApiKey | null>(null);
  const [editingKey, setEditingKey] = useState<ApiKey | null>(null);
  const [editName, setEditName] = useState("");
  const [editRateLimit, setEditRateLimit] = useState(60);
  const [editTotalLimitUsd, setEditTotalLimitUsd] = useState("");
  const [editConcurrencyLimit, setEditConcurrencyLimit] = useState(0);
  const [editExpiresAt, setEditExpiresAt] = useState("");

  async function createKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onError(null);
    try {
      const result = await apiFetch<{ apiKey: ApiKey; secret: string }>(
        "/api-keys",
        {
          method: "POST",
          body: JSON.stringify({
            name,
            rateLimitPerMinute: Number(rateLimit),
            totalLimitUsd: normalizeOptionalNumberText(totalLimitUsd),
            concurrencyLimit: Number(concurrencyLimit),
            expiresAt: normalizeOptionalDateInput(expiresAt),
            allowedModels: [],
          }),
        },
      );
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

  function beginEditKey(key: ApiKey) {
    setEditingKey(key);
    setEditName(key.name);
    setEditRateLimit(key.rateLimitPerMinute);
    setEditTotalLimitUsd(limitValue(key.totalLimitUsd ?? key.dailyLimitUsd));
    setEditConcurrencyLimit(key.concurrencyLimit ?? 0);
    setEditExpiresAt(dateInputValue(key.expiresAt));
  }

  async function saveEditingKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingKey) {
      return;
    }

    onError(null);
    setBusyKeyId(editingKey.id);
    try {
      await apiFetch(`/api-keys/${editingKey.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: editName,
          rateLimitPerMinute: Number(editRateLimit),
          totalLimitUsd: normalizeOptionalNumberText(editTotalLimitUsd),
          concurrencyLimit: Number(editConcurrencyLimit),
          expiresAt: normalizeOptionalDateInput(editExpiresAt),
        }),
      });
      setEditingKey(null);
      onChanged();
    } catch (editError) {
      onError(errorToText(editError));
    } finally {
      setBusyKeyId(null);
    }
  }

  async function updateKeyStatus(
    key: ApiKey,
    status: "ACTIVE" | "DISABLED" | "REVOKED",
  ) {
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

  async function deleteKey(key: ApiKey) {
    const confirmed = window.confirm(
      `确定删除 API Key「${key.name}」吗？删除后将无法继续使用。`,
    );
    if (!confirmed) {
      return;
    }

    onError(null);
    setBusyKeyId(key.id);
    try {
      await apiFetch(`/api-keys/${key.id}`, {
        method: "DELETE",
      });
      onChanged();
    } catch (deleteError) {
      onError(errorToText(deleteError));
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
              <input
                className="input"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
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
            <label className="field">
              <span>总限额 USD</span>
              <input
                className="input"
                value={totalLimitUsd}
                min={0}
                onChange={(event) => setTotalLimitUsd(event.target.value)}
                placeholder="留空不限"
                step="0.00000001"
                type="number"
              />
            </label>
            <label className="field">
              <span>并发限制</span>
              <input
                className="input"
                value={concurrencyLimit}
                min={0}
                max={10000}
                onChange={(event) =>
                  setConcurrencyLimit(Number(event.target.value))
                }
                type="number"
              />
            </label>
            <label className="field">
              <span>过期时间</span>
              <input
                className="input"
                value={expiresAt}
                onChange={(event) => setExpiresAt(event.target.value)}
                type="datetime-local"
              />
            </label>
            <button className="button" type="submit">
              <Plus size={17} />
              创建
            </button>
          </form>
          {secret ? (
            <div className="stack-top">
              <div className="notice">
                API Key 已创建，可在列表中一直查看和配置。
              </div>
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
                  <th>限额</th>
                  <th>并发</th>
                  <th>过期</th>
                  <th>创建时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {apiKeys.map((key) => (
                  <tr key={key.id}>
                    <td>{key.name}</td>
                    <td>
                      <code className="inline-secret">
                        {key.keySecret ?? key.keyPrefix}
                      </code>
                    </td>
                    <td>
                      <StatusPill status={key.status} />
                    </td>
                    <td>{key.rateLimitPerMinute}/min</td>
                    <td>{formatApiKeyLimitSummary(key)}</td>
                    <td>{formatConcurrencyLimit(key.concurrencyLimit)}</td>
                    <td>
                      {key.expiresAt ? dateTime(key.expiresAt) : "永不过期"}
                    </td>
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
                        <button
                          className="button secondary"
                          disabled={busyKeyId === key.id}
                          onClick={() => beginEditKey(key)}
                          type="button"
                        >
                          编辑
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
                        ) : null}
                        {key.status === "DISABLED" ? (
                          <button
                            className="button"
                            disabled={busyKeyId === key.id}
                            onClick={() => updateKeyStatus(key, "ACTIVE")}
                            type="button"
                          >
                            启用
                          </button>
                        ) : null}
                        <button
                          className="button danger"
                          disabled={busyKeyId === key.id}
                          onClick={() => deleteKey(key)}
                          type="button"
                        >
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {apiKeys.length === 0 ? <EmptyRow colSpan={9} /> : null}
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
                    <button
                      className="button secondary"
                      disabled={busyKeyId === key.id}
                      onClick={() => beginEditKey(key)}
                      type="button"
                    >
                      编辑
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
                    ) : null}
                    {key.status === "DISABLED" ? (
                      <button
                        className="button"
                        disabled={busyKeyId === key.id}
                        onClick={() => updateKeyStatus(key, "ACTIVE")}
                        type="button"
                      >
                        启用
                      </button>
                    ) : null}
                    <button
                      className="button danger"
                      disabled={busyKeyId === key.id}
                      onClick={() => deleteKey(key)}
                      type="button"
                    >
                      删除
                    </button>
                  </>
                }
              >
                <MobileField label="API Key" wide>
                  <code className="inline-secret">
                    {key.keySecret ?? key.keyPrefix}
                  </code>
                </MobileField>
                <MobileField label="限流">
                  {key.rateLimitPerMinute}/min
                </MobileField>
                <MobileField label="限额" wide>
                  {formatApiKeyLimitSummary(key)}
                </MobileField>
                <MobileField label="并发">
                  {formatConcurrencyLimit(key.concurrencyLimit)}
                </MobileField>
                <MobileField label="过期">
                  {key.expiresAt ? dateTime(key.expiresAt) : "永不过期"}
                </MobileField>
                <MobileField label="创建时间">
                  {dateTime(key.createdAt)}
                </MobileField>
              </MobileRecord>
            ))}
            {apiKeys.length === 0 ? (
              <MobileEmpty>暂无 API Key</MobileEmpty>
            ) : null}
          </div>
        </section>
      </div>
      {configKey?.keySecret ? (
        <ApiKeyConfigModal
          apiKey={configKey.keySecret}
          onClose={() => setConfigKey(null)}
        />
      ) : null}
      {editingKey ? (
        <ModalShell
          title="编辑 API Key"
          description={editingKey.keyPrefix}
          onClose={() => setEditingKey(null)}
          wide
        >
          <form className="form" onSubmit={saveEditingKey}>
            <div className="modal-body">
              <label className="field">
                <span>名称</span>
                <input
                  className="input"
                  value={editName}
                  onChange={(event) => setEditName(event.target.value)}
                />
              </label>
              <label className="field">
                <span>每分钟限流</span>
                <input
                  className="input"
                  value={editRateLimit}
                  min={1}
                  max={10000}
                  onChange={(event) =>
                    setEditRateLimit(Number(event.target.value))
                  }
                  type="number"
                />
              </label>
              <label className="field">
                <span>总限额 USD</span>
                <input
                  className="input"
                  value={editTotalLimitUsd}
                  min={0}
                  onChange={(event) => setEditTotalLimitUsd(event.target.value)}
                  placeholder="留空不限"
                  step="0.00000001"
                  type="number"
                />
              </label>
              <label className="field">
                <span>并发限制</span>
                <input
                  className="input"
                  value={editConcurrencyLimit}
                  min={0}
                  max={10000}
                  onChange={(event) =>
                    setEditConcurrencyLimit(Number(event.target.value))
                  }
                  type="number"
                />
              </label>
              <label className="field">
                <span>过期时间</span>
                <input
                  className="input"
                  value={editExpiresAt}
                  onChange={(event) => setEditExpiresAt(event.target.value)}
                  type="datetime-local"
                />
              </label>
            </div>
            <div className="modal-footer">
              <button
                className="button secondary"
                onClick={() => setEditingKey(null)}
                type="button"
              >
                取消
              </button>
              <button
                className="button"
                disabled={busyKeyId === editingKey.id}
                type="submit"
              >
                保存
              </button>
            </div>
          </form>
        </ModalShell>
      ) : null}
    </>
  );
}

function ApiKeyConfigModal({
  apiKey,
  onClose,
}: {
  apiKey: string;
  onClose: () => void;
}) {
  const [tool, setTool] = useState("Codex CLI");
  const [os, setOs] = useState("macOS / Linux");
  const configPath =
    os === "Windows"
      ? "%USERPROFILE%\\.codex\\config.toml"
      : "~/.codex/config.toml";
  const authPath =
    os === "Windows"
      ? "%USERPROFILE%\\.codex\\auth.json"
      : "~/.codex/auth.json";
  const mkdirCommand =
    os === "Windows" ? "mkdir %USERPROFILE%\\.codex" : "mkdir -p ~/.codex";
  const config = codexConfigToml(tool);
  const auth = JSON.stringify({ OPENAI_API_KEY: apiKey }, null, 2);

  return (
    <div className="modal-backdrop" role="presentation">
      <div
        className="config-modal"
        role="dialog"
        aria-modal="true"
        aria-label="使用 API 密钥"
      >
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
          {[
            "Codex CLI",
            "Codex CLI (WebSocket)",
            "Claude Code",
            "OpenCode",
          ].map((item) => (
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
        <div className="config-tip">
          请确保以下内容位于 config.toml 文件的开头部分。
        </div>
        <ConfigBlock title={configPath} value={config} />
        <ConfigBlock title={authPath} value={auth} />
        <div className="info-box">
          请确保配置目录存在。{os} 用户可运行 <code>{mkdirCommand}</code>{" "}
          创建目录。
        </div>
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
        <button onClick={copy} type="button">
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      <pre>{value}</pre>
    </div>
  );
}

function codexConfigToml(tool: string) {
  const providerName =
    tool === "Codex CLI (WebSocket)" ? "codex_local_access" : "OpenAI";

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
      const result = await apiFetch<{
        redeemed: { amount: string; currency: string };
      }>("/redeem-codes/redeem", {
        method: "POST",
        body: JSON.stringify({ code }),
      });
      setCode("");
      setMessage(
        `已兑换 $${money(result.redeemed.amount)} ${result.redeemed.currency}`,
      );
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
        {transactions.length === 0 ? (
          <MobileEmpty>暂无账本流水</MobileEmpty>
        ) : null}
      </div>
    </section>
  );
}

function Requests({
  requests,
  compact = false,
  showCost = false,
  ipBanRules = [],
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  onRequestTerminated,
}: {
  requests: ApiRequest[];
  compact?: boolean;
  showCost?: boolean;
  ipBanRules?: IpBanRule[];
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  onRequestTerminated?: (request: ApiRequest) => void;
}) {
  const [selectedRequest, setSelectedRequest] =
    useState<ApiRequestDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [terminatingRequestId, setTerminatingRequestId] = useState<
    string | null
  >(null);
  const bannedIpSet = new Set(ipBanRules.map((rule) => rule.ip));

  function handleScroll(event: UIEvent<HTMLDivElement>) {
    if (!onLoadMore || !hasMore || loadingMore) {
      return;
    }

    const target = event.currentTarget;
    if (target.scrollTop + target.clientHeight >= target.scrollHeight - 180) {
      onLoadMore();
    }
  }

  async function openRequestDetail(item: ApiRequest) {
    setSelectedRequest(item);
    setDetailError(null);

    if (!showCost) {
      return;
    }

    const authToken = getToken();
    if (!authToken) {
      setDetailError("登录已失效，请重新登录后台。");
      return;
    }

    setDetailLoading(true);
    try {
      const result = await apiFetch<{ request: ApiRequestDetail }>(
        `/admin/requests/${item.id}`,
        {
          token: authToken,
        },
      );
      setSelectedRequest(result.request);
    } catch (error) {
      setDetailError(errorToText(error));
    } finally {
      setDetailLoading(false);
    }
  }

  async function terminateRequest(item: ApiRequest) {
    const confirmed = window.confirm(
      `确定终止这条 PENDING 调用吗？\n${item.model} · ${dateTime(item.createdAt)}`,
    );
    if (!confirmed) {
      return;
    }

    const authToken = getToken();
    if (!authToken) {
      setDetailError("登录已失效，请重新登录后台。");
      return;
    }

    setTerminatingRequestId(item.id);
    setDetailError(null);
    try {
      const result = await apiFetch<{ request: ApiRequest }>(
        `/admin/requests/${item.id}/terminate`,
        {
          method: "POST",
          token: authToken,
        },
      );
      onRequestTerminated?.(result.request);
      setSelectedRequest((current) =>
        current?.id === result.request.id
          ? { ...current, ...result.request }
          : current,
      );
    } catch (error) {
      setDetailError(errorToText(error));
    } finally {
      setTerminatingRequestId(null);
    }
  }

  return (
    <>
      <section
        className={
          showCost ? "card requests-card audit-card" : "card requests-card"
        }
      >
        <div className="requests-head">
          <h2 className="section-title">
            {compact ? "最近调用" : showCost ? "全站调用" : "调用记录"}
          </h2>
          {showCost ? (
            <span className="section-subtitle">
              已加载 {requests.length} 条
              {hasMore ? " · 向下滚动继续加载" : " · 已到底"}
            </span>
          ) : null}
        </div>
        <div
          className={showCost ? "table-wrap audit-table-wrap" : "table-wrap"}
          onScroll={handleScroll}
        >
          <table className={showCost ? "audit-table" : undefined}>
            {showCost ? (
              <>
                <thead>
                  <tr>
                    <th>追踪编码</th>
                    <th>标识</th>
                    <th>调用</th>
                    <th>状态</th>
                    <th>Token</th>
                    <th>费用</th>
                    <th>耗时</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((item) => (
                    <AuditRequestRow
                      bannedIpSet={bannedIpSet}
                      item={item}
                      key={item.id}
                      onOpenDetail={openRequestDetail}
                      onTerminate={terminateRequest}
                      terminatingRequestId={terminatingRequestId}
                    />
                  ))}
                  {requests.length === 0 ? <EmptyRow colSpan={8} /> : null}
                </tbody>
              </>
            ) : (
              <>
                <thead>
                  <tr>
                    <th>编码</th>
                    <th>API Key</th>
                    <th>IP</th>
                    <th>模型</th>
                    <th>状态</th>
                    <th>输入</th>
                    <th>缓存</th>
                    <th>输出</th>
                    <th>总 token</th>
                    <th>扣费</th>
                    <th>总时间</th>
                    <th>首 token</th>
                    <th>时间</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <strong className="request-trace-code">
                          {formatRequestTraceCode(item)}
                        </strong>
                      </td>
                      <td>{formatRequestApiKey(item.apiKey)}</td>
                      <td>
                        <IpCell
                          ip={item.clientIp}
                          banned={Boolean(
                            item.clientIp &&
                            bannedIpSet.has(
                              normalizeIpForCompare(item.clientIp),
                            ),
                          )}
                        />
                      </td>
                      <td>{item.model}</td>
                      <td>
                        <div className="request-status-cell">
                          <StatusPill
                            status={getRequestStatusPillStatus(item)}
                          />
                          {getReturnedNoticeText(item) ? (
                            <span className="request-notice-pill">已提示</span>
                          ) : null}
                          {hasRequestError(item) ? (
                            <button
                              className="request-detail-button"
                              onClick={() => void openRequestDetail(item)}
                              title="查看详细报错原因和过程"
                              type="button"
                            >
                              <FileSearch size={13} />
                              详情
                            </button>
                          ) : null}
                        </div>
                      </td>
                      <td>{formatNumber(item.inputTokens)}</td>
                      <td>{formatNumber(item.cachedInputTokens)}</td>
                      <td>{formatNumber(item.outputTokens)}</td>
                      <td>{formatNumber(item.totalTokens)}</td>
                      <td>${money(item.chargedAmountUsd)}</td>
                      <td>{seconds(item.latencyMs)}</td>
                      <td>{seconds(item.firstTokenLatencyMs)}</td>
                      <td>{dateTime(item.createdAt)}</td>
                    </tr>
                  ))}
                  {requests.length === 0 ? <EmptyRow colSpan={13} /> : null}
                </tbody>
              </>
            )}
          </table>
        </div>
        <div
          className={
            showCost
              ? "mobile-record-list audit-mobile-list"
              : "mobile-record-list"
          }
          onScroll={handleScroll}
        >
          {requests.map((item) => (
            <MobileRecord
              key={item.id}
              title={item.model}
              meta={dateTime(item.createdAt)}
              badges={
                <>
                  <StatusPill status={getRequestStatusPillStatus(item)} />
                  {getCompactRequestLabel(item) ? (
                    <span className="request-compact-fallback-pill">
                      {getCompactRequestLabel(item)}
                    </span>
                  ) : null}
                </>
              }
            >
              <MobileField label="追踪编码" wide>
                <strong className="request-trace-code">
                  {formatRequestTraceCode(item)}
                </strong>
              </MobileField>
              {showCost ? (
                <>
                  <MobileField label="用户" wide>
                    {item.user?.email ?? "-"}
                  </MobileField>
                  <MobileField label="上游" wide>
                    {item.upstreamProvider ?? "-"}
                  </MobileField>
                  <MobileField label="上游 Key" wide>
                    {formatRequestUpstreamKey(item.upstreamProviderKey)}
                  </MobileField>
                  <MobileField label="推理强度">
                    {formatReasoningEffortCell(
                      item.reasoningEffort,
                      item.reasoningEffortActual,
                    )}
                  </MobileField>
                </>
              ) : null}
              <MobileField label="API Key" wide>
                {formatRequestApiKey(item.apiKey)}
              </MobileField>
              <MobileField label="IP" wide>
                <IpCell
                  ip={item.clientIp}
                  banned={Boolean(
                    item.clientIp &&
                    bannedIpSet.has(normalizeIpForCompare(item.clientIp)),
                  )}
                />
              </MobileField>
              <MobileField label="输入">
                {formatNumber(item.inputTokens)}
              </MobileField>
              <MobileField label="缓存">
                {formatNumber(item.cachedInputTokens)}
              </MobileField>
              <MobileField label="输出">
                {formatNumber(item.outputTokens)}
              </MobileField>
              <MobileField label="总 token">
                {formatNumber(item.totalTokens)}
              </MobileField>
              <MobileField label="扣费">
                ${money(item.chargedAmountUsd)}
              </MobileField>
              {showCost ? (
                <>
                  <MobileField label="上游成本">
                    ${money(item.upstreamCostUsd ?? "0")}
                  </MobileField>
                  <MobileField label="毛利">
                    $
                    {money(
                      Number(item.chargedAmountUsd) -
                        Number(item.upstreamCostUsd ?? 0),
                    )}
                  </MobileField>
                </>
              ) : null}
              <MobileField label="总时间">
                {seconds(item.latencyMs)}
              </MobileField>
              <MobileField label="首 token">
                {seconds(item.firstTokenLatencyMs)}
              </MobileField>
              {getReturnedNoticeText(item) ? (
                <MobileField label="用户返回" wide>
                  已返回公告式提示
                </MobileField>
              ) : null}
              {getCompactRequestLabel(item) ? (
                <MobileField label="网关处理" wide>
                  {getCompactRequestLabel(item)}
                </MobileField>
              ) : null}
              {isManualTerminatedRequest(item) ? (
                <MobileField label="终止说明" wide>
                  管理员手动终止
                </MobileField>
              ) : null}
              {hasRequestError(item) ? (
                <div className="mobile-actions">
                  <button
                    className="button secondary"
                    onClick={() => void openRequestDetail(item)}
                    type="button"
                  >
                    <FileSearch size={16} />
                    查看报错详情
                  </button>
                </div>
              ) : null}
              {showCost && item.status === "PENDING" ? (
                <div className="mobile-actions">
                  <button
                    className="button danger"
                    disabled={
                      terminatingRequestId === item.id ||
                      isProtectedCompactRequest(item)
                    }
                    onClick={() => void terminateRequest(item)}
                    title={
                      isProtectedCompactRequest(item)
                        ? "这条 compact 调用不受自动倒计时终止限制，也不允许手动终止"
                        : "终止这条仍在处理中的调用"
                    }
                    type="button"
                  >
                    <CircleStop size={16} />
                    {isProtectedCompactRequest(item)
                      ? "compact 保护中"
                      : "终止"}
                  </button>
                </div>
              ) : null}
            </MobileRecord>
          ))}
          {requests.length === 0 ? (
            <MobileEmpty>暂无调用记录</MobileEmpty>
          ) : null}
        </div>
        {showCost ? (
          <div className="audit-load-state">
            {loadingMore
              ? "加载更多调用记录..."
              : hasMore
                ? "继续向下滚动加载更多"
                : "已加载全部调用记录"}
          </div>
        ) : null}
      </section>
      {selectedRequest ? (
        <RequestDetailModal
          detailError={detailError}
          loading={detailLoading}
          onClose={() => {
            setSelectedRequest(null);
            setDetailError(null);
          }}
          request={selectedRequest}
        />
      ) : null}
    </>
  );
}

function IpCell({ ip, banned }: { ip?: string | null; banned: boolean }) {
  if (!ip) {
    return <span>-</span>;
  }

  return (
    <div className="ip-cell">
      <span>{ip}</span>
      {banned ? <span className="ip-ban-pill">已封禁</span> : null}
    </div>
  );
}

function AuditRequestRow({
  item,
  bannedIpSet,
  terminatingRequestId,
  onOpenDetail,
  onTerminate,
}: {
  item: ApiRequest;
  bannedIpSet: Set<string>;
  terminatingRequestId: string | null;
  onOpenDetail: (request: ApiRequest) => Promise<void>;
  onTerminate: (request: ApiRequest) => Promise<void>;
}) {
  const compactFallbacks = item.compactFallbacks ?? [];

  return (
    <>
      <tr>
        <td>
          <strong className="request-trace-code">
            {formatRequestTraceCode(item)}
          </strong>
        </td>
        <td>
          <div className="audit-stack">
            <strong>{item.user?.email ?? "-"}</strong>
            <span>API Key：{formatRequestApiKey(item.apiKey)}</span>
            <IpCell
              ip={item.clientIp}
              banned={Boolean(
                item.clientIp &&
                bannedIpSet.has(normalizeIpForCompare(item.clientIp)),
              )}
            />
          </div>
        </td>
        <td>
          <div className="audit-stack">
            <strong>{item.model}</strong>
            <span>上游：{item.upstreamProvider ?? "-"}</span>
            <span>
              上游 Key：{formatRequestUpstreamKey(item.upstreamProviderKey)}
            </span>
            <span>
              推理：
              {formatReasoningEffortCell(
                item.reasoningEffort,
                item.reasoningEffortActual,
              )}
            </span>
          </div>
        </td>
        <td>
          <div className="request-status-cell">
            <StatusPill status={getRequestStatusPillStatus(item)} />
            {getCompactRequestLabel(item) ? (
              <span className="request-compact-fallback-pill">
                {getCompactRequestLabel(item)}
              </span>
            ) : null}
            {compactFallbacks.length > 0 ? (
              <span className="request-compact-fallback-pill secondary">
                二次 {compactFallbacks.length}
              </span>
            ) : null}
            {getReturnedNoticeText(item) ? (
              <span className="request-notice-pill">已提示</span>
            ) : null}
            {hasRequestError(item) ? (
              <button
                className="request-detail-button"
                onClick={() => void onOpenDetail(item)}
                title="查看详细报错原因和过程"
                type="button"
              >
                <FileSearch size={13} />
                详情
              </button>
            ) : null}
          </div>
        </td>
        <td>
          <div className="audit-metric-grid">
            <AuditMetric label="输入" value={formatNumber(item.inputTokens)} />
            <AuditMetric
              label="缓存"
              value={formatNumber(item.cachedInputTokens)}
            />
            <AuditMetric label="输出" value={formatNumber(item.outputTokens)} />
            <AuditMetric
              label="总计"
              value={formatNumber(item.totalTokens)}
              strong
            />
          </div>
        </td>
        <td>
          <div className="audit-metric-grid">
            <AuditMetric
              label="扣费"
              value={`$${money(item.chargedAmountUsd)}`}
              strong
            />
            <AuditMetric
              label="成本"
              value={`$${money(item.upstreamCostUsd ?? "0")}`}
            />
            <AuditMetric
              label="毛利"
              value={`$${money(Number(item.chargedAmountUsd) - Number(item.upstreamCostUsd ?? 0))}`}
            />
          </div>
        </td>
        <td>
          <div className="audit-stack">
            <span>总：{seconds(item.latencyMs)}</span>
            <span>首 token：{seconds(item.firstTokenLatencyMs)}</span>
            <span>{dateTime(item.createdAt)}</span>
          </div>
        </td>
        <td>
          {item.status === "PENDING" ? (
            <button
              className="request-terminate-button"
              disabled={
                terminatingRequestId === item.id ||
                isProtectedCompactRequest(item)
              }
              onClick={() => void onTerminate(item)}
              title={
                isProtectedCompactRequest(item)
                  ? "这条 compact 调用不受自动倒计时终止限制，也不允许手动终止"
                  : "终止这条仍在处理中的调用"
              }
              type="button"
            >
              <CircleStop size={13} />
              {isProtectedCompactRequest(item) ? "保护中" : "终止"}
            </button>
          ) : (
            "-"
          )}
        </td>
      </tr>
      {compactFallbacks.length > 0 ? (
        <tr className="compact-fallback-linked-row">
          <td colSpan={8}>
            <div className="compact-fallback-linked-list">
              {compactFallbacks.map((fallback) => (
                <div className="compact-fallback-linked-item" key={fallback.id}>
                  <span className="request-compact-fallback-pill">
                    二次 compact
                  </span>
                  <strong>
                    {formatTraceLike(fallback.traceCode, fallback.id)}
                  </strong>
                  <span>
                    {formatFingerprintRoute(fallback.sourceFingerprint)} →{" "}
                    {formatFingerprintRoute(fallback.targetFingerprint)}
                  </span>
                  <span>
                    目标：{fallback.upstreamProvider ?? "-"} ·{" "}
                    {formatRequestUpstreamKey(
                      fallback.upstreamProviderKey ?? null,
                    )}
                  </span>
                  <span>
                    替换 {formatNumber(Number(fallback.replacements ?? 0))} 处 ·{" "}
                    {fallback.fallbackSucceeded === false ? "未完成" : "成功"}
                  </span>
                  <span>{dateTime(fallback.createdAt)}</span>
                </div>
              ))}
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function AuditMetric({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: ReactNode;
  strong?: boolean;
}) {
  return (
    <div className={strong ? "audit-metric strong" : "audit-metric"}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function RequestDetailModal({
  request,
  loading,
  detailError,
  onClose,
}: {
  request: ApiRequestDetail;
  loading: boolean;
  detailError: string | null;
  onClose: () => void;
}) {
  const failureSummary = describeRequestFailure(request);
  const processSteps = buildRequestProcess(request, failureSummary);
  const returnedNoticeText = getReturnedNoticeText(request);
  const reasoningEffort = getRequestReasoningEffort(request);
  const manualTerminated = isManualTerminatedRequest(request);
  const compactFallback = isCompactFallbackRequest(request);

  return (
    <ModalShell
      title="调用详情"
      description={`${request.model} · ${dateTime(request.createdAt)}`}
      onClose={onClose}
      wide
    >
      <div className="modal-body request-detail-modal">
        {loading ? (
          <div className="info-box">正在加载完整调用记录...</div>
        ) : null}
        {detailError ? (
          <div className="error">详情加载失败：{detailError}</div>
        ) : null}
        <section className="request-detail-section">
          <div className="request-detail-section-head">
            <h3>失败原因</h3>
            <StatusPill status={getRequestStatusPillStatus(request)} />
          </div>
          {manualTerminated ? (
            <div className="request-returned-notice">这是手动终止记录。</div>
          ) : null}
          {compactFallback ? (
            <div className="request-returned-notice">
              这条调用是 compact，并且发生过无感二次 compact。
            </div>
          ) : null}
          <div
            className={
              hasRequestError(request)
                ? "request-reason-box failed"
                : "request-reason-box"
            }
          >
            {failureSummary}
          </div>
          {request.errorMessage ? (
            <pre className="request-error-pre">
              {formatErrorForDisplay(request.errorMessage)}
            </pre>
          ) : (
            <div className="info-box">这条记录没有保存 errorMessage。</div>
          )}
        </section>

        {returnedNoticeText ? (
          <section className="request-detail-section notice-returned-section">
            <div className="request-detail-section-head">
              <h3>已返回给用户的提示</h3>
              <span className="request-notice-pill">公告式提示</span>
            </div>
            <div className="request-returned-notice">{returnedNoticeText}</div>
          </section>
        ) : null}

        <section className="request-detail-section">
          <div className="request-detail-section-head">
            <h3>调用过程</h3>
            <span className="section-subtitle">按网关处理顺序还原</span>
          </div>
          <div className="request-process-list">
            {processSteps.map((step) => (
              <div className="request-process-step" key={step.title}>
                <span className={`request-process-badge ${step.tone}`}>
                  {step.state}
                </span>
                <div>
                  <strong>{step.title}</strong>
                  <p>{step.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="request-detail-section">
          <div className="request-detail-section-head">
            <h3>基础信息</h3>
          </div>
          <div className="request-detail-grid">
            <RequestDetailField label="追踪编码">
              {formatRequestTraceCode(request)}
            </RequestDetailField>
            <RequestDetailField label="用户">
              {request.user?.email ?? "-"}
            </RequestDetailField>
            <RequestDetailField label="API Key">
              {formatRequestApiKey(request.apiKey)}
            </RequestDetailField>
            <RequestDetailField label="客户端 IP">
              {request.clientIp ?? "-"}
            </RequestDetailField>
            <RequestDetailField label="User-Agent" wide>
              {request.userAgent ?? "-"}
            </RequestDetailField>
            <RequestDetailField label="接口">
              {request.method ?? "POST"} {request.endpoint}
            </RequestDetailField>
            <RequestDetailField label="模型">
              {request.model}
            </RequestDetailField>
            {reasoningEffort ? (
              <RequestDetailField label="推理强度">
                {formatReasoningEffortCell(
                  reasoningEffort,
                  request.reasoningEffortActual,
                )}
              </RequestDetailField>
            ) : null}
            <RequestDetailField label="上游">
              {request.upstreamProvider ?? "-"}
            </RequestDetailField>
            <RequestDetailField label="上游 Key">
              {formatRequestUpstreamKey(request.upstreamProviderKey)}
            </RequestDetailField>
            <RequestDetailField label="HTTP 状态">
              {request.httpStatus ?? "-"}
            </RequestDetailField>
            <RequestDetailField label="上游请求 ID">
              {request.upstreamRequestId ?? "-"}
            </RequestDetailField>
            <RequestDetailField label="总时间">
              {seconds(request.latencyMs)}
            </RequestDetailField>
            <RequestDetailField label="首 token">
              {seconds(request.firstTokenLatencyMs)}
            </RequestDetailField>
            <RequestDetailField label="创建时间">
              {dateTime(request.createdAt)}
            </RequestDetailField>
            <RequestDetailField label="更新时间">
              {request.updatedAt ? dateTime(request.updatedAt) : "-"}
            </RequestDetailField>
            <RequestDetailField label="Token" wide>
              输入 {formatNumber(request.inputTokens)} · 缓存{" "}
              {formatNumber(request.cachedInputTokens)} · 输出{" "}
              {formatNumber(request.outputTokens)} · 总计{" "}
              {formatNumber(request.totalTokens)}
            </RequestDetailField>
            <RequestDetailField label="费用" wide>
              用户扣费 ${money(request.chargedAmountUsd)} · 上游成本 $
              {money(request.upstreamCostUsd ?? "0")} · 毛利 $
              {money(
                Number(request.chargedAmountUsd) -
                  Number(request.upstreamCostUsd ?? 0),
              )}
            </RequestDetailField>
          </div>
        </section>

        <section className="request-json-grid">
          <JsonPanel title="请求体快照" value={request.requestBody} />
          <JsonPanel title="Usage / 计费快照" value={request.responseUsage} />
        </section>
      </div>
      <div className="modal-footer">
        <button className="button secondary" onClick={onClose} type="button">
          关闭
        </button>
      </div>
    </ModalShell>
  );
}

function RequestDetailField({
  label,
  children,
  wide = false,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className={wide ? "request-detail-field wide" : "request-detail-field"}
    >
      <span>{label}</span>
      <strong>{children}</strong>
    </div>
  );
}

function JsonPanel({ title, value }: { title: string; value: unknown }) {
  return (
    <div className="request-json-panel">
      <div className="request-detail-section-head">
        <h3>{title}</h3>
      </div>
      <pre>{formatJsonValue(value)}</pre>
    </div>
  );
}

function hasRequestError(item: ApiRequest) {
  return (
    item.status === "FAILED" ||
    Boolean(item.errorMessage) ||
    Boolean(item.httpStatus && item.httpStatus >= 400)
  );
}

function getReturnedNoticeText(item: Pick<ApiRequest, "responseUsage">) {
  const usage = item.responseUsage;

  if (!usage || typeof usage !== "object" || Array.isArray(usage)) {
    return null;
  }

  const record = usage as Record<string, unknown>;
  const source = typeof record.source === "string" ? record.source : "";
  if (
    source !== "gateway_recovery_notice" &&
    source !== "gateway_ip_ban_notice"
  ) {
    return null;
  }

  if (record.returnedToUser !== true) {
    return null;
  }

  return typeof record.noticeText === "string" && record.noticeText.trim()
    ? record.noticeText
    : source === "gateway_ip_ban_notice"
      ? "当前 IP 已被网关封禁。"
      : "网关已把这次失败转换成公告式提示返回给用户。";
}

function isCompactFallbackRequest(item: Pick<ApiRequest, "responseUsage">) {
  return Boolean(getCompactFallbackTrace(item));
}

function isProtectedCompactRequest(
  item: Pick<ApiRequest, "endpoint" | "responseUsage">,
) {
  return Boolean(getCompactRequestLabel(item));
}

function getCompactRequestLabel(
  item: Pick<ApiRequest, "endpoint" | "responseUsage">,
) {
  if (item.endpoint === "/v1/responses/compact") {
    return "compact";
  }

  const usage = item.responseUsage;
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) {
    return null;
  }

  const record = usage as Record<string, unknown>;
  if (
    record.gatewayCompactFallback === true ||
    record.gatewayCompactKind === "fallback"
  ) {
    return "compact · 二次";
  }

  if (record.gatewayCompactKind === "normal") {
    return "compact";
  }

  return null;
}

function getCompactFallbackTrace(item: Pick<ApiRequest, "responseUsage">) {
  const usage = item.responseUsage;

  if (!usage || typeof usage !== "object" || Array.isArray(usage)) {
    return null;
  }

  const record = usage as Record<string, unknown>;
  if (record.gatewayCompactFallback !== true) {
    return null;
  }

  return isPlainRecord(record.compactFallback)
    ? record.compactFallback
    : record;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isManualTerminatedRequest(
  item: Pick<ApiRequest, "responseUsage" | "errorMessage" | "httpStatus">,
) {
  const usage = item.responseUsage;
  if (usage && typeof usage === "object" && !Array.isArray(usage)) {
    const record = usage as Record<string, unknown>;
    if (record.source === "gateway_manual_termination") {
      return true;
    }
  }

  return item.httpStatus === 499 || item.errorMessage === "手动终止";
}

function getRequestStatusPillStatus(item: ApiRequest) {
  return isManualTerminatedRequest(item) ? "TERMINATED" : item.status;
}

function getRequestReasoningEffort(
  item: Pick<ApiRequestDetail, "requestBody" | "reasoningEffort">,
) {
  if (item.reasoningEffort?.trim()) {
    return item.reasoningEffort.trim();
  }

  const body = item.requestBody;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }

  const record = body as Record<string, unknown>;
  const direct =
    typeof record.reasoning_effort === "string"
      ? record.reasoning_effort.trim()
      : "";
  if (direct) {
    return direct;
  }

  const modelDirect =
    typeof record.model_reasoning_effort === "string"
      ? record.model_reasoning_effort.trim()
      : "";
  if (modelDirect) {
    return modelDirect;
  }

  const reasoning = record.reasoning;
  if (reasoning && typeof reasoning === "object" && !Array.isArray(reasoning)) {
    const nested = reasoning as Record<string, unknown>;
    const nestedEffort =
      typeof nested.effort === "string" ? nested.effort.trim() : "";
    if (nestedEffort) {
      return nestedEffort;
    }
  }

  return null;
}

function formatReasoningEffort(value: string) {
  const normalized = value.trim().toLowerCase();
  const labels: Record<string, string> = {
    minimal: "最低",
    low: "低",
    medium: "中",
    high: "高",
    xhigh: "超高",
  };

  return labels[normalized] ?? value.trim();
}

function getEnabledReasoningRulesSummary(
  settings: ReasoningEffortTransformSettings | null,
) {
  const enabledRules = settings?.rules.filter((rule) => rule.enabled) ?? [];
  if (enabledRules.length === 0) {
    return "关";
  }

  if (enabledRules.length === 1) {
    const rule = enabledRules[0];
    return rule
      ? `${formatReasoningEffort(rule.from)}→${formatReasoningEffort(rule.to)}`
      : "关";
  }

  return `${enabledRules.length} 条`;
}

function formatReasoningEffortCell(
  value?: string | null,
  actualValue?: string | null,
) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return "-";
  }

  const actual = actualValue?.trim();
  const originalLabel = `${formatReasoningEffort(trimmed)} · ${trimmed}`;
  if (actual && actual.toLowerCase() !== trimmed.toLowerCase()) {
    return `${originalLabel} → ${formatReasoningEffort(actual)} · ${actual}`;
  }

  return originalLabel;
}

function isIpBanRequest(
  item: Pick<ApiRequest, "responseUsage" | "errorMessage">,
) {
  const usage = item.responseUsage;
  if (usage && typeof usage === "object" && !Array.isArray(usage)) {
    const source = (usage as Record<string, unknown>).source;
    if (
      source === "gateway_ip_ban_notice" ||
      source === "gateway_ip_ban_error"
    ) {
      return true;
    }
  }

  return Boolean(item.errorMessage?.toLowerCase().includes("ip banned"));
}

function buildRequestProcess(
  request: ApiRequestDetail,
  failureSummary: string,
) {
  const failed = hasRequestError(request);
  const returnedNoticeText = getReturnedNoticeText(request);
  const manualTerminated = isManualTerminatedRequest(request);
  const compactFallback = getCompactFallbackTrace(request);
  const steps = [
    {
      title: "1. 网关接收请求",
      state: "完成",
      tone: "ok",
      detail: `${request.method ?? "POST"} ${request.endpoint} · ${dateTime(request.createdAt)} · IP ${request.clientIp ?? "-"}`,
    },
    {
      title: "2. 匹配用户、Key 和上游",
      state: request.upstreamProvider ? "完成" : "缺失",
      tone: request.upstreamProvider ? "ok" : "warn",
      detail: `${request.user?.email ?? "-"} · ${formatRequestApiKey(request.apiKey)} · ${request.upstreamProvider ?? "-"} · ${formatRequestUpstreamKey(request.upstreamProviderKey)}`,
    },
    ...(compactFallback
      ? [
          {
            title: "3. compact 处理",
            state:
              compactFallback.fallbackSucceeded === false ? "处理中" : "完成",
            tone: compactFallback.fallbackSucceeded === false ? "warn" : "ok",
            detail: `这条调用发生过无感二次 compact，已用原始 compact 请求在当前渠道重新压缩并替换 ${formatNumber(Number(compactFallback.replacements ?? 0))} 处上下文 item。`,
          },
        ]
      : []),
    {
      title: compactFallback ? "4. 上游响应" : "3. 上游响应",
      state: request.httpStatus ? (failed ? "异常" : "完成") : "未返回",
      tone: manualTerminated
        ? "warn"
        : failed
          ? "error"
          : request.httpStatus
            ? "ok"
            : "warn",
      detail: manualTerminated
        ? `HTTP ${request.httpStatus ?? "-"} · 上游请求 ID ${request.upstreamRequestId ?? "-"} · 已被管理员终止 · 总时间 ${seconds(request.latencyMs)}`
        : `HTTP ${request.httpStatus ?? "-"} · 上游请求 ID ${request.upstreamRequestId ?? "-"} · 总时间 ${seconds(request.latencyMs)} · 首 token ${seconds(request.firstTokenLatencyMs)}`,
    },
    {
      title: compactFallback ? "5. Usage 与扣费" : "4. Usage 与扣费",
      state: manualTerminated ? "中止" : failed ? "中断" : "完成",
      tone: manualTerminated ? "warn" : failed ? "warn" : "ok",
      detail: `总 token ${formatNumber(request.totalTokens)} · 用户扣费 $${money(request.chargedAmountUsd)} · 上游成本 $${money(request.upstreamCostUsd ?? "0")}`,
    },
    {
      title: compactFallback ? "6. 最终结果" : "5. 最终结果",
      state: returnedNoticeText
        ? "已提示"
        : manualTerminated
          ? "手动终止"
          : failed
            ? "失败"
            : request.status,
      tone: returnedNoticeText
        ? "warn"
        : manualTerminated
          ? "warn"
          : failed
            ? "error"
            : "ok",
      detail: returnedNoticeText
        ? isIpBanRequest(request)
          ? "这次调用命中了 IP 封禁规则，并已按公告式接口格式返回给用户。"
          : "这次失败已经按公告式接口格式返回给用户，后台保留原始失败原因。"
        : manualTerminated
          ? "管理员已终止这条仍在处理中的调用，并尝试中断上游请求。"
          : failed
            ? failureSummary
            : "调用成功完成，后台已记录用量与费用。",
    },
  ];

  return steps;
}

function describeRequestFailure(request: ApiRequestDetail) {
  const message = request.errorMessage?.trim() ?? "";
  const normalized = message.toLowerCase();
  const returnedNoticeText = getReturnedNoticeText(request);

  if (!hasRequestError(request)) {
    return "这条调用没有报错。";
  }

  if (isIpBanRequest(request)) {
    return returnedNoticeText
      ? "这条调用命中了 IP 封禁规则，网关没有转发到上游，并已把封禁内容按公告式提示返回给用户。"
      : "这条调用命中了 IP 封禁规则，网关没有转发到上游，已直接返回封禁报错。";
  }

  if (isManualTerminatedRequest(request)) {
    return "这条调用被管理员手动终止，网关已尝试中断上游请求并将记录标记为失败。";
  }

  if (returnedNoticeText) {
    return "这条失败已经转换成公告式提示返回给用户，下面保留的是后台记录的原始失败原因。";
  }

  if (
    normalized.includes("items are not persisted when store is set to false") ||
    (normalized.includes("item with id") &&
      normalized.includes("not found") &&
      normalized.includes("rs_"))
  ) {
    return "客户端复用了已经失效的 Responses 上下文 item。通常需要新建对话、清空上下文，或在客户端开启 store=true 后再跨轮复用 previous_response_id / rs_ item。";
  }

  if (
    normalized.includes("invalid_encrypted_content") ||
    normalized.includes("encrypted content could not be decrypted or parsed")
  ) {
    return "客户端传入了无效的 Responses encrypted_content，通常是把压缩摘要或普通文本误放进了上下文。";
  }

  if (
    normalized.includes(
      "upstream response did not include billable token usage",
    )
  ) {
    return "上游没有返回可计费 usage，网关无法安全扣费，所以这次调用被拦截为失败。";
  }

  if (
    normalized.includes("first token timeout") ||
    normalized.includes("timeout")
  ) {
    return "上游在超时时间内没有返回首 token 或完整响应，网关主动中止了这次调用。";
  }

  if (
    normalized.includes("aborted") ||
    normalized.includes("internal_error") ||
    normalized.includes("received from peer")
  ) {
    return "上游连接在响应过程中被中断，常见于上游流式连接异常、客户端上下文失效或上游临时波动。";
  }

  if (request.httpStatus === 401 || request.httpStatus === 403) {
    return "上游拒绝了请求，优先检查上游 Key 是否有效、模型权限是否开放、余额或地域限制是否触发。";
  }

  if (request.httpStatus === 404) {
    return "上游返回 404，常见原因是模型、接口路径或 Responses 上下文引用不存在。";
  }

  if (request.httpStatus && request.httpStatus >= 500) {
    return "上游返回 5xx，说明请求已到达上游但上游处理失败或服务异常。";
  }

  return message
    ? "上游或网关返回失败，完整原始错误如下。"
    : "后台只记录到失败状态，没有保存更详细的 errorMessage。";
}

function formatErrorForDisplay(message: string) {
  const trimmed = message.trim();
  const jsonStart = trimmed.search(/[\[{]/);

  if (jsonStart >= 0) {
    const prefix = trimmed.slice(0, jsonStart).trim();
    const jsonText = trimmed.slice(jsonStart);
    try {
      const formatted = JSON.stringify(JSON.parse(jsonText), null, 2);
      return prefix ? `${prefix}\n${formatted}` : formatted;
    } catch {
      return trimmed;
    }
  }

  return trimmed;
}

function formatJsonValue(value: unknown) {
  if (value === null || value === undefined) {
    return "暂无记录";
  }

  if (typeof value === "string") {
    return formatErrorForDisplay(value);
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function countAdvancedRequestFilters(filters: RequestFilters) {
  return advancedRequestFilterKeys.filter((key) => filters[key].trim()).length;
}

function RequestSummaryCards({ summary }: { summary: AdminRequestsSummary }) {
  return (
    <div className="request-summary-grid" aria-live="polite">
      <div className="request-summary-tile">
        <span>匹配记录</span>
        <strong>{formatNumber(summary.totalCount)}</strong>
        <small>
          成功 {formatNumber(summary.successCount)} · 失败{" "}
          {formatNumber(summary.failedCount)} · 待处理{" "}
          {formatNumber(summary.pendingCount)}
        </small>
      </div>
      <div className="request-summary-tile">
        <span>失败率</span>
        <strong>{formatPercent(summary.failureRate)}</strong>
        <small>按全部匹配记录计算</small>
      </div>
      <div className="request-summary-tile">
        <span>Token</span>
        <strong>{formatNumber(summary.totalTokens)}</strong>
        <small>
          输入 {formatNumber(summary.inputTokens)} · 缓存{" "}
          {formatNumber(summary.cachedInputTokens)} · 输出{" "}
          {formatNumber(summary.outputTokens)}
        </small>
      </div>
      <div className="request-summary-tile">
        <span>费用与毛利</span>
        <strong>${money(summary.grossProfitUsd)}</strong>
        <small>
          扣费 ${money(summary.chargedAmountUsd)} · 成本 $
          {money(summary.upstreamCostUsd)}
        </small>
      </div>
      <div className="request-summary-tile">
        <span>平均耗时</span>
        <strong>{seconds(summary.avgLatencyMs)}</strong>
        <small>首 token {seconds(summary.avgFirstTokenLatencyMs)}</small>
      </div>
    </div>
  );
}

function RangeFilter({
  label,
  minValue,
  maxValue,
  onMinChange,
  onMaxChange,
  step = "any",
}: {
  label: string;
  minValue: string;
  maxValue: string;
  onMinChange: (value: string) => void;
  onMaxChange: (value: string) => void;
  step?: string;
}) {
  return (
    <div className="range-field">
      <span>{label}</span>
      <div className="range-inputs">
        <input
          aria-label={`${label} 最小值`}
          className="input"
          inputMode="decimal"
          onChange={(event) => onMinChange(event.target.value)}
          placeholder="最小"
          step={step}
          type="number"
          value={minValue}
        />
        <input
          aria-label={`${label} 最大值`}
          className="input"
          inputMode="decimal"
          onChange={(event) => onMaxChange(event.target.value)}
          placeholder="最大"
          step={step}
          type="number"
          value={maxValue}
        />
      </div>
    </div>
  );
}

function AdminRequests({
  requests,
  summary,
  ipBanRules,
  users,
  filters,
  pendingAutoTerminateSettings,
  reasoningEffortTransformSettings,
  hasMore,
  loadingMore,
  onFiltersChange,
  onLoadMore,
  onSearch,
  onRulesChanged,
  onRequestTerminated,
  onPendingAutoTerminateSettingsChanged,
  onReasoningEffortTransformSettingsChanged,
}: {
  requests: ApiRequest[];
  summary: AdminRequestsSummary;
  ipBanRules: IpBanRule[];
  users: AdminUser[];
  filters: RequestFilters;
  pendingAutoTerminateSettings: PendingAutoTerminateSettings | null;
  reasoningEffortTransformSettings: ReasoningEffortTransformSettings | null;
  hasMore: boolean;
  loadingMore: boolean;
  onFiltersChange: (filters: RequestFilters) => void;
  onLoadMore: () => void;
  onSearch: (filters: RequestFilters) => void;
  onRulesChanged: (rules: IpBanRule[]) => void;
  onRequestTerminated: () => void;
  onPendingAutoTerminateSettingsChanged: (
    settings: PendingAutoTerminateSettings,
  ) => void;
  onReasoningEffortTransformSettingsChanged: (
    settings: ReasoningEffortTransformSettings,
  ) => void;
}) {
  const [ipInput, setIpInput] = useState("");
  const [banMode, setBanMode] = useState<IpBanMode>("error");
  const [banMessage, setBanMessage] = useState(defaultIpBanMessage);
  const [banReason, setBanReason] = useState("");
  const [banBusyIp, setBanBusyIp] = useState<string | null>(null);
  const [banError, setBanError] = useState<string | null>(null);
  const [banModalOpen, setBanModalOpen] = useState(false);
  const [autoTerminateModalOpen, setAutoTerminateModalOpen] = useState(false);
  const [reasoningTransformModalOpen, setReasoningTransformModalOpen] =
    useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [autoTerminateBusy, setAutoTerminateBusy] = useState(false);
  const [autoTerminateError, setAutoTerminateError] = useState<string | null>(
    null,
  );
  const [autoTerminateDraftEnabled, setAutoTerminateDraftEnabled] = useState(
    Boolean(pendingAutoTerminateSettings?.enabled),
  );
  const [autoTerminateDraftSeconds, setAutoTerminateDraftSeconds] = useState(
    String(pendingAutoTerminateSettings?.timeoutSeconds ?? 30),
  );
  const [reasoningTransformBusy, setReasoningTransformBusy] = useState(false);
  const [reasoningTransformError, setReasoningTransformError] = useState<
    string | null
  >(null);
  const [reasoningTransformDraft, setReasoningTransformDraft] = useState({
    rules: reasoningEffortTransformSettings?.rules ?? [
      { enabled: true, from: "high", to: "medium" },
    ],
  });
  const activeAdvancedCount = countAdvancedRequestFilters(filters);
  const minAutoTerminateSeconds =
    pendingAutoTerminateSettings?.minTimeoutSeconds ?? 5;
  const maxAutoTerminateSeconds =
    pendingAutoTerminateSettings?.maxTimeoutSeconds ?? 3600;
  const reasoningEffortOptions = ["low", "medium", "high", "xhigh"];
  const reasoningTransformConflict = detectReasoningRuleConflicts();

  useEffect(() => {
    if (pendingAutoTerminateSettings) {
      setAutoTerminateDraftEnabled(pendingAutoTerminateSettings.enabled);
      setAutoTerminateDraftSeconds(
        String(pendingAutoTerminateSettings.timeoutSeconds),
      );
    }
  }, [
    pendingAutoTerminateSettings?.enabled,
    pendingAutoTerminateSettings?.timeoutSeconds,
  ]);

  useEffect(() => {
    if (reasoningEffortTransformSettings) {
      setReasoningTransformDraft({
        rules: reasoningEffortTransformSettings.rules.length
          ? reasoningEffortTransformSettings.rules
          : [{ enabled: true, from: "high", to: "medium" }],
      });
    }
  }, [reasoningEffortTransformSettings?.rules]);

  function update<K extends keyof RequestFilters>(
    key: K,
    value: RequestFilters[K],
  ) {
    onFiltersChange({ ...filters, [key]: value });
  }

  function resetFilters() {
    const nextFilters = { ...emptyRequestFilters };
    onFiltersChange(nextFilters);
    onSearch(nextFilters);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSearch(filters);
  }

  async function saveRule(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    setBanError(null);

    const normalizedIp = normalizeIpForCompare(ipInput);
    if (!normalizedIp) {
      setBanError("请填写有效 IP。");
      return;
    }

    setBanBusyIp(normalizedIp);
    try {
      const result = await apiFetch<{ rules: IpBanRule[] }>(
        "/admin/ip-ban-rules",
        {
          method: "POST",
          body: JSON.stringify({
            ip: normalizedIp,
            mode: banMode,
            message: banMessage.trim() || defaultIpBanMessage,
            reason: banReason.trim() || null,
          }),
        },
      );
      onRulesChanged(result.rules);
      setIpInput("");
      setBanReason("");
    } catch (error) {
      setBanError(errorToText(error));
    } finally {
      setBanBusyIp(null);
    }
  }

  function openBanModal(ip?: string) {
    if (ip) {
      const normalizedIp = normalizeIpForCompare(ip);
      if (!normalizedIp) {
        setBanError("这条记录没有有效 IP。");
      } else {
        setIpInput(normalizedIp);
        setBanReason((current) => current || "从全站调用记录封禁");
        setBanError(null);
      }
    } else {
      setBanError(null);
    }

    setBanModalOpen(true);
  }

  async function deleteRule(ip: string) {
    const confirmed = window.confirm(`确定解除 IP「${ip}」的封禁吗？`);
    if (!confirmed) {
      return;
    }

    setBanError(null);
    setBanBusyIp(ip);
    try {
      const result = await apiFetch<{ rules: IpBanRule[] }>(
        `/admin/ip-ban-rules/${encodeURIComponent(ip)}`,
        {
          method: "DELETE",
        },
      );
      onRulesChanged(result.rules);
    } catch (error) {
      setBanError(errorToText(error));
    } finally {
      setBanBusyIp(null);
    }
  }

  async function savePendingAutoTerminateSettings(
    next?: Partial<PendingAutoTerminateSettings>,
  ) {
    const timeoutSeconds = Number(
      next?.timeoutSeconds ?? autoTerminateDraftSeconds,
    );
    const normalizedTimeoutSeconds = Math.min(
      maxAutoTerminateSeconds,
      Math.max(minAutoTerminateSeconds, Math.round(timeoutSeconds)),
    );

    if (!Number.isFinite(timeoutSeconds)) {
      setAutoTerminateError("请填写有效秒数。");
      return;
    }

    setAutoTerminateBusy(true);
    setAutoTerminateError(null);
    try {
      const result = await apiFetch<{ settings: PendingAutoTerminateSettings }>(
        "/admin/pending-auto-terminate-settings",
        {
          method: "PUT",
          body: JSON.stringify({
            enabled: next?.enabled ?? autoTerminateDraftEnabled,
            timeoutSeconds: normalizedTimeoutSeconds,
          }),
        },
      );
      setAutoTerminateDraftSeconds(String(result.settings.timeoutSeconds));
      onPendingAutoTerminateSettingsChanged(result.settings);
      setAutoTerminateModalOpen(false);
    } catch (error) {
      setAutoTerminateError(errorToText(error));
    } finally {
      setAutoTerminateBusy(false);
    }
  }

  function submitPendingAutoTerminateSettings(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    void savePendingAutoTerminateSettings();
  }

  async function saveReasoningEffortTransformSettings(
    next?: Partial<ReasoningEffortTransformSettings>,
  ) {
    setReasoningTransformBusy(true);
    setReasoningTransformError(null);
    try {
      const result = await apiFetch<{
        settings: ReasoningEffortTransformSettings;
      }>("/admin/reasoning-effort-transform-settings", {
        method: "PUT",
        body: JSON.stringify({
          rules: next?.rules ?? reasoningTransformDraft.rules,
        }),
      });
      setReasoningTransformDraft({
        rules: result.settings.rules.length
          ? result.settings.rules
          : [{ enabled: true, from: "high", to: "medium" }],
      });
      onReasoningEffortTransformSettingsChanged(result.settings);
      setReasoningTransformModalOpen(false);
      onSearch(filters);
    } catch (error) {
      setReasoningTransformError(errorToText(error));
    } finally {
      setReasoningTransformBusy(false);
    }
  }

  function submitReasoningEffortTransformSettings(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    void saveReasoningEffortTransformSettings();
  }

  function updateReasoningRule(
    index: number,
    patch: Partial<ReasoningEffortTransformRule>,
  ) {
    setReasoningTransformDraft((current) => ({
      rules: current.rules.map((rule, currentIndex) =>
        currentIndex === index ? { ...rule, ...patch } : rule,
      ),
    }));
  }

  function addReasoningRule() {
    setReasoningTransformDraft((current) => ({
      rules: [...current.rules, { enabled: true, from: "low", to: "medium" }],
    }));
  }

  function removeReasoningRule(index: number) {
    setReasoningTransformDraft((current) => {
      const nextRules = current.rules.filter(
        (_, currentIndex) => currentIndex !== index,
      );
      return {
        rules: nextRules.length
          ? nextRules
          : [{ enabled: true, from: "high", to: "medium" }],
      };
    });
  }

  function detectReasoningRuleConflicts() {
    const enabledRules = reasoningTransformDraft.rules.filter(
      (rule) => rule.enabled,
    );
    const duplicates = new Map<string, number>();
    for (const rule of enabledRules) {
      duplicates.set(rule.from, (duplicates.get(rule.from) ?? 0) + 1);
    }
    const duplicateSources = [...duplicates.entries()]
      .filter(([, count]) => count > 1)
      .map(([from]) => from);
    const selfTransforms = enabledRules.filter(
      (rule) => rule.from === rule.to,
    ).length;
    return {
      duplicateSources,
      selfTransforms,
      hasConflict: duplicateSources.length > 0 || selfTransforms > 0,
    };
  }

  return (
    <div className="grid admin-page admin-requests-page">
      <section className="card admin-request-filter-card">
        <div className="section-head">
          <div>
            <h2 className="section-title">账单与调用筛选</h2>
            <p className="section-subtitle">
              统计按全部匹配记录计算，列表继续分页加载。
            </p>
          </div>
          <div className="button-row">
            <button
              className="button secondary"
              onClick={() => openBanModal()}
              type="button"
            >
              <Shield size={17} />
              IP 封禁
              <span className="button-count">{ipBanRules.length}</span>
            </button>
            <button
              className="button secondary"
              onClick={() => setAutoTerminateModalOpen(true)}
              type="button"
            >
              <CircleStop size={17} />
              自动终止
              <span className="button-count">
                {pendingAutoTerminateSettings?.enabled
                  ? `${pendingAutoTerminateSettings.timeoutSeconds}s`
                  : "关"}
              </span>
            </button>
            <button
              className="button secondary"
              onClick={() => setReasoningTransformModalOpen(true)}
              type="button"
            >
              <SlidersHorizontal size={17} />
              推理转换
              <span className="button-count">
                {getEnabledReasoningRulesSummary(
                  reasoningEffortTransformSettings,
                )}
              </span>
            </button>
            <button
              aria-expanded={advancedOpen}
              className={
                advancedOpen ? "button secondary active" : "button secondary"
              }
              onClick={() => setAdvancedOpen((open) => !open)}
              type="button"
            >
              <SlidersHorizontal size={17} />
              高级筛选
              {activeAdvancedCount > 0 ? (
                <span className="button-count">{activeAdvancedCount}</span>
              ) : null}
            </button>
            <button
              className="button secondary"
              onClick={resetFilters}
              type="button"
            >
              重置
            </button>
          </div>
        </div>
        <RequestSummaryCards summary={summary} />
        <form className="admin-request-filter-form" onSubmit={submit}>
          <div className="filter-bar request-common-filter-bar">
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
              <select
                className="input"
                value={filters.userId}
                onChange={(event) => update("userId", event.target.value)}
              >
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
                onChange={(event) =>
                  update(
                    "status",
                    event.target.value as RequestFilters["status"],
                  )
                }
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
          </div>
          {advancedOpen ? (
            <div className="advanced-filter-panel">
              <div className="advanced-filter-grid">
                <label className="field">
                  <span>IP</span>
                  <input
                    className="input"
                    value={filters.clientIp}
                    onChange={(event) => update("clientIp", event.target.value)}
                    placeholder="203.0.113.10"
                  />
                </label>
                <label className="field">
                  <span>API Key</span>
                  <input
                    className="input"
                    value={filters.apiKey}
                    onChange={(event) => update("apiKey", event.target.value)}
                    placeholder="名称 / 前缀"
                  />
                </label>
                <label className="field">
                  <span>上游 Provider</span>
                  <input
                    className="input"
                    value={filters.upstreamProvider}
                    onChange={(event) =>
                      update("upstreamProvider", event.target.value)
                    }
                    placeholder="openai"
                  />
                </label>
                <label className="field">
                  <span>上游 Key</span>
                  <input
                    className="input"
                    value={filters.upstreamKey}
                    onChange={(event) =>
                      update("upstreamKey", event.target.value)
                    }
                    placeholder="名称 / 前缀"
                  />
                </label>
                <label className="field">
                  <span>接口 endpoint</span>
                  <input
                    className="input"
                    value={filters.endpoint}
                    onChange={(event) => update("endpoint", event.target.value)}
                    placeholder="/v1/chat/completions"
                  />
                </label>
                <label className="field">
                  <span>HTTP 状态</span>
                  <input
                    className="input"
                    inputMode="numeric"
                    max={599}
                    min={100}
                    onChange={(event) =>
                      update("httpStatus", event.target.value)
                    }
                    placeholder="403"
                    step={1}
                    type="number"
                    value={filters.httpStatus}
                  />
                </label>
                <label className="field">
                  <span>返回类型</span>
                  <select
                    className="input"
                    value={filters.resultType}
                    onChange={(event) =>
                      update(
                        "resultType",
                        event.target.value as RequestFilters["resultType"],
                      )
                    }
                  >
                    <option value="">全部</option>
                    <option value="notice">已公告提示</option>
                    <option value="ip_ban">IP 封禁</option>
                    <option value="error">普通失败</option>
                  </select>
                </label>
                <RangeFilter
                  label="总 token"
                  minValue={filters.minTokens}
                  maxValue={filters.maxTokens}
                  onMinChange={(value) => update("minTokens", value)}
                  onMaxChange={(value) => update("maxTokens", value)}
                  step="1"
                />
                <RangeFilter
                  label="扣费 USD"
                  minValue={filters.minChargedUsd}
                  maxValue={filters.maxChargedUsd}
                  onMinChange={(value) => update("minChargedUsd", value)}
                  onMaxChange={(value) => update("maxChargedUsd", value)}
                />
                <RangeFilter
                  label="上游成本 USD"
                  minValue={filters.minUpstreamCostUsd}
                  maxValue={filters.maxUpstreamCostUsd}
                  onMinChange={(value) => update("minUpstreamCostUsd", value)}
                  onMaxChange={(value) => update("maxUpstreamCostUsd", value)}
                />
                <RangeFilter
                  label="毛利 USD"
                  minValue={filters.minGrossProfitUsd}
                  maxValue={filters.maxGrossProfitUsd}
                  onMinChange={(value) => update("minGrossProfitUsd", value)}
                  onMaxChange={(value) => update("maxGrossProfitUsd", value)}
                />
                <RangeFilter
                  label="总耗时 ms"
                  minValue={filters.minLatencyMs}
                  maxValue={filters.maxLatencyMs}
                  onMinChange={(value) => update("minLatencyMs", value)}
                  onMaxChange={(value) => update("maxLatencyMs", value)}
                  step="1"
                />
                <RangeFilter
                  label="首 token ms"
                  minValue={filters.minFirstTokenLatencyMs}
                  maxValue={filters.maxFirstTokenLatencyMs}
                  onMinChange={(value) =>
                    update("minFirstTokenLatencyMs", value)
                  }
                  onMaxChange={(value) =>
                    update("maxFirstTokenLatencyMs", value)
                  }
                  step="1"
                />
              </div>
            </div>
          ) : null}
        </form>
      </section>
      <Requests
        requests={requests}
        ipBanRules={ipBanRules}
        showCost
        hasMore={hasMore}
        loadingMore={loadingMore}
        onLoadMore={onLoadMore}
        onRequestTerminated={onRequestTerminated}
      />
      {autoTerminateModalOpen ? (
        <ModalShell
          title="Pending 自动终止"
          description="超过设定秒数的 PENDING 会按手动终止处理。"
          onClose={() => setAutoTerminateModalOpen(false)}
        >
          <form className="form" onSubmit={submitPendingAutoTerminateSettings}>
            <div className="modal-body">
              {autoTerminateError ? (
                <div className="error compact-error">{autoTerminateError}</div>
              ) : null}
              <div className="settings-modal-status">
                <StatusPill
                  status={
                    autoTerminateDraftEnabled
                      ? "AUTO_TERMINATE_ON"
                      : "AUTO_TERMINATE_OFF"
                  }
                />
                <span>
                  {autoTerminateDraftEnabled
                    ? `超过 ${autoTerminateDraftSeconds || (pendingAutoTerminateSettings?.timeoutSeconds ?? 30)} 秒自动终止。`
                    : "自动终止已关闭。"}
                </span>
              </div>
              <label className="check-row">
                <input
                  checked={autoTerminateDraftEnabled}
                  disabled={!pendingAutoTerminateSettings || autoTerminateBusy}
                  onChange={(event) =>
                    setAutoTerminateDraftEnabled(event.target.checked)
                  }
                  type="checkbox"
                />
                启用 Pending 自动终止
              </label>
              <label className="field">
                <span>超过多少秒终止</span>
                <input
                  className="input"
                  disabled={!pendingAutoTerminateSettings || autoTerminateBusy}
                  inputMode="numeric"
                  max={maxAutoTerminateSeconds}
                  min={minAutoTerminateSeconds}
                  onChange={(event) =>
                    setAutoTerminateDraftSeconds(event.target.value)
                  }
                  type="number"
                  value={autoTerminateDraftSeconds}
                />
              </label>
            </div>
            <div className="modal-footer">
              <button
                className="button secondary"
                onClick={() => setAutoTerminateModalOpen(false)}
                type="button"
              >
                取消
              </button>
              <button
                className="button"
                disabled={!pendingAutoTerminateSettings || autoTerminateBusy}
                type="submit"
              >
                <Save size={17} />
                保存
              </button>
            </div>
          </form>
        </ModalShell>
      ) : null}
      {reasoningTransformModalOpen ? (
        <ModalShell
          title="推理强度转换"
          description="支持多条规则，命中后用户请求保持原样记录，上游实际请求会换成设定档位。"
          onClose={() => setReasoningTransformModalOpen(false)}
        >
          <form
            className="form"
            onSubmit={submitReasoningEffortTransformSettings}
          >
            <div className="modal-body">
              {reasoningTransformError ? (
                <div className="error compact-error">
                  {reasoningTransformError}
                </div>
              ) : null}
              <div className="settings-modal-status">
                <StatusPill
                  status={
                    reasoningTransformDraft.rules.some((rule) => rule.enabled)
                      ? "REASONING_TRANSFORM_ON"
                      : "REASONING_TRANSFORM_OFF"
                  }
                />
                <span>
                  {reasoningTransformDraft.rules.some((rule) => rule.enabled)
                    ? `${reasoningTransformDraft.rules.filter((rule) => rule.enabled).length} 条规则启用中`
                    : "推理强度转换已关闭。"}
                </span>
              </div>
              <label className="check-row">
                <input
                  checked={reasoningTransformDraft.rules.some(
                    (rule) => rule.enabled,
                  )}
                  disabled={
                    !reasoningEffortTransformSettings || reasoningTransformBusy
                  }
                  onChange={(event) =>
                    setReasoningTransformDraft((current) => ({
                      rules: current.rules.map((rule) => ({
                        ...rule,
                        enabled: event.target.checked,
                      })),
                    }))
                  }
                  type="checkbox"
                />
                启用推理强度转换
              </label>
              <div className="reasoning-transform-rule-list">
                {reasoningTransformDraft.rules.map((rule, index) => (
                  <div
                    className="reasoning-transform-rule"
                    key={`${index}-${rule.from}-${rule.to}`}
                  >
                    <label className="check-row reasoning-transform-rule-switch">
                      <input
                        checked={rule.enabled}
                        disabled={
                          !reasoningEffortTransformSettings ||
                          reasoningTransformBusy
                        }
                        onChange={(event) =>
                          updateReasoningRule(index, {
                            enabled: event.target.checked,
                          })
                        }
                        type="checkbox"
                      />
                      启用
                    </label>
                    <label className="field reasoning-transform-select">
                      <span>用户请求</span>
                      <select
                        className="input"
                        disabled={
                          !reasoningEffortTransformSettings ||
                          reasoningTransformBusy
                        }
                        onChange={(event) =>
                          updateReasoningRule(index, {
                            from: event.target.value,
                          })
                        }
                        value={rule.from}
                      >
                        {reasoningEffortOptions.map((option) => (
                          <option key={option} value={option}>
                            {formatReasoningEffort(option)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <span className="reasoning-transform-arrow">→</span>
                    <label className="field reasoning-transform-select">
                      <span>实际上游</span>
                      <select
                        className="input"
                        disabled={
                          !reasoningEffortTransformSettings ||
                          reasoningTransformBusy
                        }
                        onChange={(event) =>
                          updateReasoningRule(index, { to: event.target.value })
                        }
                        value={rule.to}
                      >
                        {reasoningEffortOptions.map((option) => (
                          <option key={option} value={option}>
                            {formatReasoningEffort(option)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      className="button secondary icon-button"
                      disabled={
                        !reasoningEffortTransformSettings ||
                        reasoningTransformBusy
                      }
                      onClick={() => removeReasoningRule(index)}
                      type="button"
                      title="删除规则"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
              <button
                className="button secondary"
                disabled={
                  !reasoningEffortTransformSettings || reasoningTransformBusy
                }
                onClick={addReasoningRule}
                type="button"
              >
                <Plus size={16} />
                添加规则
              </button>
              {reasoningTransformConflict.hasConflict ? (
                <div className="notice warning">
                  {reasoningTransformConflict.duplicateSources.length > 0
                    ? `冲突：${reasoningTransformConflict.duplicateSources
                        .map((item) => formatReasoningEffort(item))
                        .join("、")} 被重复映射。`
                    : null}
                  {reasoningTransformConflict.selfTransforms > 0
                    ? " 不允许原档位和目标档位相同。"
                    : null}
                </div>
              ) : null}
            </div>
            <div className="modal-footer">
              <button
                className="button secondary"
                onClick={() => setReasoningTransformModalOpen(false)}
                type="button"
              >
                取消
              </button>
              <button
                className="button"
                disabled={
                  !reasoningEffortTransformSettings ||
                  reasoningTransformBusy ||
                  detectReasoningRuleConflicts().hasConflict
                }
                type="submit"
              >
                <Save size={17} />
                保存
              </button>
            </div>
          </form>
        </ModalShell>
      ) : null}
      {banModalOpen ? (
        <ModalShell
          title="IP 封禁"
          description="只影响公开代理调用，后台登录和管理不受影响。"
          onClose={() => setBanModalOpen(false)}
          wide
        >
          <div className="modal-body ip-ban-modal-body">
            {banError ? (
              <div className="error compact-error">{banError}</div>
            ) : null}
            <form className="ip-ban-form" onSubmit={saveRule}>
              <label className="field">
                <span>IP</span>
                <input
                  className="input"
                  value={ipInput}
                  onChange={(event) => setIpInput(event.target.value)}
                  placeholder="例如 203.0.113.10"
                />
              </label>
              <label className="field">
                <span>返回方式</span>
                <select
                  className="input"
                  value={banMode}
                  onChange={(event) =>
                    setBanMode(event.target.value as IpBanMode)
                  }
                >
                  <option value="error">封禁报错</option>
                  <option value="notice">公告报错</option>
                </select>
              </label>
              <label className="field">
                <span>返回内容</span>
                <input
                  className="input"
                  value={banMessage}
                  onChange={(event) => setBanMessage(event.target.value)}
                  placeholder={defaultIpBanMessage}
                />
              </label>
              <label className="field">
                <span>备注</span>
                <input
                  className="input"
                  value={banReason}
                  onChange={(event) => setBanReason(event.target.value)}
                  placeholder="可选"
                />
              </label>
              <button
                className="button"
                disabled={Boolean(banBusyIp)}
                type="submit"
              >
                <Shield size={17} />
                {banBusyIp ? "处理中..." : "保存封禁"}
              </button>
            </form>
            <div className="ip-ban-rule-list">
              {ipBanRules.map((rule) => (
                <div className="ip-ban-rule" key={rule.ip}>
                  <div>
                    <strong>{rule.ip}</strong>
                    <p>{rule.reason || rule.message}</p>
                  </div>
                  <span
                    className={rule.mode === "notice" ? "pill ok" : "pill warn"}
                  >
                    {rule.mode === "notice" ? "公告报错" : "封禁报错"}
                  </span>
                  <button
                    className="button secondary"
                    disabled={banBusyIp === rule.ip}
                    onClick={() => void deleteRule(rule.ip)}
                    type="button"
                  >
                    解封
                  </button>
                </div>
              ))}
              {ipBanRules.length === 0 ? (
                <div className="empty-state compact">暂无封禁 IP</div>
              ) : null}
            </div>
          </div>
          <div className="modal-footer">
            <button
              className="button secondary"
              onClick={() => setBanModalOpen(false)}
              type="button"
            >
              关闭
            </button>
          </div>
        </ModalShell>
      ) : null}
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
      const path =
        endpoint === "responses" ? "/v1/responses" : "/v1/chat/completions";
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
      const streamedOutputText = parsed
        ? ""
        : extractOutputTextFromStreamText(text);
      const streamedUsage = parsed
        ? undefined
        : extractUsageFromStreamText(text);

      setResult({
        ok: response.ok,
        status: response.status,
        latencyMs,
        outputText: parsed ? extractOutputText(parsed) : streamedOutputText,
        body: parsed ? JSON.stringify(parsed, null, 2) : text,
        usage:
          parsed && typeof parsed === "object" && "usage" in parsed
            ? parsed.usage
            : streamedUsage,
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
            <button
              className="button secondary"
              onClick={createTestKey}
              type="button"
            >
              <KeyRound size={17} />
              创建测试 Key
            </button>
            <span className="pill">
              {apiBaseUrl}
              {endpoint === "responses"
                ? "/v1/responses"
                : "/v1/chat/completions"}
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
                  setEndpoint(
                    event.target.value === "responses" ? "responses" : "chat",
                  )
                }
              >
                <option value="responses">Responses API</option>
                <option value="chat">Chat Completions</option>
              </select>
            </label>
            <label className="field">
              <span>模型</span>
              {readyModelNames.length > 0 ? (
                <select
                  className="input"
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                >
                  {readyModelNames.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className="input"
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                />
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
              <pre className="code-block">
                {JSON.stringify(result.usage, null, 2)}
              </pre>
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

function AdminOverviewPanel({
  overview,
  serverStatus,
}: {
  overview: AdminOverview | null;
  serverStatus: ServerStatus | null;
}) {
  const latestKeyStats = serverStatus?.apiKeys.sample.slice(0, 4) ?? [];
  const latestChannelStats =
    serverStatus?.modelPool.channels
      .slice()
      .sort((a, b) => (b.inflightRequests ?? 0) - (a.inflightRequests ?? 0))
      .slice(0, 4) ?? [];

  return (
    <div className="grid admin-page">
      <div className="grid cols-3 metric-row">
        <Metric label="用户数" value={String(overview?.users ?? 0)} />
        <Metric label="总请求数" value={String(overview?.requests ?? 0)} />
        <Metric
          label="总 token"
          value={formatNumber(overview?.totalTokens ?? 0)}
        />
      </div>
      <div className="grid cols-3 metric-row">
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
      <section className="card">
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
      <section className="card">
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

function AdminAuthSettings({
  settings,
  onChanged,
  onError,
}: {
  settings: AuthSettings | null;
  onChanged: () => void;
  onError: (error: string | null) => void;
}) {
  const [newUserBonusUsd, setNewUserBonusUsd] = useState("0");
  const [emailCodeLoginEnabled, setEmailCodeLoginEnabled] = useState(true);
  const [emailCodeAutoRegisterEnabled, setEmailCodeAutoRegisterEnabled] =
    useState(true);
  const [emailCodeTtlSeconds, setEmailCodeTtlSeconds] = useState(600);
  const [emailCodeCooldownSeconds, setEmailCodeCooldownSeconds] = useState(60);
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState(465);
  const [smtpSecure, setSmtpSecure] = useState(true);
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPassword, setSmtpPassword] = useState("");
  const [smtpFrom, setSmtpFrom] = useState("");
  const [testEmail, setTestEmail] = useState("");
  const [testingEmail, setTestingEmail] = useState(false);
  const [testMessage, setTestMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!settings) {
      return;
    }

    setNewUserBonusUsd(settings.newUserBonusUsd);
    setEmailCodeLoginEnabled(settings.emailCodeLoginEnabled);
    setEmailCodeAutoRegisterEnabled(settings.emailCodeAutoRegisterEnabled);
    setEmailCodeTtlSeconds(settings.emailCodeTtlSeconds);
    setEmailCodeCooldownSeconds(settings.emailCodeCooldownSeconds);
    setSmtpHost(settings.smtpHost);
    setSmtpPort(settings.smtpPort);
    setSmtpSecure(settings.smtpSecure);
    setSmtpUser(settings.smtpUser);
    setSmtpPassword("");
    setSmtpFrom(settings.smtpFrom);
    setTestEmail(settings.smtpUser);
    setTestMessage(null);
    setSavedMessage(null);
  }, [settings]);

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onError(null);
    setSavedMessage(null);
    setSaving(true);

    try {
      await apiFetch("/admin/auth-settings", {
        method: "PUT",
        body: JSON.stringify({
          emailCodeLoginEnabled,
          emailCodeAutoRegisterEnabled,
          newUserBonusUsd,
          emailCodeTtlSeconds: Number(emailCodeTtlSeconds),
          emailCodeCooldownSeconds: Number(emailCodeCooldownSeconds),
          smtpHost,
          smtpPort: Number(smtpPort),
          smtpSecure,
          smtpUser,
          ...(smtpPassword.trim() ? { smtpPassword } : {}),
          smtpFrom,
        }),
      });
      setSmtpPassword("");
      setSavedMessage("登录设置已保存。");
      onChanged();
    } catch (saveError) {
      onError(errorToText(saveError));
    } finally {
      setSaving(false);
    }
  }

  async function sendTestEmail() {
    if (!testEmail.trim()) {
      onError("请填写测试收件邮箱。");
      return;
    }

    onError(null);
    setTestMessage(null);
    setTestingEmail(true);

    try {
      await apiFetch("/admin/auth-settings/test-email", {
        method: "POST",
        body: JSON.stringify({
          emailCodeLoginEnabled,
          emailCodeAutoRegisterEnabled,
          newUserBonusUsd,
          emailCodeTtlSeconds: Number(emailCodeTtlSeconds),
          emailCodeCooldownSeconds: Number(emailCodeCooldownSeconds),
          smtpHost,
          smtpPort: Number(smtpPort),
          smtpSecure,
          smtpUser,
          ...(smtpPassword.trim() ? { smtpPassword } : {}),
          smtpFrom,
          testEmail,
        }),
      });
      setTestMessage(`测试邮件已发送到 ${testEmail.trim()}。`);
    } catch (sendError) {
      onError(errorToText(sendError));
    } finally {
      setTestingEmail(false);
    }
  }

  if (!settings) {
    return <p className="muted">登录设置加载中...</p>;
  }

  const previewFrom = smtpFrom.trim() || "APIshare <no-reply@example.com>";
  const previewTo = smtpUser.trim() || "user@example.com";
  const previewCode = "482913";
  const previewTtlMinutes = Math.max(
    1,
    Math.ceil(Number(emailCodeTtlSeconds) / 60),
  );

  return (
    <form className="form" onSubmit={saveSettings}>
      <div className="grid cols-2 admin-settings-grid">
        <section className="card">
          <div className="section-head">
            <div>
              <h2 className="section-title">邮箱验证码</h2>
              <p className="section-subtitle">
                {emailCodeLoginEnabled
                  ? "用户账号使用邮箱验证码登录，自动注册可单独控制。"
                  : "邮箱验证码登录已关闭。"}
              </p>
            </div>
            <StatusPill
              status={emailCodeLoginEnabled ? "ACTIVE" : "DISABLED"}
            />
          </div>
          <div className="form">
            <div className="grid cols-2">
              <label className="check-row">
                <input
                  checked={emailCodeLoginEnabled}
                  onChange={(event) =>
                    setEmailCodeLoginEnabled(event.target.checked)
                  }
                  type="checkbox"
                />
                启用邮箱验证码登录
              </label>
              <label className="check-row">
                <input
                  checked={emailCodeAutoRegisterEnabled}
                  onChange={(event) =>
                    setEmailCodeAutoRegisterEnabled(event.target.checked)
                  }
                  type="checkbox"
                />
                允许新邮箱自动创建账号
              </label>
            </div>
            <div className="grid cols-2">
              <label className="field">
                <span>新用户赠送余额 USD</span>
                <input
                  className="input"
                  inputMode="decimal"
                  min="0"
                  onChange={(event) => setNewUserBonusUsd(event.target.value)}
                  step="0.00000001"
                  type="number"
                  value={newUserBonusUsd}
                />
              </label>
              <label className="field">
                <span>验证码有效期（秒）</span>
                <input
                  className="input"
                  max={3600}
                  min={60}
                  onChange={(event) =>
                    setEmailCodeTtlSeconds(Number(event.target.value))
                  }
                  type="number"
                  value={emailCodeTtlSeconds}
                />
              </label>
            </div>
            <label className="field">
              <span>发送冷却（秒）</span>
              <input
                className="input"
                max={600}
                min={10}
                onChange={(event) =>
                  setEmailCodeCooldownSeconds(Number(event.target.value))
                }
                type="number"
                value={emailCodeCooldownSeconds}
              />
            </label>
            <div className="info-list">
              <InfoLine
                label="登录方式"
                value={emailCodeLoginEnabled ? "邮箱验证码" : "已关闭"}
              />
              <InfoLine
                label="创建账号"
                value={
                  emailCodeAutoRegisterEnabled
                    ? "首次验证自动创建"
                    : "仅限已存在账号"
                }
              />
              <InfoLine label="赠送余额" value={`$${money(newUserBonusUsd)}`} />
            </div>
          </div>
        </section>

        <section className="card">
          <div className="section-head">
            <div>
              <h2 className="section-title">SMTP 发信</h2>
              <p className="section-subtitle">
                用于发送 APIshare 登录验证码邮件。
              </p>
            </div>
            <span className={settings.smtpConfigured ? "pill ok" : "pill warn"}>
              {settings.smtpConfigured ? "已配置" : "未配置"}
            </span>
          </div>
          <div className="form">
            <div className="grid cols-2">
              <label className="field">
                <span>SMTP Host</span>
                <input
                  className="input"
                  onChange={(event) => setSmtpHost(event.target.value)}
                  value={smtpHost}
                />
              </label>
              <label className="field">
                <span>端口</span>
                <input
                  className="input"
                  max={65535}
                  min={1}
                  onChange={(event) => setSmtpPort(Number(event.target.value))}
                  type="number"
                  value={smtpPort}
                />
              </label>
            </div>
            <label className="check-row">
              <input
                checked={smtpSecure}
                onChange={(event) => setSmtpSecure(event.target.checked)}
                type="checkbox"
              />
              使用 SSL/TLS
            </label>
            <label className="field">
              <span>发件人 From</span>
              <input
                className="input"
                onChange={(event) => setSmtpFrom(event.target.value)}
                placeholder="APIshare <no-reply@example.com>"
                value={smtpFrom}
              />
            </label>
            <div className="grid cols-2">
              <label className="field">
                <span>SMTP 用户名</span>
                <input
                  className="input"
                  onChange={(event) => setSmtpUser(event.target.value)}
                  value={smtpUser}
                />
              </label>
              <label className="field">
                <span>SMTP 密码</span>
                <input
                  className="input"
                  onChange={(event) => setSmtpPassword(event.target.value)}
                  placeholder={settings.smtpConfigured ? "留空则不修改" : ""}
                  type="password"
                  value={smtpPassword}
                />
              </label>
            </div>
            <div className="email-preview">
              <div className="email-preview-toolbar">
                <div>
                  <span className="eyebrow">邮件预览</span>
                  <strong>APIshare 登录验证码</strong>
                </div>
                <span>{smtpSecure ? "SSL/TLS" : "STARTTLS"}</span>
              </div>
              <div className="email-preview-meta">
                <span>From</span>
                <strong>{previewFrom}</strong>
                <span>To</span>
                <strong>{previewTo}</strong>
              </div>
              <div className="email-test-row">
                <label className="field">
                  <span>测试收件邮箱</span>
                  <input
                    className="input"
                    onChange={(event) => setTestEmail(event.target.value)}
                    placeholder="user@example.com"
                    type="email"
                    value={testEmail}
                  />
                </label>
                <button
                  className="button secondary"
                  disabled={testingEmail}
                  onClick={sendTestEmail}
                  type="button"
                >
                  <Send size={16} />
                  {testingEmail ? "发送中..." : "发送测试"}
                </button>
              </div>
              {testMessage ? (
                <div className="success compact-success">{testMessage}</div>
              ) : null}
              <div className="email-preview-body">
                <h3>APIshare 登录验证码</h3>
                <p>你的验证码是：</p>
                <div className="email-preview-code">{previewCode}</div>
                <p>
                  {previewTtlMinutes}{" "}
                  分钟内有效。若不是你本人操作，请忽略这封邮件。
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>

      {savedMessage ? <div className="success">{savedMessage}</div> : null}
      <div className="button-row">
        <button className="button" disabled={saving} type="submit">
          <Save size={17} />
          {saving ? "保存中..." : "保存登录设置"}
        </button>
      </div>
    </form>
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
  const [role, setRole] = useState<"USER" | "ADMIN">("USER");
  const [initialBalance, setInitialBalance] = useState("0");
  const [rateLimitPerMinute, setRateLimitPerMinute] = useState(0);
  const [concurrencyLimit, setConcurrencyLimit] = useState(0);
  const [charityEnabled, setCharityEnabled] = useState(false);
  const [charityDisplayName, setCharityDisplayName] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [targetUserId, setTargetUserId] = useState("");
  const [adjustAmount, setAdjustAmount] = useState("10");
  const [adjustRemark, setAdjustRemark] = useState("Admin balance adjustment");
  const [allowedModelsText, setAllowedModelsText] = useState("");
  const [userModal, setUserModal] = useState<
    "create" | "balance" | "models" | null
  >(null);
  const [keyModalUserId, setKeyModalUserId] = useState<string | null>(null);
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [editEmail, setEditEmail] = useState("");
  const [editRole, setEditRole] = useState<"USER" | "ADMIN">("USER");
  const [editStatus, setEditStatus] = useState<"ACTIVE" | "DISABLED">("ACTIVE");
  const [editAllowedModels, setEditAllowedModels] = useState("");
  const [editRateLimitPerMinute, setEditRateLimitPerMinute] = useState(0);
  const [editConcurrencyLimit, setEditConcurrencyLimit] = useState(0);
  const [editCharityEnabled, setEditCharityEnabled] = useState(false);
  const [editCharityDisplayName, setEditCharityDisplayName] = useState("");
  const selectedUserId = targetUserId || users[0]?.id || "";
  const selectedUser = users.find((item) => item.id === selectedUserId);
  const keyModalUser = users.find((item) => item.id === keyModalUserId) ?? null;
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
    setEditRole(item.role === "ADMIN" ? "ADMIN" : "USER");
    setEditStatus(item.status === "DISABLED" ? "DISABLED" : "ACTIVE");
    setEditAllowedModels((item.allowedModels ?? []).join("\n"));
    setEditRateLimitPerMinute(item.rateLimitPerMinute ?? 0);
    setEditConcurrencyLimit(item.concurrencyLimit ?? 0);
    setEditCharityEnabled(Boolean(item.charityEnabled));
    setEditCharityDisplayName(item.charityDisplayName ?? "");
  }

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onError(null);

    if (!email.trim()) {
      onError("请填写用户邮箱。");
      return;
    }

    try {
      await apiFetch("/admin/users", {
        method: "POST",
        body: JSON.stringify({
          email,
          role,
          initialBalance,
          allowedModels: [],
          rateLimitPerMinute: Number(rateLimitPerMinute),
          concurrencyLimit: Number(concurrencyLimit),
          charityEnabled,
          charityDisplayName,
        }),
      });
      setEmail("");
      setInitialBalance("0");
      setRateLimitPerMinute(0);
      setConcurrencyLimit(0);
      setCharityEnabled(false);
      setCharityDisplayName("");
      setUserModal(null);
      onChanged();
    } catch (createError) {
      onError(errorToText(createError));
    }
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
          role: editRole,
          status: editStatus,
          allowedModels: parseModelList(editAllowedModels),
          rateLimitPerMinute: Number(editRateLimitPerMinute),
          concurrencyLimit: Number(editConcurrencyLimit),
          charityEnabled: editCharityEnabled,
          charityDisplayName: editCharityDisplayName,
        }),
      });
      setEditingUser(null);
      onChanged();
    } catch (updateError) {
      onError(errorToText(updateError));
    }
  }

  async function deleteUser(item: AdminUser) {
    const confirmed = window.confirm(
      `确定删除用户「${item.email}」吗？这个操作会删除该用户的 API Key、钱包流水和调用记录。`,
    );

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
      if (keyModalUserId === item.id) {
        setKeyModalUserId(null);
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
            <p>
              创建账号、调整余额和设置模型权限都从弹窗完成。用户通过邮箱验证码进入。
            </p>
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
                  <th>公益</th>
                  <th>模型白名单</th>
                  <th>账号限制</th>
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
                    <td>
                      {item.charityEnabled ? (
                        <span className="pill ok">
                          {item.charityDisplayName || "已公开"}
                        </span>
                      ) : (
                        <span className="pill">未公开</span>
                      )}
                    </td>
                    <td>
                      {item.allowedModels.length > 0
                        ? item.allowedModels.join(", ")
                        : "不限"}
                    </td>
                    <td>
                      {formatRateLimit(item.rateLimitPerMinute)} · 并发{" "}
                      {formatConcurrencyLimit(item.concurrencyLimit)}
                    </td>
                    <td>{item._count.apiKeys}</td>
                    <td>{item._count.apiRequests}</td>
                    <td>{dateTime(item.createdAt)}</td>
                    <td>
                      <div className="button-row compact">
                        <button
                          className="button secondary"
                          onClick={() => beginEditUser(item)}
                          type="button"
                        >
                          编辑
                        </button>
                        <button
                          className="button secondary"
                          onClick={() => setKeyModalUserId(item.id)}
                          type="button"
                        >
                          Key 管理
                        </button>
                        <button
                          className="button secondary"
                          onClick={() => toggleUserStatus(item)}
                          type="button"
                        >
                          {item.status === "ACTIVE" ? "停用" : "启用"}
                        </button>
                        <button
                          className="button danger"
                          onClick={() => deleteUser(item)}
                          type="button"
                        >
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredUsers.length === 0 ? <EmptyRow colSpan={11} /> : null}
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
                    <button
                      className="button secondary"
                      onClick={() => beginEditUser(item)}
                      type="button"
                    >
                      编辑
                    </button>
                    <button
                      className="button secondary"
                      onClick={() => setKeyModalUserId(item.id)}
                      type="button"
                    >
                      Key 管理
                    </button>
                    <button
                      className="button secondary"
                      onClick={() => toggleUserStatus(item)}
                      type="button"
                    >
                      {item.status === "ACTIVE" ? "停用" : "启用"}
                    </button>
                    <button
                      className="button danger"
                      onClick={() => deleteUser(item)}
                      type="button"
                    >
                      删除
                    </button>
                  </>
                }
              >
                <MobileField label="余额">
                  ${money(item.wallet?.balance ?? "0")}
                </MobileField>
                <MobileField label="公益">
                  {item.charityEnabled
                    ? item.charityDisplayName || "已公开"
                    : "未公开"}
                </MobileField>
                <MobileField label="账号限流">
                  {formatRateLimit(item.rateLimitPerMinute)}
                </MobileField>
                <MobileField label="账号并发">
                  {formatConcurrencyLimit(item.concurrencyLimit)}
                </MobileField>
                <MobileField label="Key">{item._count.apiKeys}</MobileField>
                <MobileField label="公告 Key">
                  {
                    (item.apiKeys ?? []).filter((key) => key.noticeEnabled)
                      .length
                  }
                </MobileField>
                <MobileField label="请求">
                  {item._count.apiRequests}
                </MobileField>
                <MobileField label="模型白名单" wide>
                  {item.allowedModels.length > 0
                    ? item.allowedModels.join(", ")
                    : "不限"}
                </MobileField>
              </MobileRecord>
            ))}
            {filteredUsers.length === 0 ? (
              <MobileEmpty>暂无用户</MobileEmpty>
            ) : null}
          </div>
        </section>
      </div>

      {userModal === "create" ? (
        <ModalShell
          title="创建用户"
          description="给客户开账号和初始余额。"
          onClose={() => setUserModal(null)}
        >
          <form className="form" onSubmit={createUser}>
            <div className="modal-body">
              <label className="field">
                <span>邮箱</span>
                <input
                  className="input"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  type="email"
                />
              </label>
              <div className="grid cols-2">
                <label className="field">
                  <span>角色</span>
                  <select
                    className="input"
                    value={role}
                    onChange={(event) =>
                      setRole(event.target.value === "ADMIN" ? "ADMIN" : "USER")
                    }
                  >
                    <option value="USER">USER</option>
                    <option value="ADMIN">ADMIN</option>
                  </select>
                </label>
                <label className="field">
                  <span>初始余额</span>
                  <input
                    className="input"
                    value={initialBalance}
                    onChange={(event) => setInitialBalance(event.target.value)}
                  />
                </label>
              </div>
              <div className="grid cols-2">
                <label className="field">
                  <span>账号每分钟限流</span>
                  <input
                    className="input"
                    value={rateLimitPerMinute}
                    min={0}
                    max={10000}
                    onChange={(event) =>
                      setRateLimitPerMinute(Number(event.target.value))
                    }
                    type="number"
                  />
                </label>
                <label className="field">
                  <span>账号并发限制</span>
                  <input
                    className="input"
                    value={concurrencyLimit}
                    min={0}
                    max={10000}
                    onChange={(event) =>
                      setConcurrencyLimit(Number(event.target.value))
                    }
                    type="number"
                  />
                </label>
              </div>
              <label className="checkbox-row">
                <input
                  checked={charityEnabled}
                  onChange={(event) => setCharityEnabled(event.target.checked)}
                  type="checkbox"
                />
                <span>纳入公益公开统计</span>
              </label>
              <label className="field">
                <span>公益展示名称</span>
                <input
                  className="input"
                  value={charityDisplayName}
                  onChange={(event) =>
                    setCharityDisplayName(event.target.value)
                  }
                  placeholder="例如：公益项目名称"
                />
              </label>
            </div>
            <div className="modal-footer">
              <button
                className="button secondary"
                onClick={() => setUserModal(null)}
                type="button"
              >
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
        <ModalShell
          title="余额调整"
          description="正数加余额，负数扣余额。"
          onClose={() => setUserModal(null)}
        >
          <form className="form" onSubmit={adjustBalance}>
            <div className="modal-body">
              <label className="field">
                <span>用户</span>
                <select
                  className="input"
                  value={selectedUserId}
                  onChange={(event) => setTargetUserId(event.target.value)}
                >
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
                  <input
                    className="input"
                    value={adjustAmount}
                    onChange={(event) => setAdjustAmount(event.target.value)}
                  />
                </label>
                <label className="field">
                  <span>备注</span>
                  <input
                    className="input"
                    value={adjustRemark}
                    onChange={(event) => setAdjustRemark(event.target.value)}
                  />
                </label>
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="button secondary"
                onClick={() => setUserModal(null)}
                type="button"
              >
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
        <ModalShell
          title="模型白名单"
          description="留空表示该用户不限模型。"
          onClose={() => setUserModal(null)}
        >
          <form className="form" onSubmit={saveAllowedModels}>
            <div className="modal-body">
              <label className="field">
                <span>用户</span>
                <select
                  className="input"
                  value={selectedUserId}
                  onChange={(event) => setTargetUserId(event.target.value)}
                >
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
                        Array.from(
                          new Set([...parseModelList(current), modelName]),
                        ).join("\n"),
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
              <button
                className="button secondary"
                onClick={() => setUserModal(null)}
                type="button"
              >
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

      {keyModalUser ? (
        <AdminUserKeysModal
          user={keyModalUser}
          modelPools={modelPools}
          onChanged={onChanged}
          onClose={() => setKeyModalUserId(null)}
          onError={onError}
        />
      ) : null}

      {editingUser ? (
        <ModalShell
          title="编辑用户"
          description={editingUser.email}
          onClose={() => setEditingUser(null)}
          wide
        >
          <form className="form" onSubmit={saveEditingUser}>
            <div className="modal-body">
              <div className="grid cols-3">
                <label className="field">
                  <span>邮箱</span>
                  <input
                    className="input"
                    value={editEmail}
                    onChange={(event) => setEditEmail(event.target.value)}
                    type="email"
                  />
                </label>
                <label className="field">
                  <span>角色</span>
                  <select
                    className="input"
                    value={editRole}
                    onChange={(event) =>
                      setEditRole(
                        event.target.value === "ADMIN" ? "ADMIN" : "USER",
                      )
                    }
                  >
                    <option value="USER">USER</option>
                    <option value="ADMIN">ADMIN</option>
                  </select>
                </label>
                <label className="field">
                  <span>状态</span>
                  <select
                    className="input"
                    value={editStatus}
                    onChange={(event) =>
                      setEditStatus(
                        event.target.value === "DISABLED"
                          ? "DISABLED"
                          : "ACTIVE",
                      )
                    }
                  >
                    <option value="ACTIVE">ACTIVE</option>
                    <option value="DISABLED">DISABLED</option>
                  </select>
                </label>
              </div>
              <div className="grid cols-3">
                <label className="field">
                  <span>账号每分钟限流</span>
                  <input
                    className="input"
                    value={editRateLimitPerMinute}
                    min={0}
                    max={10000}
                    onChange={(event) =>
                      setEditRateLimitPerMinute(Number(event.target.value))
                    }
                    type="number"
                  />
                </label>
                <label className="field">
                  <span>账号并发限制</span>
                  <input
                    className="input"
                    value={editConcurrencyLimit}
                    min={0}
                    max={10000}
                    onChange={(event) =>
                      setEditConcurrencyLimit(Number(event.target.value))
                    }
                    type="number"
                  />
                </label>
                <label className="field">
                  <span>公益展示名称</span>
                  <input
                    className="input"
                    value={editCharityDisplayName}
                    onChange={(event) =>
                      setEditCharityDisplayName(event.target.value)
                    }
                    placeholder="公开页展示名称"
                  />
                </label>
              </div>
              <label className="checkbox-row">
                <input
                  checked={editCharityEnabled}
                  onChange={(event) =>
                    setEditCharityEnabled(event.target.checked)
                  }
                  type="checkbox"
                />
                <span>纳入公益公开统计</span>
              </label>
              <div className="grid cols-1">
                <label className="field">
                  <span>模型白名单</span>
                  <textarea
                    className="input textarea compact-textarea"
                    value={editAllowedModels}
                    onChange={(event) =>
                      setEditAllowedModels(event.target.value)
                    }
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
                        Array.from(
                          new Set([...parseModelList(current), modelName]),
                        ).join("\n"),
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
              <button
                className="button secondary"
                onClick={() => setEditingUser(null)}
                type="button"
              >
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

function AdminUserKeysModal({
  user,
  modelPools,
  onChanged,
  onError,
  onClose,
}: {
  user: AdminUser;
  modelPools: ModelPool[];
  onChanged: () => void;
  onError: (error: string | null) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("default");
  const [rateLimit, setRateLimit] = useState(60);
  const [totalLimitUsd, setTotalLimitUsd] = useState("");
  const [concurrencyLimit, setConcurrencyLimit] = useState(0);
  const [expiresAt, setExpiresAt] = useState("");
  const [allowedModelsText, setAllowedModelsText] = useState("");
  const [noticeEnabled, setNoticeEnabled] = useState(false);
  const [noticeText, setNoticeText] = useState("");
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [busyKeyId, setBusyKeyId] = useState<string | null>(null);
  const [selectedKeyIds, setSelectedKeyIds] = useState<string[]>([]);
  const [batchNoticeEnabled, setBatchNoticeEnabled] = useState(true);
  const [batchNoticeText, setBatchNoticeText] = useState("");
  const [batchBusy, setBatchBusy] = useState(false);
  const [editingKey, setEditingKey] = useState<ApiKey | null>(null);
  const [editName, setEditName] = useState("");
  const [editStatus, setEditStatus] = useState<
    "ACTIVE" | "DISABLED" | "REVOKED"
  >("ACTIVE");
  const [editRateLimit, setEditRateLimit] = useState(60);
  const [editTotalLimitUsd, setEditTotalLimitUsd] = useState("");
  const [editConcurrencyLimit, setEditConcurrencyLimit] = useState(0);
  const [editExpiresAt, setEditExpiresAt] = useState("");
  const [editAllowedModels, setEditAllowedModels] = useState("");
  const [editNoticeEnabled, setEditNoticeEnabled] = useState(false);
  const [editNoticeText, setEditNoticeText] = useState("");
  const modelSuggestions = Array.from(
    new Set(modelPools.map((pool) => pool.model)),
  ).sort();
  const userApiKeys = user.apiKeys ?? [];
  const selectedKeySet = new Set(selectedKeyIds);
  const allKeysSelected =
    userApiKeys.length > 0 && selectedKeyIds.length === userApiKeys.length;

  useEffect(() => {
    setCreatedSecret(null);
    setEditingKey(null);
    setSelectedKeyIds([]);
    setBatchNoticeEnabled(true);
    setBatchNoticeText("");
  }, [user.id]);

  async function createKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onError(null);

    if (noticeEnabled && !noticeText.trim()) {
      onError("开启公告时请填写公告内容。");
      return;
    }

    try {
      const result = await apiFetch<{ apiKey: ApiKey; secret: string }>(
        `/admin/users/${user.id}/api-keys`,
        {
          method: "POST",
          body: JSON.stringify({
            name,
            rateLimitPerMinute: Number(rateLimit),
            totalLimitUsd: normalizeOptionalNumberText(totalLimitUsd),
            concurrencyLimit: Number(concurrencyLimit),
            expiresAt: normalizeOptionalDateInput(expiresAt),
            allowedModels: parseModelList(allowedModelsText),
            noticeEnabled,
            noticeText: noticeText.trim() || null,
          }),
        },
      );
      setCreatedSecret(result.secret);
      setName("default");
      setAllowedModelsText("");
      setNoticeEnabled(false);
      setNoticeText("");
      onChanged();
    } catch (createError) {
      onError(errorToText(createError));
    }
  }

  function beginEditKey(key: ApiKey) {
    setEditingKey(key);
    setEditName(key.name);
    setEditStatus(normalizeApiKeyStatus(key.status));
    setEditRateLimit(key.rateLimitPerMinute);
    setEditTotalLimitUsd(limitValue(key.totalLimitUsd ?? key.dailyLimitUsd));
    setEditConcurrencyLimit(key.concurrencyLimit ?? 0);
    setEditExpiresAt(dateInputValue(key.expiresAt));
    setEditAllowedModels((key.allowedModels ?? []).join("\n"));
    setEditNoticeEnabled(Boolean(key.noticeEnabled));
    setEditNoticeText(key.noticeText ?? "");
  }

  async function saveEditingKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingKey) {
      return;
    }

    if (editNoticeEnabled && !editNoticeText.trim()) {
      onError("开启公告时请填写公告内容。");
      return;
    }

    onError(null);
    setBusyKeyId(editingKey.id);
    try {
      await apiFetch(`/admin/api-keys/${editingKey.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: editName,
          status: editStatus,
          rateLimitPerMinute: Number(editRateLimit),
          totalLimitUsd: normalizeOptionalNumberText(editTotalLimitUsd),
          concurrencyLimit: Number(editConcurrencyLimit),
          expiresAt: normalizeOptionalDateInput(editExpiresAt),
          allowedModels: parseModelList(editAllowedModels),
          noticeEnabled: editNoticeEnabled,
          noticeText: editNoticeText.trim() || null,
        }),
      });
      setEditingKey(null);
      onChanged();
    } catch (editError) {
      onError(errorToText(editError));
    } finally {
      setBusyKeyId(null);
    }
  }

  async function updateKeyStatus(
    key: ApiKey,
    status: "ACTIVE" | "DISABLED" | "REVOKED",
  ) {
    onError(null);
    setBusyKeyId(key.id);
    try {
      await apiFetch(`/admin/api-keys/${key.id}`, {
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

  function toggleKeySelection(keyId: string) {
    setSelectedKeyIds((current) =>
      current.includes(keyId)
        ? current.filter((id) => id !== keyId)
        : [...current, keyId],
    );
  }

  function toggleAllKeySelection() {
    setSelectedKeyIds(allKeysSelected ? [] : userApiKeys.map((key) => key.id));
  }

  async function batchUpdateKeys(changes: {
    status?: "ACTIVE" | "DISABLED" | "REVOKED";
    noticeEnabled?: boolean;
    noticeText?: string | null;
  }) {
    onError(null);

    if (selectedKeyIds.length === 0) {
      onError("请先选择要批量处理的 Key。");
      return;
    }

    if (changes.noticeEnabled && !changes.noticeText?.trim()) {
      onError("开启公告时请填写公告内容。");
      return;
    }

    setBatchBusy(true);
    try {
      await apiFetch(`/admin/users/${user.id}/api-keys/batch`, {
        method: "PATCH",
        body: JSON.stringify({
          keyIds: selectedKeyIds,
          ...changes,
          ...(changes.noticeText !== undefined
            ? { noticeText: changes.noticeText?.trim() || null }
            : {}),
        }),
      });
      setSelectedKeyIds([]);
      onChanged();
    } catch (batchError) {
      onError(errorToText(batchError));
    } finally {
      setBatchBusy(false);
    }
  }

  async function submitBatchNotice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await batchUpdateKeys({
      noticeEnabled: batchNoticeEnabled,
      noticeText: batchNoticeEnabled ? batchNoticeText : null,
    });
  }

  async function deleteKey(key: ApiKey) {
    const confirmed = window.confirm(
      `确定删除 ${user.email} 的 API Key「${key.name}」吗？删除后将无法继续使用。`,
    );

    if (!confirmed) {
      return;
    }

    onError(null);
    setBusyKeyId(key.id);
    try {
      await apiFetch(`/admin/api-keys/${key.id}`, {
        method: "DELETE",
      });
      if (editingKey?.id === key.id) {
        setEditingKey(null);
      }
      onChanged();
    } catch (deleteError) {
      onError(errorToText(deleteError));
    } finally {
      setBusyKeyId(null);
    }
  }

  return (
    <>
      <ModalShell
        title="用户 Key 管理"
        description={`${user.email} · ${userApiKeys.length} 个 Key`}
        onClose={onClose}
        wide
      >
        <div className="modal-body admin-key-modal">
          <form className="form" onSubmit={createKey}>
            <div className="grid cols-3">
              <label className="field">
                <span>名称</span>
                <input
                  className="input"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
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
              <label className="field">
                <span>总限额 USD</span>
                <input
                  className="input"
                  value={totalLimitUsd}
                  min={0}
                  onChange={(event) => setTotalLimitUsd(event.target.value)}
                  placeholder="留空不限"
                  step="0.00000001"
                  type="number"
                />
              </label>
            </div>
            <div className="grid cols-3">
              <label className="field">
                <span>并发限制</span>
                <input
                  className="input"
                  value={concurrencyLimit}
                  min={0}
                  max={10000}
                  onChange={(event) =>
                    setConcurrencyLimit(Number(event.target.value))
                  }
                  type="number"
                />
              </label>
              <label className="field">
                <span>过期时间</span>
                <input
                  className="input"
                  value={expiresAt}
                  onChange={(event) => setExpiresAt(event.target.value)}
                  type="datetime-local"
                />
              </label>
              <label className="inline-field">
                <input
                  checked={noticeEnabled}
                  onChange={(event) => setNoticeEnabled(event.target.checked)}
                  type="checkbox"
                />
                开启公告
              </label>
            </div>
            <div className="grid cols-2">
              <label className="field">
                <span>模型白名单</span>
                <textarea
                  className="input textarea compact-textarea"
                  value={allowedModelsText}
                  onChange={(event) => setAllowedModelsText(event.target.value)}
                  placeholder="留空不限；每行一个模型"
                />
              </label>
              <label className="field">
                <span>公告内容</span>
                <textarea
                  className="input textarea compact-textarea"
                  value={noticeText}
                  disabled={!noticeEnabled}
                  onChange={(event) => setNoticeText(event.target.value)}
                  placeholder="开启公告后，这个 Key 的调用会返回这里的文字"
                />
              </label>
            </div>
            <div className="chip-row">
              {modelSuggestions.slice(0, 8).map((modelName) => (
                <button
                  className="chip"
                  key={modelName}
                  onClick={() =>
                    setAllowedModelsText((current) =>
                      Array.from(
                        new Set([...parseModelList(current), modelName]),
                      ).join("\n"),
                    )
                  }
                  type="button"
                >
                  + {modelName}
                </button>
              ))}
            </div>
            <div className="button-row">
              <button className="button" type="submit">
                <Plus size={17} />
                创建 Key
              </button>
            </div>
          </form>

          {createdSecret ? (
            <div className="stack-top">
              <div className="notice">新 Key 已创建，完整密钥如下。</div>
              <div className="secret">{createdSecret}</div>
            </div>
          ) : null}

          <form className="batch-panel" onSubmit={submitBatchNotice}>
            <div className="batch-panel-head">
              <div>
                <strong>批量操作</strong>
                <p>
                  已选择 {selectedKeyIds.length} / {userApiKeys.length} 个 Key
                </p>
              </div>
              <div className="button-row compact">
                <button
                  className="button secondary"
                  onClick={toggleAllKeySelection}
                  type="button"
                >
                  {allKeysSelected ? "取消全选" : "全选"}
                </button>
                <button
                  className="button secondary"
                  disabled={batchBusy || selectedKeyIds.length === 0}
                  onClick={() => batchUpdateKeys({ status: "ACTIVE" })}
                  type="button"
                >
                  批量启用
                </button>
                <button
                  className="button secondary"
                  disabled={batchBusy || selectedKeyIds.length === 0}
                  onClick={() => batchUpdateKeys({ status: "DISABLED" })}
                  type="button"
                >
                  批量停用
                </button>
              </div>
            </div>
            <div className="grid cols-2">
              <label className="field">
                <span>公告动作</span>
                <select
                  className="input"
                  value={batchNoticeEnabled ? "on" : "off"}
                  onChange={(event) =>
                    setBatchNoticeEnabled(event.target.value === "on")
                  }
                >
                  <option value="on">开启并设置公告</option>
                  <option value="off">关闭公告</option>
                </select>
              </label>
              <label className="field">
                <span>公告内容</span>
                <input
                  className="input"
                  value={batchNoticeText}
                  disabled={!batchNoticeEnabled}
                  onChange={(event) => setBatchNoticeText(event.target.value)}
                  placeholder="批量开启公告时填写"
                />
              </label>
            </div>
            <div className="button-row">
              <button
                className="button"
                disabled={batchBusy || selectedKeyIds.length === 0}
                type="submit"
              >
                <Save size={17} />
                应用公告设置
              </button>
            </div>
          </form>

          <div className="table-wrap admin-key-table">
            <table>
              <thead>
                <tr>
                  <th>选择</th>
                  <th>名称</th>
                  <th>完整 Key</th>
                  <th>状态</th>
                  <th>限制</th>
                  <th>限额</th>
                  <th>公告</th>
                  <th>上次使用</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {userApiKeys.map((key) => (
                  <tr key={key.id}>
                    <td>
                      <input
                        checked={selectedKeySet.has(key.id)}
                        onChange={() => toggleKeySelection(key.id)}
                        type="checkbox"
                      />
                    </td>
                    <td>{key.name}</td>
                    <td>
                      <code className="inline-secret">
                        {key.keySecret ?? "未保存完整 Key"}
                      </code>
                    </td>
                    <td>
                      <StatusPill status={key.status} />
                    </td>
                    <td>
                      {key.rateLimitPerMinute}/min · 并发{" "}
                      {formatConcurrencyLimit(key.concurrencyLimit)}
                    </td>
                    <td>{formatApiKeyLimitSummary(key)}</td>
                    <td>
                      <span className={key.noticeEnabled ? "pill ok" : "pill"}>
                        {key.noticeEnabled ? "公告中" : "未开启"}
                      </span>
                      {key.noticeText ? (
                        <div className="notice-preview">{key.noticeText}</div>
                      ) : null}
                    </td>
                    <td>{key.lastUsedAt ? dateTime(key.lastUsedAt) : "-"}</td>
                    <td>
                      <div className="button-row compact">
                        <button
                          className="button secondary"
                          onClick={() => beginEditKey(key)}
                          type="button"
                        >
                          编辑
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
                            disabled={busyKeyId === key.id}
                            onClick={() => updateKeyStatus(key, "ACTIVE")}
                            type="button"
                          >
                            启用
                          </button>
                        )}
                        <button
                          className="button danger"
                          disabled={busyKeyId === key.id}
                          onClick={() => deleteKey(key)}
                          type="button"
                        >
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {userApiKeys.length === 0 ? <EmptyRow colSpan={9} /> : null}
              </tbody>
            </table>
          </div>

          <div className="mobile-record-list">
            {userApiKeys.map((key) => (
              <MobileRecord
                key={key.id}
                title={key.name}
                meta={dateTime(key.createdAt)}
                badges={
                  <>
                    <StatusPill status={key.status} />
                    <span className={key.noticeEnabled ? "pill ok" : "pill"}>
                      {key.noticeEnabled ? "公告中" : "未开启"}
                    </span>
                  </>
                }
                actions={
                  <>
                    <button
                      className="button secondary"
                      onClick={() => beginEditKey(key)}
                      type="button"
                    >
                      编辑
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
                        disabled={busyKeyId === key.id}
                        onClick={() => updateKeyStatus(key, "ACTIVE")}
                        type="button"
                      >
                        启用
                      </button>
                    )}
                    <button
                      className="button danger"
                      disabled={busyKeyId === key.id}
                      onClick={() => deleteKey(key)}
                      type="button"
                    >
                      删除
                    </button>
                  </>
                }
              >
                <MobileField label="选择">
                  <input
                    checked={selectedKeySet.has(key.id)}
                    onChange={() => toggleKeySelection(key.id)}
                    type="checkbox"
                  />
                </MobileField>
                <MobileField label="完整 Key" wide>
                  <code className="inline-secret">
                    {key.keySecret ?? "未保存完整 Key"}
                  </code>
                </MobileField>
                <MobileField label="限流">
                  {key.rateLimitPerMinute}/min
                </MobileField>
                <MobileField label="并发">
                  {formatConcurrencyLimit(key.concurrencyLimit)}
                </MobileField>
                <MobileField label="限额" wide>
                  {formatApiKeyLimitSummary(key)}
                </MobileField>
                <MobileField label="上次使用">
                  {key.lastUsedAt ? dateTime(key.lastUsedAt) : "-"}
                </MobileField>
                <MobileField label="公告" wide>
                  {key.noticeText ?? "未开启"}
                </MobileField>
              </MobileRecord>
            ))}
            {userApiKeys.length === 0 ? (
              <MobileEmpty>暂无 API Key</MobileEmpty>
            ) : null}
          </div>
        </div>
        <div className="modal-footer">
          <button className="button secondary" onClick={onClose} type="button">
            关闭
          </button>
        </div>
      </ModalShell>

      {editingKey ? (
        <ModalShell
          title="编辑用户 Key"
          description={editingKey.keySecret ?? editingKey.keyPrefix}
          onClose={() => setEditingKey(null)}
          wide
        >
          <form className="form" onSubmit={saveEditingKey}>
            <div className="modal-body">
              <div className="grid cols-3">
                <label className="field">
                  <span>名称</span>
                  <input
                    className="input"
                    value={editName}
                    onChange={(event) => setEditName(event.target.value)}
                  />
                </label>
                <label className="field">
                  <span>状态</span>
                  <select
                    className="input"
                    value={editStatus}
                    onChange={(event) =>
                      setEditStatus(normalizeApiKeyStatus(event.target.value))
                    }
                  >
                    <option value="ACTIVE">ACTIVE</option>
                    <option value="DISABLED">DISABLED</option>
                    <option value="REVOKED">REVOKED</option>
                  </select>
                </label>
                <label className="field">
                  <span>每分钟限流</span>
                  <input
                    className="input"
                    value={editRateLimit}
                    min={1}
                    max={10000}
                    onChange={(event) =>
                      setEditRateLimit(Number(event.target.value))
                    }
                    type="number"
                  />
                </label>
              </div>
              <div className="grid cols-3">
                <label className="field">
                  <span>总限额 USD</span>
                  <input
                    className="input"
                    value={editTotalLimitUsd}
                    min={0}
                    onChange={(event) =>
                      setEditTotalLimitUsd(event.target.value)
                    }
                    placeholder="留空不限"
                    step="0.00000001"
                    type="number"
                  />
                </label>
                <label className="field">
                  <span>并发限制</span>
                  <input
                    className="input"
                    value={editConcurrencyLimit}
                    min={0}
                    max={10000}
                    onChange={(event) =>
                      setEditConcurrencyLimit(Number(event.target.value))
                    }
                    type="number"
                  />
                </label>
                <label className="field">
                  <span>过期时间</span>
                  <input
                    className="input"
                    value={editExpiresAt}
                    onChange={(event) => setEditExpiresAt(event.target.value)}
                    type="datetime-local"
                  />
                </label>
              </div>
              <div className="grid cols-2">
                <label className="field">
                  <span>模型白名单</span>
                  <textarea
                    className="input textarea compact-textarea"
                    value={editAllowedModels}
                    onChange={(event) =>
                      setEditAllowedModels(event.target.value)
                    }
                    placeholder="留空不限；每行一个模型"
                  />
                </label>
                <label className="field">
                  <span>公告内容</span>
                  <textarea
                    className="input textarea compact-textarea"
                    value={editNoticeText}
                    disabled={!editNoticeEnabled}
                    onChange={(event) => setEditNoticeText(event.target.value)}
                    placeholder="开启公告后，这个 Key 的调用会返回这里的文字"
                  />
                </label>
              </div>
              <div className="button-row">
                <label className="inline-field">
                  <input
                    checked={editNoticeEnabled}
                    onChange={(event) =>
                      setEditNoticeEnabled(event.target.checked)
                    }
                    type="checkbox"
                  />
                  开启公告
                </label>
              </div>
              <div className="chip-row">
                {modelSuggestions.slice(0, 8).map((modelName) => (
                  <button
                    className="chip"
                    key={modelName}
                    onClick={() =>
                      setEditAllowedModels((current) =>
                        Array.from(
                          new Set([...parseModelList(current), modelName]),
                        ).join("\n"),
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
              <button
                className="button secondary"
                onClick={() => setEditingKey(null)}
                type="button"
              >
                取消
              </button>
              <button
                className="button"
                disabled={busyKeyId === editingKey.id}
                type="submit"
              >
                <Save size={17} />
                保存 Key
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
  const [penaltySeconds, setPenaltySeconds] = useState("60");
  const [channelSelections, setChannelSelections] = useState<
    Record<string, string>
  >({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const refreshTriggeredForKeyRef = useRef("");
  const lastDueRefreshAtRef = useRef(0);
  const existingModels = new Set(modelPools.map((pool) => pool.model));
  const pricedModels = Array.from(
    new Set(availableChannels.map((channel) => channel.model)),
  ).sort();
  const creatableModels = pricedModels.filter(
    (model) => !existingModels.has(model),
  );
  const creatableModelKey = creatableModels.join("|");
  const selectedCreateModel = createModel || creatableModels[0] || "";

  useEffect(() => {
    if (healthCheck) {
      setHealthIntervalSeconds(String(healthCheck.intervalSeconds));
      setPenaltySeconds(String(healthCheck.penaltySeconds));
    }
  }, [healthCheck?.intervalSeconds, healthCheck?.penaltySeconds]);

  useEffect(() => {
    if (
      creatableModels.length > 0 &&
      (!createModel || !creatableModels.includes(createModel))
    ) {
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
      .flatMap((pool) =>
        pool.channels.map((channel) => ({
          channel,
          autoHealthCheckEnabled: pool.autoHealthCheckEnabled,
        })),
      )
      .filter(
        ({ channel, autoHealthCheckEnabled }) =>
          nextCheckState(channel, healthCheck, nowMs, autoHealthCheckEnabled)
            .isWaitingForResult,
      )
      .map(
        ({ channel }) =>
          `${channel.id}:${channel.nextCheckAt ?? ""}:${channel.isChecking ? "checking" : "due"}`,
      )
      .sort();
    const dueKey = dueChannelIds.join("|");
    const canRetryDueRefresh = nowMs - lastDueRefreshAtRef.current > 2000;

    if (
      !dueKey ||
      (refreshTriggeredForKeyRef.current === dueKey && !canRetryDueRefresh)
    ) {
      return;
    }

    refreshTriggeredForKeyRef.current = dueKey;
    lastDueRefreshAtRef.current = nowMs;
    void onRefreshModelPools();
  }, [modelPools, healthCheck, nowMs, onRefreshModelPools]);

  function channelsForPool(pool: ModelPool) {
    const existingChannels = new Set(
      pool.channels.map((channel) => channel.upstreamProvider),
    );
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

  async function setPoolAutoHealthCheck(
    pool: ModelPool,
    autoHealthCheckEnabled: boolean,
  ) {
    onError(null);
    setBusyId(`${pool.id}:auto-health`);
    try {
      await apiFetch(`/admin/model-pools/${pool.id}`, {
        method: "PATCH",
        body: JSON.stringify({ autoHealthCheckEnabled }),
      });
      onChanged();
    } catch (updateError) {
      onError(errorToText(updateError));
    } finally {
      setBusyId(null);
    }
  }

  async function setPoolHealthCheckEndpoint(
    pool: ModelPool,
    healthCheckEndpoint: ModelPoolHealthCheckEndpoint,
  ) {
    onError(null);
    setBusyId(`${pool.id}:health-endpoint`);
    try {
      await apiFetch(`/admin/model-pools/${pool.id}`, {
        method: "PATCH",
        body: JSON.stringify({ healthCheckEndpoint }),
      });
      onChanged();
    } catch (updateError) {
      onError(errorToText(updateError));
    } finally {
      setBusyId(null);
    }
  }

  async function deletePool(pool: ModelPool) {
    const confirmed = window.confirm(
      `确定删除模型池「${pool.model}」吗？池内上游渠道会一起移除，但上游定价不会被删除。`,
    );

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
    const upstreamProvider =
      channelSelections[pool.id] ||
      selectableChannels[0]?.upstreamProvider ||
      "";

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

  async function setChannelStatus(
    channel: ModelPoolChannel,
    status: ModelPoolChannelStatus,
  ) {
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
    const confirmed = window.confirm(
      `确定从模型池移除「${channel.upstreamProvider}」吗？`,
    );

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
    const nextPenaltySeconds = Number(penaltySeconds);
    const minIntervalSeconds = healthCheck?.minIntervalSeconds ?? 5;
    const maxIntervalSeconds = healthCheck?.maxIntervalSeconds ?? 3600;
    const minPenaltySeconds = healthCheck?.minPenaltySeconds ?? 1;
    const maxPenaltySeconds = healthCheck?.maxPenaltySeconds ?? 86400;

    if (
      !Number.isInteger(intervalSeconds) ||
      intervalSeconds < minIntervalSeconds ||
      intervalSeconds > maxIntervalSeconds
    ) {
      onError(
        `自动检测间隔必须是 ${minIntervalSeconds}-${maxIntervalSeconds} 秒之间的整数。`,
      );
      return;
    }

    if (
      !Number.isInteger(nextPenaltySeconds) ||
      nextPenaltySeconds < minPenaltySeconds ||
      nextPenaltySeconds > maxPenaltySeconds
    ) {
      onError(
        `惩罚期必须是 ${minPenaltySeconds}-${maxPenaltySeconds} 秒之间的整数。`,
      );
      return;
    }

    setBusyId("health-check");
    try {
      await apiFetch("/admin/model-pools/health-check", {
        method: "PATCH",
        body: JSON.stringify({
          intervalSeconds,
          penaltySeconds: nextPenaltySeconds,
        }),
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
                onChange={(event) =>
                  setHealthIntervalSeconds(event.target.value)
                }
              />
              <span>秒</span>
            </label>
            <label className="inline-field">
              <span>惩罚期</span>
              <input
                className="input interval-input"
                max={healthCheck?.maxPenaltySeconds ?? 86400}
                min={healthCheck?.minPenaltySeconds ?? 1}
                step={1}
                type="number"
                value={penaltySeconds}
                onChange={(event) => setPenaltySeconds(event.target.value)}
              />
              <span>秒</span>
            </label>
            <button
              className="button secondary"
              disabled={busyId === "health-check"}
              type="submit"
            >
              <Save size={16} />
              保存检测
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
              {creatableModels.length === 0 ? (
                <option value="">暂无可添加模型</option>
              ) : null}
            </select>
            <button
              className="button"
              disabled={creatableModels.length === 0}
              type="submit"
            >
              <Plus size={17} />
              添加模型池
            </button>
          </form>
        </div>
      </section>

      <section className="card model-pool-list-card">
        <div className="section-head">
          <div>
            <h2 className="section-title">模型池列表</h2>
            <p className="section-subtitle">
              只有 ACTIVE 模型池且至少一个渠道 READY 时，用户侧才可调用。
            </p>
          </div>
          <StatusPill
            status={
              modelPools.some((pool) => pool.readyChannelCount > 0)
                ? "READY"
                : "UNAVAILABLE"
            }
          />
        </div>
        <div className="provider-stack model-pool-scroll">
          {modelPools.map((pool) => {
            const selectableChannels = channelsForPool(pool);
            const selectedChannel =
              channelSelections[pool.id] ||
              selectableChannels[0]?.upstreamProvider ||
              "";
            const callableChannels = pool.channels.filter(
              isCallableModelPoolChannel,
            );
            const unavailableChannels = pool.channels.filter(
              (channel) => !isCallableModelPoolChannel(channel),
            );

            return (
              <section className="provider-panel" key={pool.id}>
                <div className="provider-head">
                  <div>
                    <div className="provider-title">
                      <strong>{pool.model}</strong>
                      <StatusPill status={pool.status} />
                      <StatusPill
                        status={
                          pool.readyChannelCount > 0 ? "READY" : "UNAVAILABLE"
                        }
                      />
                      <StatusPill
                        status={
                          pool.autoHealthCheckEnabled
                            ? "AUTO_CHECK_ON"
                            : "AUTO_CHECK_OFF"
                        }
                      />
                    </div>
                    <p>
                      可调用 {pool.readyChannelCount} 个 · 已定价{" "}
                      {pool.pricedChannelCount} 个 · 已加入{" "}
                      {pool.channels.length} 个 · 检测接口{" "}
                      {modelPoolHealthCheckEndpointLabel(
                        pool.healthCheckEndpoint,
                      )}
                      · 惩罚期 {healthCheck?.penaltySeconds ?? 60} 秒 · 自动检测
                      {pool.autoHealthCheckEnabled ? "已开启" : "已关闭"}
                    </p>
                  </div>
                  <div className="button-row">
                    <label className="inline-field">
                      <span>检测接口</span>
                      <select
                        className="input compact-select"
                        disabled={busyId === `${pool.id}:health-endpoint`}
                        value={normalizeModelPoolHealthCheckEndpoint(
                          pool.healthCheckEndpoint,
                        )}
                        onChange={(event) =>
                          setPoolHealthCheckEndpoint(
                            pool,
                            event.target.value as ModelPoolHealthCheckEndpoint,
                          )
                        }
                      >
                        <option value="responses">Responses</option>
                        <option value="chat.completions">
                          Chat Completions
                        </option>
                      </select>
                    </label>
                    <button
                      className="button secondary"
                      disabled={busyId === `${pool.id}:auto-health`}
                      onClick={() =>
                        setPoolAutoHealthCheck(
                          pool,
                          !pool.autoHealthCheckEnabled,
                        )
                      }
                      type="button"
                    >
                      {pool.autoHealthCheckEnabled
                        ? "关闭自动检测"
                        : "开启自动检测"}
                    </button>
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
                      {pool.autoHealthCheckEnabled
                        ? `自动检测只使用 ${modelPoolHealthCheckEndpointLabel(pool.healthCheckEndpoint)}，每个渠道会检测该 Provider 下所有 ACTIVE Key；连续两次检测成功后恢复。`
                        : "这个模型池已关闭自动检测；手动检测和用户调用不受影响。"}
                    </p>
                  </div>
                  <div className="button-row">
                    <select
                      className="input compact-select"
                      disabled={selectableChannels.length === 0}
                      value={selectedChannel}
                      onChange={(event) =>
                        setChannelSelections((current) => ({
                          ...current,
                          [pool.id]: event.target.value,
                        }))
                      }
                    >
                      {selectableChannels.map((channel) => (
                        <option
                          key={channel.id}
                          value={channel.upstreamProvider}
                        >
                          {channel.upstreamProvider} ·{" "}
                          {channel.priceEnabled ? "价格启用" : "价格停用"} ·{" "}
                          {channel.providerStatus}· Key {channel.activeKeyCount}
                        </option>
                      ))}
                      {selectableChannels.length === 0 ? (
                        <option value="">暂无可添加渠道</option>
                      ) : null}
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

                <div className="pool-channel-groups">
                  <section className="pool-channel-section callable">
                    <div className="pool-channel-section-head">
                      <span>可调用池</span>
                      <strong>{callableChannels.length}</strong>
                    </div>
                    <div className="pool-channel-list">
                      {callableChannels.map((channel, index) => (
                        <ModelPoolChannelCard
                          key={channel.id}
                          channel={channel}
                          pool={pool}
                          rank={index + 1}
                          healthCheck={healthCheck}
                          nowMs={nowMs}
                          busyId={busyId}
                          onCheck={checkChannel}
                          onDelete={deleteChannel}
                          onSetStatus={setChannelStatus}
                        />
                      ))}
                      {callableChannels.length === 0 ? (
                        <div className="pool-channel-empty">暂无可调用渠道</div>
                      ) : null}
                    </div>
                  </section>
                  <section className="pool-channel-section unavailable">
                    <div className="pool-channel-section-head">
                      <span>不可调用池</span>
                      <strong>{unavailableChannels.length}</strong>
                    </div>
                    <div className="pool-channel-list">
                      {unavailableChannels.map((channel) => (
                        <ModelPoolChannelCard
                          key={channel.id}
                          channel={channel}
                          pool={pool}
                          healthCheck={healthCheck}
                          nowMs={nowMs}
                          busyId={busyId}
                          onCheck={checkChannel}
                          onDelete={deleteChannel}
                          onSetStatus={setChannelStatus}
                        />
                      ))}
                      {unavailableChannels.length === 0 ? (
                        <div className="pool-channel-empty">
                          暂无不可调用渠道
                        </div>
                      ) : null}
                    </div>
                  </section>
                </div>
                <div className="mobile-record-list model-pool-channel-records">
                  {pool.channels.map((channel) => (
                    <MobileRecord
                      key={channel.id}
                      title={channel.upstreamProvider}
                      meta={
                        channel.lastCheckedAt
                          ? `上次检测 ${dateTime(channel.lastCheckedAt)}`
                          : "尚未检测"
                      }
                      badges={
                        <StatusPill status={channel.effectiveStatus} strong />
                      }
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
                              onClick={() =>
                                setChannelStatus(channel, "FORCED_ACTIVE")
                              }
                              type="button"
                            >
                              人工可用
                            </button>
                          ) : null}
                          {channel.status === "ACTIVE" ||
                          channel.status === "FORCED_ACTIVE" ? (
                            <button
                              className="button secondary"
                              disabled={busyId === channel.id}
                              onClick={() =>
                                setChannelStatus(channel, "DISABLED")
                              }
                              type="button"
                            >
                              停用
                            </button>
                          ) : (
                            <button
                              className="button secondary"
                              disabled={busyId === channel.id}
                              onClick={() =>
                                setChannelStatus(channel, "ACTIVE")
                              }
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
                        <StatusPill
                          status={
                            channel.hasPrice && channel.priceEnabled
                              ? "ACTIVE"
                              : "DISABLED"
                          }
                        />
                      </MobileField>
                      <MobileField label="上游状态">
                        <StatusPill status={channel.providerStatus} />
                      </MobileField>
                      <MobileField label="自动检测">
                        <StatusPill
                          status={
                            pool.autoHealthCheckEnabled
                              ? "AUTO_CHECK_ON"
                              : "AUTO_CHECK_OFF"
                          }
                        />
                      </MobileField>
                      <MobileField label="检测接口">
                        {modelPoolHealthCheckEndpointLabel(
                          pool.healthCheckEndpoint,
                        )}
                      </MobileField>
                      <MobileField label="ACTIVE Key">
                        {channel.activeKeyCount}
                      </MobileField>
                      <MobileField label="惩罚">
                        {penaltyCountdown(channel, healthCheck, nowMs)}
                      </MobileField>
                      <MobileField label="恢复">
                        {channel.recoverySuccesses}/2
                      </MobileField>
                      <MobileField label="优先级">
                        {channel.priority}
                      </MobileField>
                      <MobileField label="连续失败">
                        {channel.consecutiveFailures}
                      </MobileField>
                      <MobileField label="下次检测">
                        {nextCheckCountdown(
                          channel,
                          healthCheck,
                          nowMs,
                          pool.autoHealthCheckEnabled,
                        )}
                      </MobileField>
                      <MobileField label="平均首字">
                        {seconds(channel.lastFirstTokenLatencyMs)}
                      </MobileField>
                      <MobileField label="平均总耗时">
                        {seconds(channel.lastLatencyMs)}
                      </MobileField>
                      <MobileField label="错误" wide>
                        {channel.lastError ?? "-"}
                      </MobileField>
                    </MobileRecord>
                  ))}
                  {pool.channels.length === 0 ? (
                    <MobileEmpty>暂无上游渠道</MobileEmpty>
                  ) : null}
                </div>
              </section>
            );
          })}
          {modelPools.length === 0 ? (
            <div className="empty-cell">暂无模型池</div>
          ) : null}
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
      const result = await apiFetch<{ codes: RedeemCode[] }>(
        "/admin/redeem-codes",
        {
          method: "POST",
          body: JSON.stringify(payload),
        },
      );
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
          <button
            className="button"
            onClick={() => setRedeemModalOpen(true)}
            type="button"
          >
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
              {generated
                .map((item) => `${item.code}  $${money(item.amount)}`)
                .join("\n")}
            </pre>
          </section>
        ) : null}

        <section className="card">
          <div className="section-head">
            <div>
              <h2 className="section-title">兑换码列表</h2>
              <p className="section-subtitle">
                按前缀、金额、状态或兑换用户查找。
              </p>
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
                      <button
                        className="button secondary"
                        onClick={() => toggleCode(code)}
                        type="button"
                      >
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
                meta={
                  code.expiresAt
                    ? `过期 ${dateTime(code.expiresAt)}`
                    : "永不过期"
                }
                badges={<StatusPill status={code.status} />}
                actions={
                  <button
                    className="button secondary"
                    onClick={() => toggleCode(code)}
                    type="button"
                  >
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
            {filteredCodes.length === 0 ? (
              <MobileEmpty>暂无兑换码</MobileEmpty>
            ) : null}
          </div>
        </section>
      </div>

      {redeemModalOpen ? (
        <ModalShell
          title="生成兑换码"
          description="选择额度和有效期，生成后明文只显示一次。"
          onClose={() => setRedeemModalOpen(false)}
          wide
        >
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
                  <input
                    className="input"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                  />
                </label>
                <label className="field">
                  <span>数量</span>
                  <input
                    className="input"
                    value={count}
                    min={1}
                    max={100}
                    onChange={(event) => setCount(Number(event.target.value))}
                    type="number"
                  />
                </label>
                <label className="field">
                  <span>可兑换次数</span>
                  <input
                    className="input"
                    value={maxRedemptions}
                    min={1}
                    max={1000}
                    onChange={(event) =>
                      setMaxRedemptions(Number(event.target.value))
                    }
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
                    <input
                      className="input"
                      value={expiresAt}
                      onChange={(event) => setExpiresAt(event.target.value)}
                      type="datetime-local"
                    />
                  </label>
                ) : null}
                <label className="field">
                  <span>备注</span>
                  <input
                    className="input"
                    value={remark}
                    onChange={(event) => setRemark(event.target.value)}
                  />
                </label>
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="button secondary"
                onClick={() => setRedeemModalOpen(false)}
                type="button"
              >
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
  unifiedPriceSettings,
  onChanged,
  onError,
}: {
  providers: UpstreamProvider[];
  modelPrices: ModelPrice[];
  unifiedPriceSettings: UnifiedPriceSetting[];
  onChanged: () => void;
  onError: (error: string | null) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("upstream-1");
  const [baseUrl, setBaseUrl] = useState("https://api.openai.com");
  const [apiKey, setApiKey] = useState("");
  const [priority, setPriority] = useState(100);
  const [timeoutSeconds, setTimeoutSeconds] = useState(180);
  const [busyProviderId, setBusyProviderId] = useState<string | null>(null);
  const [providerModalOpen, setProviderModalOpen] = useState(false);
  const [keyModalProvider, setKeyModalProvider] =
    useState<UpstreamProvider | null>(null);
  const [keyName, setKeyName] = useState("key-1");
  const [keySecret, setKeySecret] = useState("");
  const [keyPriority, setKeyPriority] = useState(100);
  const [busyKeyId, setBusyKeyId] = useState<string | null>(null);
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
  const [unifiedPriceModalOpen, setUnifiedPriceModalOpen] = useState(false);
  const [unifiedPriceDrafts, setUnifiedPriceDrafts] = useState<
    Record<string, UnifiedPriceDraft>
  >({});
  const [unifiedPriceSelections, setUnifiedPriceSelections] = useState<
    Record<string, boolean>
  >({});
  const [unifiedPriceSaving, setUnifiedPriceSaving] = useState(false);
  const unifiedPriceGroups = buildUnifiedPriceGroups(
    modelPrices,
    providers,
    unifiedPriceSettings,
  );
  const selectedUnifiedPriceCount = unifiedPriceGroups.filter(
    (group) => unifiedPriceSelections[group.model],
  ).length;
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
      await apiFetch(
        editingPriceId
          ? `/admin/model-prices/${editingPriceId}`
          : "/admin/model-prices",
        {
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
        },
      );
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
    const confirmed = window.confirm(
      `确定删除模型价格「${price.upstreamProvider} / ${price.model}」吗？`,
    );

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

  function openUnifiedPriceModal() {
    const nextDrafts = Object.fromEntries(
      unifiedPriceGroups.map((group) => [
        group.model,
        group.setting
          ? unifiedPriceDraftFromSetting(group.setting)
          : unifiedPriceDraftFromPrice(group.prices[0]),
      ]),
    );
    const nextSelections = Object.fromEntries(
      unifiedPriceGroups.map((group) => [
        group.model,
        group.setting?.enabled ?? false,
      ]),
    );
    setUnifiedPriceDrafts(nextDrafts);
    setUnifiedPriceSelections(nextSelections);
    setUnifiedPriceModalOpen(true);
  }

  function setUnifiedPriceSelected(modelId: string, selected: boolean) {
    setUnifiedPriceSelections((current) => ({
      ...current,
      [modelId]: selected,
    }));
  }

  function updateUnifiedPriceDraft(
    modelId: string,
    field: keyof UnifiedPriceDraft,
    value: string,
  ) {
    setUnifiedPriceDrafts((current) => {
      const group = unifiedPriceGroups.find((item) => item.model === modelId);
      const currentDraft =
        current[modelId] ??
        (group ? unifiedPriceDraftFromPrice(group.prices[0]) : undefined);

      if (!currentDraft) {
        return current;
      }

      return {
        ...current,
        [modelId]: {
          ...currentDraft,
          [field]: value,
        },
      };
    });
  }

  async function saveUnifiedPrices(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onError(null);

    const updates = unifiedPriceGroups.map((group) => ({
      model: group.model,
      enabled: unifiedPriceSelections[group.model] ?? false,
      ...(unifiedPriceDrafts[group.model] ??
        (group.setting
          ? unifiedPriceDraftFromSetting(group.setting)
          : unifiedPriceDraftFromPrice(group.prices[0]))),
    }));

    if (updates.length === 0) {
      onError("暂无可配置统一售价模式的模型。");
      return;
    }

    const invalidUpdate = updates.find(
      (update) =>
        update.enabled &&
        [
          update.customerInputPer1MTok,
          update.customerCachedInputPer1MTok,
          update.customerOutputPer1MTok,
          update.customerPriceMultiplier,
        ].some((value) => !isNonNegativeNumberText(value)),
    );

    if (invalidUpdate) {
      onError(
        `模型「${invalidUpdate.model}」的站点定价必须是大于等于 0 的数字。`,
      );
      return;
    }

    setUnifiedPriceSaving(true);
    try {
      await apiFetch("/admin/model-prices/unified", {
        method: "PUT",
        body: JSON.stringify({ updates }),
      });
      setUnifiedPriceModalOpen(false);
      onChanged();
    } catch (saveError) {
      onError(errorToText(saveError));
    } finally {
      setUnifiedPriceSaving(false);
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
      await apiFetch(
        editingId
          ? `/admin/upstream-providers/${editingId}`
          : "/admin/upstream-providers",
        {
          method: editingId ? "PATCH" : "POST",
          body: JSON.stringify(body),
        },
      );
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
    setTimeoutSeconds(180);
  }

  function openCreateProvider() {
    clearForm();
    setProviderModalOpen(true);
  }

  async function setProviderStatus(
    provider: UpstreamProvider,
    status: UpstreamProvider["status"],
  ) {
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

  function openCreateProviderKey(provider: UpstreamProvider) {
    setKeyModalProvider(provider);
    setKeyName(`key-${(provider.keys?.length ?? 0) + 1}`);
    setKeySecret("");
    setKeyPriority(100);
  }

  async function createProviderKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!keyModalProvider) {
      return;
    }

    onError(null);
    try {
      await apiFetch(`/admin/upstream-providers/${keyModalProvider.id}/keys`, {
        method: "POST",
        body: JSON.stringify({
          name: keyName,
          key: keySecret,
          priority: Number(keyPriority),
          status: "ACTIVE",
        }),
      });
      setKeyModalProvider(null);
      onChanged();
    } catch (createError) {
      onError(errorToText(createError));
    }
  }

  async function setProviderKeyStatus(
    key: UpstreamProviderKey,
    status: "ACTIVE" | "DISABLED",
  ) {
    onError(null);
    setBusyKeyId(key.id);
    try {
      await apiFetch(`/admin/upstream-provider-keys/${key.id}`, {
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

  async function deleteProviderKey(key: UpstreamProviderKey) {
    const confirmed = window.confirm(
      `确定删除上游 Key「${displayUpstreamProviderKeyName(key.name)}」吗？`,
    );
    if (!confirmed) {
      return;
    }

    onError(null);
    setBusyKeyId(key.id);
    try {
      await apiFetch(`/admin/upstream-provider-keys/${key.id}`, {
        method: "DELETE",
      });
      onChanged();
    } catch (deleteError) {
      onError(errorToText(deleteError));
    } finally {
      setBusyKeyId(null);
    }
  }

  function pricesForProvider(providerName: string) {
    return modelPrices.filter(
      (price) => price.upstreamProvider === providerName,
    );
  }

  function unifiedSettingForModel(modelId: string) {
    return unifiedPriceSettings.find((setting) => setting.model === modelId);
  }

  function effectiveCustomerDraft(price: ModelPrice) {
    const setting = unifiedSettingForModel(price.model);
    return setting?.enabled
      ? unifiedPriceDraftFromSetting(setting)
      : unifiedPriceDraftFromPrice(price);
  }

  function renderCustomerPrice(price: ModelPrice) {
    const setting = unifiedSettingForModel(price.model);
    const draft = effectiveCustomerDraft(price);

    return (
      <div className="price-cell-stack">
        {setting?.enabled ? <span className="pill ok">统一模式</span> : null}
        <span>
          x{draft.customerPriceMultiplier}:{" "}
          {priceTriplet(
            multiplied(
              draft.customerInputPer1MTok,
              draft.customerPriceMultiplier,
            ),
            multiplied(
              draft.customerCachedInputPer1MTok,
              draft.customerPriceMultiplier,
            ),
            multiplied(
              draft.customerOutputPer1MTok,
              draft.customerPriceMultiplier,
            ),
          )}
        </span>
        {setting?.enabled ? (
          <span className="muted-cell">
            普通价 x{price.customerPriceMultiplier}:{" "}
            {priceTriplet(
              multiplied(
                price.customerInputPer1MTok,
                price.customerPriceMultiplier,
              ),
              multiplied(
                price.customerCachedInputPer1MTok,
                price.customerPriceMultiplier,
              ),
              multiplied(
                price.customerOutputPer1MTok,
                price.customerPriceMultiplier,
              ),
            )}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <>
      <div className="grid admin-page">
        <section className="action-panel">
          <div>
            <h2>上游操作</h2>
            <p>新增和编辑上游配置都在弹窗里完成，密钥不会占用列表空间。</p>
          </div>
          <div className="button-row">
            <button
              className="button secondary"
              disabled={unifiedPriceGroups.length === 0}
              onClick={openUnifiedPriceModal}
              type="button"
            >
              <SlidersHorizontal size={17} />
              统一定价
            </button>
            <button
              className="button"
              onClick={openCreateProvider}
              type="button"
            >
              <Plus size={17} />
              添加上游
            </button>
          </div>
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
                        <span className="pill">
                          Key{" "}
                          {provider.keys?.filter(
                            (key) => key.status === "ACTIVE",
                          ).length ?? 0}
                          /{provider.keys?.length ?? 0}
                        </span>
                      </div>
                      <p>
                        优先级 {provider.priority} · 超时{" "}
                        {seconds(provider.timeoutMs)} · {provider.baseUrl}
                      </p>
                    </div>
                    <div className="button-row">
                      <button
                        className="button secondary"
                        onClick={() => editProvider(provider)}
                        type="button"
                      >
                        编辑渠道
                      </button>
                      <button
                        className="button secondary"
                        onClick={() => openCreateProviderKey(provider)}
                        type="button"
                      >
                        <Plus size={15} />
                        新增 Key
                      </button>
                      {provider.status === "ACTIVE" ? (
                        <button
                          className="button secondary"
                          disabled={busyProviderId === provider.id}
                          onClick={() =>
                            setProviderStatus(provider, "DISABLED")
                          }
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
                      <h3 className="section-title">Key 池</h3>
                      <p className="section-subtitle">
                        调度会在 ACTIVE Key 中按进行中请求数均摊。
                      </p>
                    </div>
                  </div>

                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>名称</th>
                          <th>前缀</th>
                          <th>状态</th>
                          <th>优先级</th>
                          <th>最近检测</th>
                          <th>最近使用</th>
                          <th>错误</th>
                          <th>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(provider.keys ?? []).map((key) => (
                          <tr key={key.id}>
                            <td>{displayUpstreamProviderKeyName(key.name)}</td>
                            <td>
                              <code>{key.keyPrefix || key.key}</code>
                            </td>
                            <td>
                              <StatusPill status={key.status} />
                            </td>
                            <td>{key.priority}</td>
                            <td>
                              {key.lastCheckedAt
                                ? `${dateTime(key.lastCheckedAt)} · ${key.lastCheckStatus ?? "-"}`
                                : "-"}
                            </td>
                            <td>
                              {key.lastUsedAt ? dateTime(key.lastUsedAt) : "-"}
                            </td>
                            <td className="muted-cell">
                              {key.lastError ?? "-"}
                            </td>
                            <td>
                              <div className="button-row compact">
                                {key.status === "ACTIVE" ? (
                                  <button
                                    className="button secondary"
                                    disabled={busyKeyId === key.id}
                                    onClick={() =>
                                      setProviderKeyStatus(key, "DISABLED")
                                    }
                                    type="button"
                                  >
                                    停用
                                  </button>
                                ) : (
                                  <button
                                    className="button"
                                    disabled={busyKeyId === key.id}
                                    onClick={() =>
                                      setProviderKeyStatus(key, "ACTIVE")
                                    }
                                    type="button"
                                  >
                                    启用
                                  </button>
                                )}
                                <button
                                  className="button danger"
                                  disabled={busyKeyId === key.id}
                                  onClick={() => deleteProviderKey(key)}
                                  type="button"
                                >
                                  删除
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                        {(provider.keys ?? []).length === 0 ? (
                          <EmptyRow colSpan={8} />
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                  <div className="mobile-record-list">
                    {(provider.keys ?? []).map((key) => (
                      <MobileRecord
                        key={key.id}
                        title={displayUpstreamProviderKeyName(key.name)}
                        meta={key.keyPrefix || key.key}
                        badges={<StatusPill status={key.status} />}
                        actions={
                          <>
                            {key.status === "ACTIVE" ? (
                              <button
                                className="button secondary"
                                disabled={busyKeyId === key.id}
                                onClick={() =>
                                  setProviderKeyStatus(key, "DISABLED")
                                }
                                type="button"
                              >
                                停用
                              </button>
                            ) : (
                              <button
                                className="button"
                                disabled={busyKeyId === key.id}
                                onClick={() =>
                                  setProviderKeyStatus(key, "ACTIVE")
                                }
                                type="button"
                              >
                                启用
                              </button>
                            )}
                            <button
                              className="button danger"
                              disabled={busyKeyId === key.id}
                              onClick={() => deleteProviderKey(key)}
                              type="button"
                            >
                              删除
                            </button>
                          </>
                        }
                      >
                        <MobileField label="优先级">{key.priority}</MobileField>
                        <MobileField label="最近检测" wide>
                          {key.lastCheckedAt
                            ? `${dateTime(key.lastCheckedAt)} · ${key.lastCheckStatus ?? "-"}`
                            : "-"}
                        </MobileField>
                        <MobileField label="最近使用">
                          {key.lastUsedAt ? dateTime(key.lastUsedAt) : "-"}
                        </MobileField>
                        <MobileField label="错误" wide>
                          {key.lastError ?? "-"}
                        </MobileField>
                      </MobileRecord>
                    ))}
                    {(provider.keys ?? []).length === 0 ? (
                      <MobileEmpty>暂无 Key</MobileEmpty>
                    ) : null}
                  </div>

                  <div className="section-head compact-head">
                    <div>
                      <h3 className="section-title">模型价格</h3>
                      <p className="section-subtitle">
                        输入 / 缓存输入 / 输出分别计价，再乘以倍率。
                      </p>
                    </div>
                    <button
                      className="button secondary"
                      onClick={() => openCreatePrice(provider.name)}
                      type="button"
                    >
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
                              <StatusPill
                                status={price.enabled ? "ACTIVE" : "DISABLED"}
                              />
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
                                multiplied(
                                  price.upstreamInputPer1MTok,
                                  price.upstreamPriceMultiplier,
                                ),
                                multiplied(
                                  price.upstreamCachedInputPer1MTok,
                                  price.upstreamPriceMultiplier,
                                ),
                                multiplied(
                                  price.upstreamOutputPer1MTok,
                                  price.upstreamPriceMultiplier,
                                ),
                              )}
                            </td>
                            <td>{renderCustomerPrice(price)}</td>
                            <td>
                              <div className="button-row compact">
                                <button
                                  className="button secondary"
                                  onClick={() => editPrice(price)}
                                  type="button"
                                >
                                  编辑
                                </button>
                                <button
                                  className="button secondary"
                                  onClick={() => togglePrice(price)}
                                  type="button"
                                >
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
                        {providerPrices.length === 0 ? (
                          <EmptyRow colSpan={6} />
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                  <div className="mobile-record-list">
                    {providerPrices.map((price) => (
                      <MobileRecord
                        key={price.id}
                        title={price.model}
                        meta={`上游渠道：${price.upstreamProvider}`}
                        badges={
                          <StatusPill
                            status={price.enabled ? "ACTIVE" : "DISABLED"}
                          />
                        }
                        actions={
                          <>
                            <button
                              className="button secondary"
                              onClick={() => editPrice(price)}
                              type="button"
                            >
                              编辑
                            </button>
                            <button
                              className="button secondary"
                              onClick={() => togglePrice(price)}
                              type="button"
                            >
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
                            multiplied(
                              price.upstreamInputPer1MTok,
                              price.upstreamPriceMultiplier,
                            ),
                            multiplied(
                              price.upstreamCachedInputPer1MTok,
                              price.upstreamPriceMultiplier,
                            ),
                            multiplied(
                              price.upstreamOutputPer1MTok,
                              price.upstreamPriceMultiplier,
                            ),
                          )}
                        </MobileField>
                        <MobileField label="站点售价" wide>
                          {renderCustomerPrice(price)}
                        </MobileField>
                      </MobileRecord>
                    ))}
                    {providerPrices.length === 0 ? (
                      <MobileEmpty>暂无模型价格</MobileEmpty>
                    ) : null}
                  </div>
                </section>
              );
            })}
            {providers.length === 0 ? (
              <div className="empty-cell">暂无上游渠道</div>
            ) : null}
          </div>
        </section>
      </div>

      {providerModalOpen ? (
        <ModalShell
          title={editingId ? "编辑上游" : "添加上游"}
          description={
            editingId ? "编辑上游渠道配置。" : "添加新的上游供应商和首个 Key。"
          }
          onClose={() => {
            clearForm();
            setProviderModalOpen(false);
          }}
        >
          <form className="form" onSubmit={saveProvider}>
            <div className="modal-body">
              <label className="field">
                <span>名称</span>
                <input
                  className="input"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <label className="field">
                <span>Base URL</span>
                <input
                  className="input"
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                />
              </label>
              {!editingId ? (
                <label className="field">
                  <span>首个 Key</span>
                  <input
                    className="input"
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    placeholder="sk-..."
                    type="password"
                  />
                </label>
              ) : null}
              <div className="grid cols-2">
                <label className="field">
                  <span>优先级</span>
                  <input
                    className="input"
                    value={priority}
                    onChange={(event) =>
                      setPriority(Number(event.target.value))
                    }
                    type="number"
                  />
                </label>
                <label className="field">
                  <span>超时（秒）</span>
                  <input
                    className="input"
                    max={600}
                    min={5}
                    onChange={(event) =>
                      setTimeoutSeconds(Number(event.target.value))
                    }
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

      {keyModalProvider ? (
        <ModalShell
          title="新增上游 Key"
          description={keyModalProvider.name}
          onClose={() => setKeyModalProvider(null)}
        >
          <form className="form" onSubmit={createProviderKey}>
            <div className="modal-body">
              <label className="field">
                <span>名称</span>
                <input
                  className="input"
                  value={keyName}
                  onChange={(event) => setKeyName(event.target.value)}
                />
              </label>
              <label className="field">
                <span>上游 API Key</span>
                <input
                  className="input"
                  value={keySecret}
                  onChange={(event) => setKeySecret(event.target.value)}
                  placeholder="sk-..."
                  type="password"
                />
              </label>
              <label className="field">
                <span>优先级</span>
                <input
                  className="input"
                  min={1}
                  max={10000}
                  value={keyPriority}
                  onChange={(event) =>
                    setKeyPriority(Number(event.target.value))
                  }
                  type="number"
                />
              </label>
            </div>
            <div className="modal-footer">
              <button
                className="button secondary"
                onClick={() => setKeyModalProvider(null)}
                type="button"
              >
                取消
              </button>
              <button className="button" type="submit">
                <KeyRound size={17} />
                添加 Key
              </button>
            </div>
          </form>
        </ModalShell>
      ) : null}

      {unifiedPriceModalOpen ? (
        <ModalShell
          title="统一售价模式"
          description="按模型 ID 开关统一站点售价；原有每条上游站点售价会保留，关闭后立即回到普通模式。"
          onClose={() => setUnifiedPriceModalOpen(false)}
          wide
        >
          <form className="form" onSubmit={saveUnifiedPrices}>
            <div className="modal-body">
              <div className="notice">
                这里只保存模型级统一售价模式，不会覆盖各上游价格行里的原始站点售价，也不会修改任何上游成本价格。
              </div>
              <div className="unified-price-list">
                {unifiedPriceGroups.map((group) => {
                  const draft =
                    unifiedPriceDrafts[group.model] ??
                    unifiedPriceDraftFromPrice(group.prices[0]);
                  const selected = unifiedPriceSelections[group.model] ?? false;
                  const effectiveInput = multiplied(
                    draft.customerInputPer1MTok,
                    draft.customerPriceMultiplier,
                  );
                  const effectiveCachedInput = multiplied(
                    draft.customerCachedInputPer1MTok,
                    draft.customerPriceMultiplier,
                  );
                  const effectiveOutput = multiplied(
                    draft.customerOutputPer1MTok,
                    draft.customerPriceMultiplier,
                  );

                  return (
                    <section className="unified-price-row" key={group.model}>
                      <div className="unified-price-row-head">
                        <div>
                          <strong>{group.model}</strong>
                          <p>
                            {group.providerNames.length} 个上游 ·{" "}
                            {group.prices.length} 条价格 ·{" "}
                            {group.providerNames.join(" / ")}
                          </p>
                        </div>
                        <div className="unified-price-row-actions">
                          <label className="check-row unified-price-switch">
                            <input
                              checked={selected}
                              onChange={(event) =>
                                setUnifiedPriceSelected(
                                  group.model,
                                  event.target.checked,
                                )
                              }
                              type="checkbox"
                            />
                            统一模式
                          </label>
                          <span className={selected ? "pill ok" : "pill"}>
                            {selected ? "已开启" : "普通模式"}
                          </span>
                          <span
                            className={
                              group.hasDifferentOriginalCustomerPricing
                                ? "pill warn"
                                : "pill ok"
                            }
                          >
                            {group.hasDifferentOriginalCustomerPricing
                              ? "原价有差异"
                              : "原价一致"}
                          </span>
                        </div>
                      </div>
                      <div className="grid cols-2 unified-price-fields">
                        <label className="field">
                          <span>站点输入 / 1M</span>
                          <input
                            className="input"
                            disabled={!selected}
                            inputMode="decimal"
                            value={draft.customerInputPer1MTok}
                            onChange={(event) =>
                              updateUnifiedPriceDraft(
                                group.model,
                                "customerInputPer1MTok",
                                event.target.value,
                              )
                            }
                          />
                        </label>
                        <label className="field">
                          <span>站点缓存 / 1M</span>
                          <input
                            className="input"
                            disabled={!selected}
                            inputMode="decimal"
                            value={draft.customerCachedInputPer1MTok}
                            onChange={(event) =>
                              updateUnifiedPriceDraft(
                                group.model,
                                "customerCachedInputPer1MTok",
                                event.target.value,
                              )
                            }
                          />
                        </label>
                        <label className="field">
                          <span>站点输出 / 1M</span>
                          <input
                            className="input"
                            disabled={!selected}
                            inputMode="decimal"
                            value={draft.customerOutputPer1MTok}
                            onChange={(event) =>
                              updateUnifiedPriceDraft(
                                group.model,
                                "customerOutputPer1MTok",
                                event.target.value,
                              )
                            }
                          />
                        </label>
                        <label className="field">
                          <span>站点倍率</span>
                          <input
                            className="input"
                            disabled={!selected}
                            inputMode="decimal"
                            value={draft.customerPriceMultiplier}
                            onChange={(event) =>
                              updateUnifiedPriceDraft(
                                group.model,
                                "customerPriceMultiplier",
                                event.target.value,
                              )
                            }
                          />
                        </label>
                      </div>
                      <div className="unified-price-preview">
                        <InfoLine
                          label="统一模式输入"
                          value={`$${money(effectiveInput)}`}
                        />
                        <InfoLine
                          label="统一模式缓存"
                          value={`$${money(effectiveCachedInput)}`}
                        />
                        <InfoLine
                          label="统一模式输出"
                          value={`$${money(effectiveOutput)}`}
                        />
                      </div>
                    </section>
                  );
                })}
                {unifiedPriceGroups.length === 0 ? (
                  <MobileEmpty>暂无已有模型价格</MobileEmpty>
                ) : null}
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="button secondary"
                onClick={() => setUnifiedPriceModalOpen(false)}
                type="button"
              >
                取消
              </button>
              <button
                className="button"
                disabled={unifiedPriceSaving || unifiedPriceGroups.length === 0}
                type="submit"
              >
                <Save size={17} />
                保存模式（开启 {selectedUnifiedPriceCount} 个）
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
              {unifiedSettingForModel(model)?.enabled ? (
                <div className="notice">
                  当前模型已开启统一模式；这里编辑的是普通模式下该上游自己的站点售价，关闭统一模式后会继续使用。
                </div>
              ) : null}
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
                      <select
                        className="input"
                        value={priceProvider}
                        onChange={(event) =>
                          setPriceProvider(event.target.value)
                        }
                      >
                        {providers.map((provider) => (
                          <option key={provider.id} value={provider.name}>
                            {provider.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span>模型</span>
                      <input
                        className="input"
                        value={model}
                        onChange={(event) => setModel(event.target.value)}
                      />
                    </label>
                  </div>
                  <section className="subpanel">
                    <h3>上游价格</h3>
                    <div className="grid cols-2">
                      <label className="field">
                        <span>输入原价 / 1M</span>
                        <input
                          className="input"
                          value={upstreamInput}
                          onChange={(event) =>
                            setUpstreamInput(event.target.value)
                          }
                        />
                      </label>
                      <label className="field">
                        <span>缓存原价 / 1M</span>
                        <input
                          className="input"
                          value={upstreamCachedInput}
                          onChange={(event) =>
                            setUpstreamCachedInput(event.target.value)
                          }
                        />
                      </label>
                      <label className="field">
                        <span>输出原价 / 1M</span>
                        <input
                          className="input"
                          value={upstreamOutput}
                          onChange={(event) =>
                            setUpstreamOutput(event.target.value)
                          }
                        />
                      </label>
                      <label className="field">
                        <span>上游倍率</span>
                        <input
                          className="input"
                          value={upstreamMultiplier}
                          onChange={(event) =>
                            setUpstreamMultiplier(event.target.value)
                          }
                        />
                      </label>
                    </div>
                  </section>
                  <section className="subpanel">
                    <h3>站点售价</h3>
                    <div className="grid cols-2">
                      <label className="field">
                        <span>输入原价 / 1M</span>
                        <input
                          className="input"
                          value={customerInput}
                          onChange={(event) =>
                            setCustomerInput(event.target.value)
                          }
                        />
                      </label>
                      <label className="field">
                        <span>缓存原价 / 1M</span>
                        <input
                          className="input"
                          value={customerCachedInput}
                          onChange={(event) =>
                            setCustomerCachedInput(event.target.value)
                          }
                        />
                      </label>
                      <label className="field">
                        <span>输出原价 / 1M</span>
                        <input
                          className="input"
                          value={customerOutput}
                          onChange={(event) =>
                            setCustomerOutput(event.target.value)
                          }
                        />
                      </label>
                      <label className="field">
                        <span>站点倍率</span>
                        <input
                          className="input"
                          value={customerMultiplier}
                          onChange={(event) =>
                            setCustomerMultiplier(event.target.value)
                          }
                        />
                      </label>
                    </div>
                  </section>
                </div>
                <aside className="pricing-preview">
                  <h3>实时预览 / 1M token</h3>
                  <InfoLine
                    label="上游输入"
                    value={`$${money(upstreamEffective.input)}`}
                  />
                  <InfoLine
                    label="上游缓存"
                    value={`$${money(upstreamEffective.cached)}`}
                  />
                  <InfoLine
                    label="上游输出"
                    value={`$${money(upstreamEffective.output)}`}
                  />
                  <InfoLine
                    label="站点输入"
                    value={`$${money(customerEffective.input)}`}
                  />
                  <InfoLine
                    label="站点缓存"
                    value={`$${money(customerEffective.cached)}`}
                  />
                  <InfoLine
                    label="站点输出"
                    value={`$${money(customerEffective.output)}`}
                  />
                </aside>
              </div>
              <label className="check-row">
                <input
                  checked={enabled}
                  onChange={(event) => setEnabled(event.target.checked)}
                  type="checkbox"
                />
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

function StatusTile({
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

function StatusPill({
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

function ChannelFact({
  label,
  children,
  wide = false,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "channel-fact wide" : "channel-fact"}>
      <span>{label}</span>
      <strong>{children}</strong>
    </div>
  );
}

type ChannelStatusTone = "ok" | "warn" | "neutral";

function compactStatusTone(status: string): ChannelStatusTone {
  if (
    status === "ACTIVE" ||
    status === "READY" ||
    status === "FORCED_ACTIVE" ||
    status === "FORCED_READY" ||
    status === "HEALTHY" ||
    status === "SUCCESS" ||
    status === "AUTO_CHECK_ON"
  ) {
    return "ok";
  }
  if (
    status === "DISABLED" ||
    status === "UNAVAILABLE" ||
    status === "PENALIZED" ||
    status === "FAILED" ||
    status === "UNHEALTHY" ||
    status === "MISSING" ||
    status === "REVOKED" ||
    status === "AUTO_CHECK_OFF"
  ) {
    return "warn";
  }
  return "neutral";
}

function compactStatusLabel(status: string) {
  const labelMap: Record<string, string> = {
    ACTIVE: "启用",
    AUTO_CHECK_OFF: "自检关",
    AUTO_CHECK_ON: "自检开",
    DISABLED: "停用",
    FAILED: "失败",
    FORCED_ACTIVE: "人工",
    FORCED_READY: "人工",
    HEALTHY: "正常",
    MISSING: "缺失",
    PENALIZED: "惩罚",
    READY: "可调",
    REVOKED: "失效",
    SUCCESS: "成功",
    UNAVAILABLE: "不可用",
    UNHEALTHY: "异常",
    WAITING: "等待",
  };
  return labelMap[status] ?? status;
}

function channelScheduleLabel(status: string) {
  if (status === "ACTIVE") {
    return "自动";
  }
  return compactStatusLabel(status);
}

function ModelPoolChannelCard({
  channel,
  pool,
  rank,
  healthCheck,
  nowMs,
  busyId,
  onCheck,
  onDelete,
  onSetStatus,
}: {
  channel: ModelPoolChannel;
  pool: ModelPool;
  rank?: number;
  healthCheck: ModelPoolHealthCheck | null;
  nowMs: number;
  busyId: string | null;
  onCheck: (channel: ModelPoolChannel) => void;
  onDelete: (channel: ModelPoolChannel) => void;
  onSetStatus: (
    channel: ModelPoolChannel,
    status: ModelPoolChannelStatus,
  ) => void;
}) {
  const priceStatus =
    channel.hasPrice && channel.priceEnabled
      ? "ACTIVE"
      : channel.hasPrice
        ? "DISABLED"
        : "MISSING";
  const errorText = formatChannelError(channel.lastError);
  const statusItems = [
    {
      label: "通道",
      value: compactStatusLabel(channel.effectiveStatus),
      tone: compactStatusTone(channel.effectiveStatus),
    },
    {
      label: "调度",
      value: channelScheduleLabel(channel.status),
      tone: compactStatusTone(channel.status),
    },
    {
      label: "定价",
      value:
        priceStatus === "ACTIVE"
          ? "已开"
          : priceStatus === "DISABLED"
            ? "停用"
            : "缺失",
      tone: compactStatusTone(priceStatus),
    },
    {
      label: "上游",
      value: compactStatusLabel(channel.providerStatus),
      tone: compactStatusTone(channel.providerStatus),
    },
  ];

  return (
    <article
      className={`${rank ? "pool-channel-row callable" : "pool-channel-row unavailable"}${errorText ? " has-error" : ""}`}
    >
      <div className="pool-channel-main">
        <div className="pool-channel-top">
          <div className="pool-channel-title">
            {rank ? <span className="rank-pill">#{rank}</span> : null}
            <strong>{channel.upstreamProvider}</strong>
          </div>
          <span
            className={`channel-state-dot ${compactStatusTone(channel.effectiveStatus)}`}
            aria-hidden="true"
          />
        </div>
        <div className="pool-channel-status-strip" aria-label="渠道状态">
          {statusItems.map((item) => (
            <span className={`compact-status ${item.tone}`} key={item.label}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </span>
          ))}
        </div>
      </div>
      <div className="pool-channel-facts">
        <ChannelFact label="Key/惩罚">
          {channel.activeKeyCount} /{" "}
          {penaltyCountdown(channel, healthCheck, nowMs)}
        </ChannelFact>
        <ChannelFact label="失败/恢复">
          {channel.consecutiveFailures} / {channel.recoverySuccesses}/2
        </ChannelFact>
        <ChannelFact label="首字/总耗">
          {seconds(channel.lastFirstTokenLatencyMs)} /{" "}
          {seconds(channel.lastLatencyMs)}
        </ChannelFact>
        <ChannelFact label="优先/下次">
          {channel.priority} /{" "}
          {nextCheckCountdown(
            channel,
            healthCheck,
            nowMs,
            pool.autoHealthCheckEnabled,
          )}
        </ChannelFact>
      </div>
      {errorText ? (
        <div className="pool-channel-error">
          <span>错误</span>
          <strong>{errorText}</strong>
        </div>
      ) : null}
      <div className="pool-channel-actions">
        <button
          className="button secondary"
          disabled={busyId === channel.id}
          onClick={() => onCheck(channel)}
          type="button"
        >
          检测
        </button>
        {channel.status !== "FORCED_ACTIVE" ? (
          <button
            className="button"
            disabled={busyId === channel.id}
            onClick={() => onSetStatus(channel, "FORCED_ACTIVE")}
            type="button"
          >
            人工可用
          </button>
        ) : null}
        {channel.status === "ACTIVE" || channel.status === "FORCED_ACTIVE" ? (
          <button
            className="button secondary"
            disabled={busyId === channel.id}
            onClick={() => onSetStatus(channel, "DISABLED")}
            type="button"
          >
            停用
          </button>
        ) : (
          <button
            className="button secondary"
            disabled={busyId === channel.id}
            onClick={() => onSetStatus(channel, "ACTIVE")}
            type="button"
          >
            自动可用
          </button>
        )}
        <button
          className="button danger"
          disabled={busyId === channel.id}
          onClick={() => onDelete(channel)}
          type="button"
        >
          <Trash2 size={15} />
          删除
        </button>
      </div>
    </article>
  );
}

function formatChannelError(value?: string | null) {
  const text = value?.trim();
  if (!text) {
    return "";
  }

  const normalized = text.toLowerCase();
  if (
    (normalized.includes("operation") && normalized.includes("abort")) ||
    normalized.includes("aborterror") ||
    normalized.includes("aborted")
  ) {
    return "健康检测超时：上游没有及时返回，网关已主动中止这次检测。";
  }

  return text;
}

function isCallableModelPoolChannel(channel: ModelPoolChannel) {
  return (
    channel.effectiveStatus === "READY" ||
    channel.effectiveStatus === "FORCED_READY"
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

function limitValue(value: string | number | null | undefined) {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return "";
  }

  return String(value);
}

function normalizeOptionalNumberText(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed;
}

function normalizeOptionalDateInput(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return new Date(trimmed).toISOString();
}

function dateInputValue(value: string | null | undefined) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function formatTotalLimit(value: string | number | null | undefined) {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return "不限";
  }

  return `$${money(numeric)}`;
}

function formatApiKeyLimitSummary(key: ApiKey) {
  const limit = key.totalLimitUsd ?? key.dailyLimitUsd;
  const numericLimit = Number(limit ?? 0);

  if (!Number.isFinite(numericLimit) || numericLimit <= 0) {
    return "不限";
  }

  const used = key.totalUsedUsd ?? "0";
  const remaining =
    key.totalRemainingUsd ??
    String(Math.max(0, numericLimit - Number(used || 0)));

  return `剩余 $${money(remaining)} / 总 $${money(numericLimit)} / 已用 $${money(used)}`;
}

function normalizeApiKeyStatus(
  status: string,
): "ACTIVE" | "DISABLED" | "REVOKED" {
  if (status === "DISABLED" || status === "REVOKED") {
    return status;
  }

  return "ACTIVE";
}

function formatRequestApiKey(apiKey: ApiRequest["apiKey"]) {
  if (!apiKey) {
    return "-";
  }

  return `${apiKey.name} (${apiKey.keyPrefix})`;
}

function formatRequestTraceCode(request: Pick<ApiRequest, "id" | "traceCode">) {
  return (
    request.traceCode?.trim() || `REQ-${request.id.slice(-8).toUpperCase()}`
  );
}

function formatTraceLike(traceCode: string | null | undefined, id: string) {
  return traceCode?.trim() || `REQ-${id.slice(-8).toUpperCase()}`;
}

function formatRequestUpstreamKey(
  upstreamKey: ApiRequest["upstreamProviderKey"],
) {
  if (!upstreamKey) {
    return "-";
  }

  return `${displayUpstreamProviderKeyName(upstreamKey.name)} (${upstreamKey.keyPrefix})`;
}

function formatFingerprintRoute(value?: string | null) {
  if (!value) {
    return "-";
  }

  const channel = value.match(/channel:([^:]+)/)?.[1];
  const key = value.match(/key:([^:]+)/)?.[1];
  if (channel && key) {
    return `${shortId(channel)} / ${shortId(key)}`;
  }
  if (channel) {
    return shortId(channel);
  }
  if (key) {
    return shortId(key);
  }
  return shortId(value);
}

function shortId(value: string) {
  return value.length > 12
    ? `${value.slice(0, 8)}...${value.slice(-4)}`
    : value;
}

function displayUpstreamProviderKeyName(name: string) {
  return name === "默认 Key" ? "key-1" : name;
}

function formatConcurrencyLimit(value: number | null | undefined) {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return "不限";
  }

  return `${numeric}`;
}

function formatRateLimit(value: number | null | undefined) {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return "不限";
  }

  return `${numeric}/min`;
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
  autoHealthCheckEnabled = true,
) {
  if (channel.status === "PENALIZED") {
    const remaining = penaltyRemainingSeconds(channel, healthCheck, nowMs);
    return {
      secondsUntilNext: remaining === 0 ? 0 : null,
      isWaitingForResult: remaining === 0,
    };
  }

  if (channel.isChecking) {
    return { secondsUntilNext: 0, isWaitingForResult: true };
  }

  if (!autoHealthCheckEnabled || !healthCheck) {
    return { secondsUntilNext: null, isWaitingForResult: false };
  }

  const secondsUntilNext = channel.nextCheckRemainingSeconds;

  if (secondsUntilNext === null || secondsUntilNext === undefined) {
    return { secondsUntilNext: null, isWaitingForResult: false };
  }

  const elapsedSeconds = Math.max(
    0,
    Math.floor((nowMs - healthCheck.receivedAtMs) / 1000),
  );
  const displayedSecondsUntilNext = Math.max(
    0,
    secondsUntilNext - elapsedSeconds,
  );

  return {
    secondsUntilNext: displayedSecondsUntilNext,
    isWaitingForResult: displayedSecondsUntilNext === 0,
  };
}

function nextCheckCountdown(
  channel: ModelPoolChannel,
  healthCheck: ModelPoolHealthCheck | null,
  nowMs: number,
  autoHealthCheckEnabled = true,
) {
  if (channel.status === "PENALIZED") {
    const remaining = penaltyRemainingSeconds(channel, healthCheck, nowMs);
    return remaining === 0
      ? "恢复检测"
      : remaining === null
        ? "-"
        : `${remaining}s 后恢复`;
  }

  if (!autoHealthCheckEnabled && !channel.isChecking) {
    return "未参与";
  }

  const state = nextCheckState(
    channel,
    healthCheck,
    nowMs,
    autoHealthCheckEnabled,
  );

  if (state.secondsUntilNext === null) {
    return "-";
  }

  return state.isWaitingForResult ? "检测中" : `${state.secondsUntilNext}s`;
}

function penaltyRemainingSeconds(
  channel: ModelPoolChannel,
  healthCheck: ModelPoolHealthCheck | null,
  nowMs: number,
) {
  const fromServer = channel.penaltyRemainingSeconds;
  if (fromServer !== null && fromServer !== undefined) {
    const elapsedSeconds = healthCheck
      ? Math.max(0, Math.floor((nowMs - healthCheck.receivedAtMs) / 1000))
      : 0;
    return Math.max(0, fromServer - elapsedSeconds);
  }

  if (!channel.penalizedUntil) {
    return null;
  }

  return Math.max(
    0,
    Math.ceil((new Date(channel.penalizedUntil).getTime() - nowMs) / 1000),
  );
}

function penaltyCountdown(
  channel: ModelPoolChannel,
  healthCheck: ModelPoolHealthCheck | null,
  nowMs: number,
) {
  if (channel.status !== "PENALIZED") {
    return "-";
  }

  const remaining = penaltyRemainingSeconds(channel, healthCheck, nowMs);
  return remaining === null ? "-" : remaining === 0 ? "到期" : `${remaining}s`;
}

function normalizeModelPoolHealthCheckEndpoint(
  value: string | null | undefined,
): ModelPoolHealthCheckEndpoint {
  return value === "chat.completions" ? "chat.completions" : "responses";
}

function modelPoolHealthCheckEndpointLabel(value: string | null | undefined) {
  return normalizeModelPoolHealthCheckEndpoint(value) === "chat.completions"
    ? "Chat Completions"
    : "Responses";
}

function buildUnifiedPriceGroups(
  modelPrices: ModelPrice[],
  providers: UpstreamProvider[],
  settings: UnifiedPriceSetting[],
): UnifiedPriceGroup[] {
  const providerNames = new Set(providers.map((provider) => provider.name));
  const settingsByModel = new Map(
    settings.map((setting) => [setting.model, setting]),
  );
  const groups = new Map<string, ModelPrice[]>();

  for (const price of modelPrices) {
    if (!providerNames.has(price.upstreamProvider)) {
      continue;
    }

    groups.set(price.model, [...(groups.get(price.model) ?? []), price]);
  }

  return Array.from(groups.entries())
    .map(([model, prices]) => ({
      model,
      prices,
      providerNames: Array.from(
        new Set(prices.map((price) => price.upstreamProvider)),
      ).sort((left, right) => left.localeCompare(right)),
      setting: settingsByModel.get(model),
      hasDifferentOriginalCustomerPricing: prices.some(
        (price) => !sameUnifiedPriceDraft(price, prices[0]),
      ),
    }))
    .sort((left, right) => left.model.localeCompare(right.model));
}

function unifiedPriceDraftFromSetting(
  setting: UnifiedPriceSetting,
): UnifiedPriceDraft {
  return {
    customerInputPer1MTok: setting.customerInputPer1MTok,
    customerCachedInputPer1MTok: setting.customerCachedInputPer1MTok,
    customerOutputPer1MTok: setting.customerOutputPer1MTok,
    customerPriceMultiplier: setting.customerPriceMultiplier,
  };
}

function unifiedPriceDraftFromPrice(
  price: ModelPrice | undefined,
): UnifiedPriceDraft {
  return {
    customerInputPer1MTok: price?.customerInputPer1MTok ?? "0",
    customerCachedInputPer1MTok: price?.customerCachedInputPer1MTok ?? "0",
    customerOutputPer1MTok: price?.customerOutputPer1MTok ?? "0",
    customerPriceMultiplier: price?.customerPriceMultiplier ?? "1",
  };
}

function sameUnifiedPriceDraft(
  left: ModelPrice,
  right: ModelPrice | undefined,
) {
  if (!right) {
    return true;
  }

  return (
    Number(left.customerInputPer1MTok) ===
      Number(right.customerInputPer1MTok) &&
    Number(left.customerCachedInputPer1MTok) ===
      Number(right.customerCachedInputPer1MTok) &&
    Number(left.customerOutputPer1MTok) ===
      Number(right.customerOutputPer1MTok) &&
    Number(left.customerPriceMultiplier) ===
      Number(right.customerPriceMultiplier)
  );
}

function isNonNegativeNumberText(value: string) {
  if (!value.trim()) {
    return false;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0;
}

function multiplied(value: string | number, multiplier: string | number) {
  return Number(value) * Number(multiplier);
}

function priceTriplet(
  input: string | number,
  cached: string | number,
  output: string | number,
) {
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

const defaultIpBanMessage = "当前 IP 已被网关封禁，请联系管理员。";

function normalizeIpForCompare(value: string | null | undefined) {
  const text = String(value ?? "").trim();
  if (!text || text.includes("/")) {
    return "";
  }

  if (text.includes(":")) {
    try {
      const hostname = new URL(`http://[${text}]/`).hostname;
      return hostname.startsWith("[") && hostname.endsWith("]")
        ? hostname.slice(1, -1).toLowerCase()
        : hostname.toLowerCase();
    } catch {
      return "";
    }
  }

  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(text)) {
    const parts = text.split(".").map(Number);
    if (
      parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ) {
      return parts.join(".");
    }
  }

  return "";
}

function toQueryString(
  filters: RequestFilters,
  extras: Record<string, string | undefined> = {},
) {
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
  for (const key of advancedRequestFilterKeys) {
    const value = filters[key].trim();
    if (value) {
      params.set(key, value);
    }
  }
  for (const [key, value] of Object.entries(extras)) {
    if (value !== undefined && value !== "") {
      params.set(key, value);
    }
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

function mergeRequests(current: ApiRequest[], incoming: ApiRequest[]) {
  const seen = new Set(current.map((item) => item.id));
  const next = [...current];

  for (const item of incoming) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      next.push(item);
    }
  }

  return next;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function dateTime(value: string) {
  return new Date(value).toLocaleString();
}

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "-";
  }

  return `${Math.max(0, value).toFixed(value >= 10 ? 1 : 2)}%`;
}

function formatLoadAverage(values: number[] | null | undefined) {
  if (!values || values.length === 0) {
    return "-";
  }

  return values
    .slice(0, 3)
    .map((value) => value.toFixed(2))
    .join(" / ");
}

function formatBytes(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "-";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let current = value;
  let unit = 0;

  while (current >= 1024 && unit < units.length - 1) {
    current /= 1024;
    unit += 1;
  }

  return `${current.toFixed(current >= 100 ? 0 : current >= 10 ? 1 : 2)} ${units[unit]}`;
}

function formatDuration(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "-";
  }

  const secondsValue = Math.max(0, Math.floor(value));
  const days = Math.floor(secondsValue / 86400);
  const hours = Math.floor((secondsValue % 86400) / 3600);
  const minutes = Math.floor((secondsValue % 3600) / 60);
  const secondsRest = secondsValue % 60;

  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${secondsRest}s`;
  }
  return `${secondsRest}s`;
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
        item &&
        typeof item === "object" &&
        "content" in item &&
        Array.isArray(item.content)
          ? item.content
          : [],
      )
      .map((part) =>
        part &&
        typeof part === "object" &&
        "text" in part &&
        typeof part.text === "string"
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

      if ("delta" in parsed && typeof parsed.delta === "string") {
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
