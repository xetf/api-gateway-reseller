"use client";

import {
  Activity,
  BarChart3,
  Copy,
  CreditCard,
  FileSearch,
  GitBranch,
  HeartHandshake,
  KeyRound,
  ListChecks,
  LogIn,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Send,
  Server,
  Settings,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  CircleStop,
  Ticket,
  Trash2,
  Users,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
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
import { adminDownload } from "./admin/_components/admin-api";
import { confirmAdminAction } from "./admin/_components/admin-confirm";
import {
  dateTime,
  formatBytes,
  formatDuration,
  formatLoadAverage,
  formatNumber,
  formatPercent,
  money,
  parseModelList,
  seconds,
  splitList,
} from "./admin/_components/admin-format";
import {
  AdminDataTable,
  AdminPanel,
  Metric,
  MobileEmpty,
  ModalShell,
  MobileField,
  MobileRecord,
  StatusPill,
  StatusTile,
} from "./admin/_components/admin-ui";
import { Requests, type ApiRequest } from "./admin/_components/request-list";
import { AdminAuthSettings } from "./admin/_features/admin-auth-settings";
import { AdminGatewayNotices } from "./admin/_features/admin-gateway-notices";
import { AdminAuditLogs, AdminLoginLogs } from "./admin/_features/admin-logs";
import { AdminModelPoolsPage } from "./admin/_features/admin-model-pools";
import { AdminOverviewPage } from "./admin/_features/admin-overview";
import { AdminRedeemCodes } from "./admin/_features/admin-redeem-codes";
import { AdminReports } from "./admin/_features/admin-reports";
import { AdminRequestsPage } from "./admin/_features/admin-requests";
import { AdminRiskCenter } from "./admin/_features/admin-risk-center";
import { AdminRouting } from "./admin/_features/admin-routing";
import { AdminUpstreamsPage } from "./admin/_features/admin-upstreams";
import { AdminUsersPage } from "./admin/_features/admin-users";
import {
  CallTester,
  type AvailableModel,
} from "./front/_components/call-tester";
import { Keys, type ApiKey } from "./front/_components/frontend-keys";
import {
  WalletView,
  type Transaction,
  type Wallet,
} from "./front/_components/frontend-wallet";
import { z } from "zod";

type User = {
  id: string;
  email: string;
  role: "USER" | "ADMIN";
  status: "ACTIVE" | "DISABLED" | string;
  statusReason?: string | null;
  allowedModels: string[];
  rateLimitPerMinute: number;
  concurrencyLimit: number;
  tierId?: string | null;
  tenantId?: string | null;
  packageTemplateId?: string | null;
  tier?: AccessTierRef | null;
  tenant?: Tenant | null;
  packageTemplate?: PackageTemplate | null;
  billingAccount?: BillingAccount | null;
  charityEnabled?: boolean;
  charityDisplayName?: string | null;
  charityKey?: string | null;
  charityIpRateLimitEnabled?: boolean;
  charityIpRateLimitPerMinute?: number;
  createdAt?: string;
  wallet?: Wallet | null;
};

type Tenant = {
  id: string;
  name: string;
  code: string;
  status: "ACTIVE" | "DISABLED" | string;
  reseller: boolean;
  contactEmail?: string | null;
  remark?: string | null;
  createdAt?: string;
  updatedAt?: string;
  _count?: { users: number };
};

type PackageTemplate = {
  id: string;
  name: string;
  code: string;
  status: "ACTIVE" | "DISABLED" | string;
  tierId?: string | null;
  tier?: AccessTierRef | null;
  allowedModels: string[];
  rateLimitPerMinute: number;
  concurrencyLimit: number;
  initialBalanceUsd: string;
  monthlyCreditLimitUsd: string;
  remark?: string | null;
  createdAt?: string;
  updatedAt?: string;
  _count?: { users: number };
};

type BillingAccount = {
  id: string;
  userId: string;
  status: "ACTIVE" | "SUSPENDED" | string;
  monthlySettlement: boolean;
  creditLimitUsd: string;
  creditUsedUsd: string;
  billingDay: number;
  invoiceTitle?: string | null;
  taxNumber?: string | null;
  billingEmail?: string | null;
  remark?: string | null;
  invoices?: Invoice[];
};

type Invoice = {
  id: string;
  billingAccountId: string;
  invoiceNo: string;
  status: "DRAFT" | "ISSUED" | "PAID" | "VOID" | string;
  amountUsd: string;
  periodStart?: string | null;
  periodEnd?: string | null;
  issuedAt?: string | null;
  paidAt?: string | null;
  title?: string | null;
  taxNumber?: string | null;
  remark?: string | null;
  createdAt: string;
  billingAccount?: {
    id: string;
    user?: { id: string; email: string } | null;
  };
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

type IpBanMode = "error" | "notice";

type IpBanRule = {
  ip: string;
  mode: IpBanMode;
  message: string;
  reason?: string | null;
  createdAt: string;
  updatedAt: string;
};

type TemporaryIpNoticeBan = {
  ip: string;
  message: string;
  ttlSeconds: number;
};

type TemporaryIpNoticeBanSettings = {
  enabled: boolean;
  threshold: number;
  windowSeconds: number;
  banSeconds: number;
  message: string;
  minBanSeconds?: number;
  maxBanSeconds?: number;
  minThreshold?: number;
  maxThreshold?: number;
  minWindowSeconds?: number;
  maxWindowSeconds?: number;
};

type AccessTierRef = {
  id: string;
  code: string;
  name: string;
};

type AccessTier = AccessTierRef & {
  status: "ACTIVE" | "DISABLED" | string;
  sortOrder: number;
  description?: string | null;
  createdAt?: string;
  updatedAt?: string;
  _count?: {
    users: number;
    apiKeys: number;
    modelPools: number;
    dedicatedRouteRules: number;
  };
};

type DedicatedRouteRule = {
  id: string;
  name: string;
  targetType: "USER" | "API_KEY" | "IP" | string;
  userId?: string | null;
  apiKeyId?: string | null;
  ipPattern?: string | null;
  accessTierId: string;
  upstreamProvider?: string | null;
  upstreamProviderKeyId?: string | null;
  status: "ACTIVE" | "DISABLED" | string;
  priority: number;
  startsAt?: string | null;
  expiresAt?: string | null;
  conflictWarnings?: string[];
  remark?: string | null;
  createdAt: string;
  updatedAt: string;
  user?: { id: string; email: string } | null;
  apiKey?: { id: string; name: string; keyPrefix: string } | null;
  accessTier?: AccessTierRef | null;
  upstreamProviderKey?: {
    id: string;
    name: string;
    keyPrefix: string;
    upstreamProvider?: { name: string } | null;
  } | null;
};

type RiskCenter = {
  ipBanRules: IpBanRule[];
  temporaryIpNoticeBans: TemporaryIpNoticeBan[];
  temporaryIpNoticeBanSettings: TemporaryIpNoticeBanSettings;
  pendingAutoTerminateSettings: PendingAutoTerminateSettings;
  gatewayNoticeSettings: GatewayNoticeSettings;
  redisFailurePolicySettings: RedisFailurePolicySettings;
  globalCircuitBreakerSettings: GlobalCircuitBreakerSettings;
  externalAlertSettings: ExternalAlertSettings;
  charityAnnouncementSettings: CharityAnnouncementSettings;
  counters: {
    pendingRequests: number;
    failedRequests24h: number;
    noticeRequests24h: number;
    rateLimitedRequests24h: number;
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
  message: string;
  minTimeoutSeconds?: number;
  maxTimeoutSeconds?: number;
};

type GatewayNoticeSettings = {
  userConcurrencyMessage: string;
  keyConcurrencyMessage: string;
  userRateLimitMessage: string;
  keyRateLimitMessage: string;
  charityIpRateLimitMessage: string;
  modelUnavailableMessage: string;
  missingUsageMessage: string;
  staleResponsesContextMessage: string;
  invalidEncryptedContentMessage: string;
};

type RedisFailurePolicySettings = {
  policy: "fail-open" | "fail-closed" | "degraded";
  degradedAdminBypassEnabled: boolean;
  degradedUserIds: string[];
  message: string;
};

type GlobalCircuitBreakerSettings = {
  enabled: boolean;
  allowAdmins: boolean;
  allowedUserIds: string[];
  message: string;
};

type ExternalAlertSettings = {
  enabled: boolean;
  webhookUrl: string;
  minSeverity: "info" | "warning" | "critical";
  intervalSeconds: number;
  mentionText: string;
};

type CharityAnnouncementSettings = {
  serviceEnabled: boolean;
  serviceDisabledMessage: string;
  enabled: boolean;
  frequency: "every_visit" | "interval";
  intervalHours: number;
  minIntervalHours?: number;
  maxIntervalHours?: number;
  title: string;
  content: string;
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

const modelPriceImportExampleCsv = [
  "model,upstreamProvider,currency,upstreamInputPer1MTok,upstreamCachedInputPer1MTok,upstreamOutputPer1MTok,upstreamPriceMultiplier,customerInputPer1MTok,customerCachedInputPer1MTok,customerOutputPer1MTok,customerPriceMultiplier,minimumChargeUsd,enabled,priceVersion,effectiveFrom,effectiveTo",
  "gpt-4o-mini,openai,USD,5,0.5,30,1,6,0.6,36,1,0,true,v1,,",
].join("\n");

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
    id: "admin-charity",
    label: "公益用户",
    description: "专属账号、Key、公开页",
    icon: HeartHandshake,
  },
  {
    id: "admin-settings",
    label: "登录设置",
    description: "验证码、新用户赠额",
    icon: Settings,
  },
  {
    id: "admin-notices",
    label: "公告返回",
    description: "网关文案、封禁、限流",
    icon: FileSearch,
  },
  {
    id: "admin-risk",
    label: "风控中心",
    description: "封禁、公告、终止总览",
    icon: Shield,
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
    id: "admin-routing",
    label: "分级专线",
    description: "等级、模型池、专线路由",
    icon: GitBranch,
  },
  {
    id: "admin-requests",
    label: "全站调用",
    description: "账单、请求、审计",
    icon: Activity,
  },
  {
    id: "admin-reports",
    label: "运营报表",
    description: "收入、成本、毛利排行",
    icon: BarChart3,
  },
  {
    id: "admin-audit-logs",
    label: "操作审计",
    description: "后台写操作追踪",
    icon: ListChecks,
  },
  {
    id: "admin-login-logs",
    label: "登录日志",
    description: "登录成功和失败追踪",
    icon: ShieldCheck,
  },
] as const;

const adminNavGroups = [
  {
    label: "工作台",
    items: adminNav.filter((item) => ["admin-overview"].includes(item.id)),
  },
  {
    label: "用户与商业",
    items: adminNav.filter((item) =>
      ["admin-users", "admin-charity", "admin-redeem"].includes(item.id),
    ),
  },
  {
    label: "网关",
    items: adminNav.filter((item) =>
      ["admin-upstreams", "admin-model-pools", "admin-routing"].includes(
        item.id,
      ),
    ),
  },
  {
    label: "调用与风控",
    items: adminNav.filter((item) =>
      ["admin-requests", "admin-risk", "admin-notices"].includes(item.id),
    ),
  },
  {
    label: "系统与审计",
    items: adminNav.filter((item) =>
      [
        "admin-settings",
        "admin-reports",
        "admin-audit-logs",
        "admin-login-logs",
      ].includes(item.id),
    ),
  },
] as const;

const adminWorkspaces = [
  {
    id: "overview",
    label: "总览",
    description: "状态、收入、成本、初始化",
    icon: Shield,
    tabs: ["admin-overview"],
  },
  {
    id: "commerce",
    label: "用户与商业",
    description: "用户、公益、兑换和商业账户",
    icon: Users,
    tabs: ["admin-users", "admin-charity", "admin-redeem"],
  },
  {
    id: "gateway",
    label: "网关配置",
    description: "上游、价格、模型池、专线",
    icon: Server,
    tabs: ["admin-upstreams", "admin-model-pools", "admin-routing"],
  },
  {
    id: "traffic-risk",
    label: "调用与风控",
    description: "请求、封禁、公告和终止",
    icon: Activity,
    tabs: ["admin-requests", "admin-risk", "admin-notices"],
  },
  {
    id: "system-audit",
    label: "系统与审计",
    description: "登录、报表、操作和登录日志",
    icon: Settings,
    tabs: [
      "admin-settings",
      "admin-reports",
      "admin-audit-logs",
      "admin-login-logs",
    ],
  },
] as const satisfies readonly {
  id: string;
  label: string;
  description: string;
  icon: typeof BarChart3;
  tabs: readonly AdminTab[];
}[];

const adminTabSlugs = {
  "admin-overview": "overview",
  "admin-users": "users",
  "admin-charity": "charity",
  "admin-settings": "settings",
  "admin-notices": "notices",
  "admin-risk": "risk",
  "admin-redeem": "redeem",
  "admin-upstreams": "upstreams",
  "admin-model-pools": "model-pools",
  "admin-routing": "routing",
  "admin-requests": "requests",
  "admin-reports": "reports",
  "admin-audit-logs": "audit-logs",
  "admin-login-logs": "login-logs",
} as const;

const adminSidebarCompactStorageKey = "apishare-admin-sidebar-compact";

type FrontTab = (typeof frontNav)[number]["id"];
type AdminTab = (typeof adminNav)[number]["id"];
type Tab = FrontTab | AdminTab;
type DashboardMode = "user" | "admin";

function isAdminTab(tab: Tab): tab is AdminTab {
  return tab in adminTabSlugs;
}

function adminTabFromPath(pathname: string | null): AdminTab {
  const slug = pathname?.split("/").filter(Boolean)[1] ?? "";
  const matched = Object.entries(adminTabSlugs).find(
    ([, candidate]) => candidate === slug,
  );
  return (matched?.[0] as AdminTab | undefined) ?? "admin-overview";
}

function adminWorkspaceForTab(tab: AdminTab) {
  return (
    adminWorkspaces.find((workspace) =>
      (workspace.tabs as readonly AdminTab[]).includes(tab),
    ) ?? adminWorkspaces[0]
  );
}

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
  "admin-charity": {
    eyebrow: "公益站",
    title: "公益用户",
    description: "维护公益专属用户和它的 API Key，底层逻辑与普通用户完全一致。",
  },
  "admin-settings": {
    eyebrow: "运营中心",
    title: "登录设置",
    description: "配置邮箱验证码登录、自动注册和新用户赠送余额。",
  },
  "admin-notices": {
    eyebrow: "网关配置",
    title: "公告返回",
    description: "集中配置由网关直接返回给用户的公告、封禁和限流文案。",
  },
  "admin-risk": {
    eyebrow: "风控中心",
    title: "风控中心",
    description: "查看封禁、临时提示、公告返回和自动终止的运行态。",
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
  "admin-routing": {
    eyebrow: "网关配置",
    title: "分级专线",
    description: "维护访问等级，并按用户、Key 或 IP 指定专线路由。",
  },
  "admin-requests": {
    eyebrow: "审计与账单",
    title: "全站调用",
    description: "按用户、模型、状态和时间筛选调用记录与利润数据。",
  },
  "admin-reports": {
    eyebrow: "审计与账单",
    title: "运营报表",
    description: "查看最近 30 天按用户、模型、上游、等级和专线聚合的经营数据。",
  },
  "admin-audit-logs": {
    eyebrow: "审计与账单",
    title: "操作审计",
    description: "查看管理员后台写操作、来源 IP 和脱敏后的请求内容。",
  },
  "admin-login-logs": {
    eyebrow: "审计与账单",
    title: "登录日志",
    description: "查看管理员和用户登录成功、失败、来源 IP 与失败原因。",
  },
};

export default function DashboardClient({ mode }: { mode: DashboardMode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [token, setTokenState] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>(
    mode === "admin" ? adminTabFromPath(pathname) : "overview",
  );
  const [sidebarCompact, setSidebarCompact] = useState(() => {
    if (typeof window === "undefined" || mode !== "admin") {
      return false;
    }
    return (
      window.localStorage.getItem(adminSidebarCompactStorageKey) === "true"
    );
  });
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [riskCenter, setRiskCenter] = useState<RiskCenter | null>(null);
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [packageTemplates, setPackageTemplates] = useState<PackageTemplate[]>(
    [],
  );
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [ipBanRules, setIpBanRules] = useState<IpBanRule[]>([]);
  const [accessTiers, setAccessTiers] = useState<AccessTier[]>([]);
  const [dedicatedRouteRules, setDedicatedRouteRules] = useState<
    DedicatedRouteRule[]
  >([]);
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  const [pendingAutoTerminateSettings, setPendingAutoTerminateSettings] =
    useState<PendingAutoTerminateSettings | null>(null);
  const [charityAnnouncementSettings, setCharityAnnouncementSettings] =
    useState<CharityAnnouncementSettings | null>(null);
  const [
    reasoningEffortTransformSettings,
    setReasoningEffortTransformSettings,
  ] = useState<ReasoningEffortTransformSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingAdminTab, setLoadingAdminTab] = useState<AdminTab | null>(null);
  const [refreshingActivePage, setRefreshingActivePage] = useState(false);
  const loadedAdminTabsRef = useRef<Set<AdminTab>>(new Set());

  useEffect(() => {
    let cancelled = false;
    const saved = getToken();
    if (saved) {
      setAuthChecked(false);
      setTokenState(saved);
      void refreshAll(saved).finally(() => {
        if (!cancelled) {
          setAuthChecked(true);
        }
      });
    } else {
      setAuthChecked(true);
    }

    return () => {
      cancelled = true;
    };
  }, [mode]);

  useEffect(() => {
    if (mode !== "admin") {
      return;
    }

    const nextTab = adminTabFromPath(pathname);
    setActiveTab((current) => (current === nextTab ? current : nextTab));
  }, [mode, pathname]);

  useEffect(() => {
    if (mode !== "admin" || !token || !user || !isAdminTab(activeTab)) {
      return;
    }

    if (loadedAdminTabsRef.current.has(activeTab)) {
      return;
    }

    setLoadingAdminTab(activeTab);
    void refreshAdminTab(activeTab, token)
      .catch((loadError) => {
        setError(`${titleForTab(activeTab)}加载失败：${errorToText(loadError)}`);
      })
      .finally(() => {
        setLoadingAdminTab((current) =>
          current === activeTab ? null : current,
        );
      });
  }, [activeTab, mode, token, user]);

  function switchTab(tab: Tab) {
    setActiveTab(tab);
    if (mode === "admin" && isAdminTab(tab)) {
      router.push(`/admin/${adminTabSlugs[tab]}`);
    }
  }

  function toggleSidebarCompact() {
    setSidebarCompact((current) => {
      const next = !current;
      window.localStorage.setItem(adminSidebarCompactStorageKey, String(next));
      return next;
    });
  }

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
      loadedAdminTabsRef.current.clear();
      setLoadingAdminTab(null);
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
      setRiskCenter(null);
      setAdminUsers([]);
      setTenants([]);
      setPackageTemplates([]);
      setInvoices([]);
      setAccessTiers([]);
      setDedicatedRouteRules([]);
      setPendingAutoTerminateSettings(null);
      setReasoningEffortTransformSettings(null);
      setIpBanRules([]);
      loadedAdminTabsRef.current.clear();

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

    const initialTab =
      isAdminTab(activeTab) ? activeTab : adminTabFromPath(pathname);
    await loadData("当前后台页面", async () => {
      await refreshAdminTab(initialTab, authToken);
    });
  }

  async function refreshAdminTab(tab: AdminTab, authToken = token) {
    if (!authToken) {
      return;
    }

    switch (tab) {
      case "admin-overview":
        await refreshRiskCenter(authToken);
        break;
      case "admin-users":
        await Promise.all([
          refreshAdminUsers(authToken),
          refreshCommercialOps(authToken),
        ]);
        break;
      case "admin-charity":
        await Promise.all([
          refreshAdminUsers(authToken),
          refreshCommercialOps(authToken),
          refreshSettings(authToken),
        ]);
        break;
      case "admin-upstreams":
        break;
      case "admin-model-pools":
        break;
        break;
      case "admin-routing":
        await Promise.all([
          refreshRouting(authToken),
          refreshAdminUsers(authToken),
        ]);
        break;
      case "admin-settings":
      case "admin-notices":
        await refreshSettings(authToken);
        break;
      case "admin-risk":
        await refreshRiskCenter(authToken);
        break;
      case "admin-redeem":
        break;
      case "admin-reports":
        break;
      case "admin-requests":
        break;
      case "admin-audit-logs":
        break;
      case "admin-login-logs":
        break;
    }

    loadedAdminTabsRef.current.add(tab);
  }

  async function refreshAdminUsers(authToken = token) {
    if (!authToken) return;
    const result = await apiFetch<{ users: AdminUser[] }>("/admin/users", {
      token: authToken,
    });
    setAdminUsers(result.users);
  }

  async function refreshCommercialOps(authToken = token) {
    if (!authToken) return;
    const [tenantsResult, templatesResult, invoicesResult] = await Promise.all([
      apiFetch<{ tenants: Tenant[] }>("/admin/tenants", { token: authToken }),
      apiFetch<{ packageTemplates: PackageTemplate[] }>(
        "/admin/package-templates",
        { token: authToken },
      ),
      apiFetch<{ invoices: Invoice[] }>("/admin/invoices", {
        token: authToken,
      }),
    ]);
    setTenants(tenantsResult.tenants);
    setPackageTemplates(templatesResult.packageTemplates);
    setInvoices(invoicesResult.invoices);
  }

  async function refreshSettings(authToken = token) {
    if (!authToken) return;
    const [pendingResult, charityResult, reasoningResult] = await Promise.all([
      apiFetch<{ settings: PendingAutoTerminateSettings }>(
        "/admin/pending-auto-terminate-settings",
        { token: authToken },
      ),
      apiFetch<{ settings: CharityAnnouncementSettings }>(
        "/admin/charity-announcement-settings",
        { token: authToken },
      ),
      apiFetch<{ settings: ReasoningEffortTransformSettings }>(
        "/admin/reasoning-effort-transform-settings",
        { token: authToken },
      ),
    ]);
    setPendingAutoTerminateSettings(pendingResult.settings);
    setCharityAnnouncementSettings(charityResult.settings);
    setReasoningEffortTransformSettings(reasoningResult.settings);
  }

  async function refreshRiskCenter(authToken = token) {
    if (!authToken) return;
    const result = await apiFetch<RiskCenter>("/admin/risk-center", {
      token: authToken,
    });
    setRiskCenter(result);
    setIpBanRules(result.ipBanRules);
    setPendingAutoTerminateSettings(result.pendingAutoTerminateSettings);
    setCharityAnnouncementSettings(result.charityAnnouncementSettings);
  }

  const refreshRouting = useCallback(
    async (authToken = token) => {
      if (!authToken) {
        return;
      }

      const [tiersResult, rulesResult] = await Promise.all([
        apiFetch<{ tiers: AccessTier[] }>("/admin/access-tiers", {
          token: authToken,
        }),
        apiFetch<{ rules: DedicatedRouteRule[] }>(
          "/admin/dedicated-route-rules",
          { token: authToken },
        ),
      ]);
      setAccessTiers(tiersResult.tiers);
      setDedicatedRouteRules(rulesResult.rules);
    },
    [token],
  );

  function logout() {
    clearToken();
    setTokenState(null);
    setUser(null);
    loadedAdminTabsRef.current.clear();
    setLoadingAdminTab(null);
    setAuthChecked(true);
    if (mode === "admin") {
      const nextTab: AdminTab = "admin-overview";
      setActiveTab(nextTab);
      router.push("/admin");
      return;
    }
    setActiveTab("overview");
  }

  async function refreshActiveAdminPage() {
    if (refreshingActivePage) {
      return;
    }

    setRefreshingActivePage(true);
    setError(null);

    if (mode !== "admin" || !isAdminTab(activeTab)) {
      try {
        await refreshAll();
      } finally {
        setRefreshingActivePage(false);
      }
      return;
    }

    try {
      switch (activeTab) {
        case "admin-overview":
          await refreshRiskCenter();
          break;
        case "admin-users":
        case "admin-charity":
          await Promise.all([
            refreshAdminUsers(),
            refreshCommercialOps(),
            refreshSettings(),
          ]);
          break;
        case "admin-upstreams":
          break;
        case "admin-model-pools":
          break;
        case "admin-routing":
          await refreshRouting();
          break;
        case "admin-settings":
        case "admin-notices":
          await refreshSettings();
          break;
        case "admin-risk":
          await refreshRiskCenter();
          break;
        case "admin-redeem":
          break;
        case "admin-requests":
          break;
        case "admin-reports":
          break;
        case "admin-audit-logs":
          break;
        case "admin-login-logs":
          break;
      }
    } catch (refreshError) {
      setError(`刷新失败：${errorToText(refreshError)}`);
    } finally {
      setRefreshingActivePage(false);
    }
  }

  if (!authChecked) {
    return (
      <main className="auth-boot-page">
        <section className="auth-boot-panel" aria-label="正在进入控制台">
          <span className="auth-boot-mark">A</span>
          <div>
            <strong>正在进入控制台</strong>
            <p>正在恢复登录状态...</p>
          </div>
        </section>
      </main>
    );
  }

  if (!token || !user) {
    return (
      <Login
        mode={mode}
        onLogin={(nextToken, nextUser) => {
          setToken(nextToken);
          setTokenState(nextToken);
          setUser(nextUser);
          setActiveTab(
            mode === "admin" ? adminTabFromPath(pathname) : "overview",
          );
          void refreshAll(nextToken);
        }}
      />
    );
  }

  const currentPage = pageMeta[activeTab];
  const fixedWorkspace = mode === "admin" && activeTab === "admin-requests";
  const activeAdminWorkspace =
    mode === "admin" && isAdminTab(activeTab)
      ? adminWorkspaceForTab(activeTab)
      : null;

  return (
    <main
      className={
        mode === "admin" && sidebarCompact
          ? "shell shell-admin sidebar-compact"
          : mode === "admin"
            ? "shell shell-admin"
            : "shell"
      }
    >
      <aside className={mode === "admin" ? "sidebar admin-sidebar" : "sidebar"}>
        <div className="brand">
          <span className="brand-lockup">
            <span className="brand-mark">A</span>
            <span className="brand-name">APIshare</span>
          </span>
          {mode === "admin" ? (
            <button
              aria-label={sidebarCompact ? "展开侧栏" : "收起侧栏"}
              className="sidebar-toggle"
              onClick={toggleSidebarCompact}
              type="button"
            >
              {sidebarCompact ? (
                <PanelLeftOpen size={17} />
              ) : (
                <PanelLeftClose size={17} />
              )}
            </button>
          ) : null}
        </div>
        <nav className="nav">
          {mode === "admin" ? (
            <div className="nav-group">
              <div className="nav-heading">后台</div>
              {adminWorkspaces.map((workspace) => (
                <NavButton
                  key={workspace.id}
                  item={workspace}
                  active={activeAdminWorkspace?.id === workspace.id}
                  compact={sidebarCompact}
                  onClick={() => switchTab(workspace.tabs[0])}
                />
              ))}
            </div>
          ) : (
            <div className="nav-group">
              <div className="nav-heading">前台</div>
              {frontNav.map((item) => (
                <NavButton
                  key={item.id}
                  item={item}
                  active={activeTab === item.id}
                  onClick={() => switchTab(item.id)}
                />
              ))}
            </div>
          )}
        </nav>
      </aside>
      <section className={fixedWorkspace ? "main main-fixed-page" : "main"}>
        <div
          className={
            mode === "admin" ? "topbar admin-command-bar" : "topbar"
          }
        >
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
            <div className="button-row admin-global-actions">
              <button
                className="button secondary"
                disabled={refreshingActivePage}
                onClick={() => void refreshActiveAdminPage()}
                type="button"
              >
                <RefreshCw size={17} />
                <span>{refreshingActivePage ? "刷新中..." : "刷新"}</span>
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
          {mode === "admin" &&
          isAdminTab(activeTab) &&
          loadingAdminTab === activeTab ? (
            <div className="admin-page-loading">
              正在加载{titleForTab(activeTab)}...
            </div>
          ) : null}
          {mode === "admin" && activeAdminWorkspace ? (
            <AdminWorkspaceTabs
              activeTab={activeTab as AdminTab}
              tabs={activeAdminWorkspace.tabs}
              onSelect={(tab) => switchTab(tab)}
            />
          ) : null}

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
          {mode === "admin" && isAdminTab(activeTab) ? (
            <AdminDashboardContent
              activeTab={activeTab}
              accessTiers={accessTiers}
              dedicatedRouteRules={dedicatedRouteRules}
              adminUsers={adminUsers}
              reasoningEffortTransformSettings={
                reasoningEffortTransformSettings
              }
              ipBanRules={ipBanRules}
              pendingAutoTerminateSettings={pendingAutoTerminateSettings}
              token={token}
              onError={setError}
              onRefreshSettings={refreshSettings}
              onRefreshRiskCenter={refreshRiskCenter}
              onRefreshRouting={refreshRouting}
              onIpBanRulesChanged={setIpBanRules}
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

function AdminDashboardContent({
  activeTab,
  accessTiers,
  dedicatedRouteRules,
  adminUsers,
  ipBanRules,
  pendingAutoTerminateSettings,
  reasoningEffortTransformSettings,
  token,
  onError,
  onRefreshSettings,
  onRefreshRiskCenter,
  onRefreshRouting,
  onIpBanRulesChanged,
  onPendingAutoTerminateSettingsChanged,
  onReasoningEffortTransformSettingsChanged,
}: {
  activeTab: AdminTab;
  accessTiers: AccessTier[];
  dedicatedRouteRules: DedicatedRouteRule[];
  adminUsers: AdminUser[];
  ipBanRules: IpBanRule[];
  pendingAutoTerminateSettings: PendingAutoTerminateSettings | null;
  reasoningEffortTransformSettings: ReasoningEffortTransformSettings | null;
  token: string | null;
  onError: (error: string | null) => void;
  onRefreshSettings: () => Promise<void>;
  onRefreshRiskCenter: () => Promise<void>;
  onRefreshRouting: () => Promise<void>;
  onIpBanRulesChanged: (rules: IpBanRule[]) => void;
  onPendingAutoTerminateSettingsChanged: (
    settings: PendingAutoTerminateSettings | null,
  ) => void;
  onReasoningEffortTransformSettingsChanged: (
    settings: ReasoningEffortTransformSettings | null,
  ) => void;
}) {
  switch (activeTab) {
    case "admin-overview":
      return <AdminOverviewPage onError={onError} />;
    case "admin-upstreams":
      return <AdminUpstreamsPage onError={onError} />;
    case "admin-model-pools":
      return <AdminModelPoolsPage onError={onError} />;
    case "admin-routing":
      return (
        <AdminRouting
          users={adminUsers}
          onError={onError}
        />
      );
    case "admin-users":
    case "admin-charity":
      return (
        <AdminUsersPage
          charityOnly={activeTab === "admin-charity"}
          onError={onError}
        />
      );
    case "admin-settings":
      return (
        <AdminAuthSettings
          onError={onError}
        />
      );
    case "admin-notices":
      return (
        <AdminGatewayNotices
          onError={onError}
        />
      );
    case "admin-risk":
      return <AdminRiskCenter onError={onError} />;
    case "admin-redeem":
      return (
        <AdminRedeemCodes
          onError={onError}
        />
      );
    case "admin-requests":
      return <AdminRequestsPage onError={onError} />;
    case "admin-reports":
      return <AdminReports token={token ?? ""} />;
    case "admin-audit-logs":
      return <AdminAuditLogs />;
    case "admin-login-logs":
      return <AdminLoginLogs />;
  }
}

function AdminWorkspaceTabs({
  activeTab,
  tabs,
  onSelect,
}: {
  activeTab: AdminTab;
  tabs: readonly AdminTab[];
  onSelect: (tab: AdminTab) => void;
}) {
  if (tabs.length <= 1) {
    return null;
  }

  return (
    <div
      className="admin-workspace-tabs admin-segmented-control"
      role="tablist"
      aria-label="后台子功能"
    >
      {tabs.map((tab) => {
        const item = adminNav.find((nav) => nav.id === tab);
        if (!item) {
          return null;
        }
        const Icon = item.icon;
        return (
          <button
            aria-selected={activeTab === tab}
            className={activeTab === tab ? "active" : ""}
            key={tab}
            onClick={() => onSelect(tab)}
            role="tab"
            type="button"
          >
            <Icon size={16} />
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function NavButton({
  item,
  active,
  onClick,
  compact = false,
}: {
  item: {
    id: string;
    label: string;
    description?: string;
    icon: typeof BarChart3;
  };
  active: boolean;
  onClick: () => void;
  compact?: boolean;
}) {
  const Icon = item.icon;
  return (
    <button
      aria-label={item.label}
      className={[
        "nav-item",
        active ? "active" : "",
        compact ? "compact" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={onClick}
      title={compact ? item.label : undefined}
      type="button"
    >
      <Icon size={18} />
      <span>
        <strong>{item.label}</strong>
        {item.description ? <small>{item.description}</small> : null}
      </span>
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
          caption={`可用 $${money(
            String(
              Number(wallet?.balance ?? 0) -
                Number(wallet?.reservedBalance ?? 0),
            ),
          )} / 冻结 $${money(wallet?.reservedBalance ?? "0")} ${
            wallet?.currency ?? "USD"
          }`}
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

function titleForTab(tab: Tab) {
  const item = [...frontNav, ...adminNav].find((nav) => nav.id === tab);
  return item?.label ?? "总览";
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
