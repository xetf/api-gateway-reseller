"use client";

import { Plus, Send, Trash2 } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { apiFetch } from "../../../lib/api";
import { confirmAdminAction } from "../_components/admin-confirm";
import { dateTime, money } from "../_components/admin-format";
import { useAdminResource } from "../_components/admin-hooks";
import { AdminDataTable, Metric, StatusPill } from "../_components/admin-ui";

type ApiKey = {
  id: string;
  name: string;
  keyPrefix: string;
  allowedModels?: string[];
};

type AccessTierRef = { id: string; code: string; name: string };

type AccessTier = AccessTierRef & {
  status: "ACTIVE" | "DISABLED" | string;
  sortOrder: number;
  description?: string | null;
  createdAt?: string;
  updatedAt?: string;
  _count?: { users: number; apiKeys: number; modelPools: number; dedicatedRouteRules: number };
};

type AdminUser = {
  id: string;
  email: string;
  apiKeys?: ApiKey[];
};

type UpstreamProviderKey = {
  id: string;
  upstreamProviderId: string;
  name: string;
  key: string;
  keyPrefix: string;
  status: "ACTIVE" | "DISABLED" | string;
  priority: number;
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
  compactItemType: "compaction" | "compaction_summary";
  keys?: UpstreamProviderKey[];
  createdAt: string;
  updatedAt: string;
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
  upstreamProviderKey?: { id: string; name: string; keyPrefix: string; upstreamProvider?: { name: string } | null } | null;
};

type RouteSimulationPrice = {
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
};

type RouteSimulation = {
  input: { userId: string; apiKeyId: string; clientIp?: string | null; model: string };
  user: { id: string; email: string; status: string; tier?: AccessTierRef | null };
  apiKey: { id: string; name: string; keyPrefix: string; status: string; tier?: AccessTierRef | null };
  policy: { tierId: string | null; tierCode: string; dedicatedRouteRuleId?: string | null; forcedProvider?: string | null; forcedProviderKeyId?: string | null };
  route: {
    fallbackToStandard: boolean;
    forcedProvider?: string | null;
    forcedProviderKeyId?: string | null;
    routeCandidates: Array<{ id: string; upstreamProvider: string; status: string; effectiveStatus: string; activeKeys: Array<{ id: string; name: string; keyPrefix: string }>; price?: RouteSimulationPrice | null; unavailableReasons?: string[] }>;
    selectedCandidate?: { upstreamProvider: string; activeKeys: Array<{ id: string; name: string; keyPrefix: string }>; price?: RouteSimulationPrice | null } | null;
    unavailableReasons: string[];
  };
  steps: string[];
};

function errorToText(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "操作失败，请稍后再试。";
}

export function AdminRouting({
  users,
  onError,
}: {
  users: AdminUser[];
  onError: (error: string | null) => void;
}) {
  const tiersQuery = useAdminResource<{ tiers: AccessTier[] }>("accessTiers", "/admin/access-tiers");
  const rulesQuery = useAdminResource<{ rules: DedicatedRouteRule[] }>("dedicatedRouteRules", "/admin/dedicated-route-rules");
  const providersQuery = useAdminResource<{ providers: UpstreamProvider[] }>(
    "upstreams",
    "/admin/upstream-providers",
  );
  const accessTiers = tiersQuery.data?.tiers ?? [];
  const dedicatedRouteRules = rulesQuery.data?.rules ?? [];
  const providers = providersQuery.data?.providers ?? [];
  const onChanged = () => {
    void tiersQuery.refetch();
    void rulesQuery.refetch();
    void providersQuery.refetch();
  };
  useEffect(() => {
    const error = tiersQuery.error ?? rulesQuery.error ?? providersQuery.error;
    onError(error ? errorToText(error) : null);
  }, [tiersQuery.error, rulesQuery.error, providersQuery.error, onError]);

  const activeTiers = accessTiers.filter((tier) => tier.status === "ACTIVE");
  const firstUser = users[0];
  const firstUserKey = firstUser?.apiKeys?.[0];
  const providerNames = providers.map((provider) => provider.name);
  const providerKeys = providers.flatMap((provider) =>
    (provider.keys ?? []).map((key) => ({
      ...key,
      providerName: provider.name,
    })),
  );
  const [tierDraft, setTierDraft] = useState({
    code: "",
    name: "",
    sortOrder: "100",
    description: "",
  });
  const [ruleDraft, setRuleDraft] = useState({
    name: "",
    targetType: "USER",
    userId: firstUser?.id ?? "",
    apiKeyId: firstUserKey?.id ?? "",
    ipPattern: "",
    accessTierId: activeTiers[0]?.id ?? "",
    upstreamProvider: "",
    upstreamProviderKeyId: "",
    priority: "100",
    startsAt: "",
    expiresAt: "",
    remark: "",
  });
  const [simulationDraft, setSimulationDraft] = useState({
    userId: firstUser?.id ?? "",
    apiKeyId: firstUserKey?.id ?? "",
    clientIp: "",
    model: "",
  });
  const [simulation, setSimulation] = useState<RouteSimulation | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    setRuleDraft((current) => ({
      ...current,
      userId: current.userId || firstUser?.id || "",
      apiKeyId: current.apiKeyId || firstUserKey?.id || "",
      accessTierId: current.accessTierId || activeTiers[0]?.id || "",
    }));
    setSimulationDraft((current) => ({
      ...current,
      userId: current.userId || firstUser?.id || "",
      apiKeyId: current.apiKeyId || firstUserKey?.id || "",
    }));
  }, [firstUser?.id, firstUserKey?.id, activeTiers]);

  const selectedProviderKeys = providerKeys.filter(
    (key) =>
      !ruleDraft.upstreamProvider ||
      key.providerName === ruleDraft.upstreamProvider,
  );
  const selectedSimulationUser = users.find(
    (item) => item.id === simulationDraft.userId,
  );
  const simulationUserKeys = selectedSimulationUser?.apiKeys ?? [];
  const simulationModels = Array.from(
    new Set([
      ...simulationUserKeys.flatMap((key) => key.allowedModels ?? []),
      ...users.flatMap((user) =>
        (user.apiKeys ?? []).flatMap((key) => key.allowedModels ?? []),
      ),
    ]),
  ).sort();
  const simulationStepRows =
    simulation?.steps.map((step, index) => ({
      id: `${step}:${index}`,
      step: `${index + 1}. ${step}`,
    })) ?? [];
  const simulationCandidateRows =
    simulation?.route.routeCandidates.map((candidate) => ({
      id: candidate.id,
      provider: candidate.upstreamProvider,
      status: <StatusPill status={candidate.effectiveStatus} />,
      activeKeys: candidate.activeKeys.length,
      customerPrice: candidate.price
        ? `$${money(candidate.price.customerInputPer1MTok)} / $${money(candidate.price.customerOutputPer1MTok)}`
        : "-",
      upstreamCost: candidate.price
        ? `$${money(candidate.price.upstreamInputPer1MTok)} / $${money(candidate.price.upstreamOutputPer1MTok)}`
        : "-",
      minimumCharge: candidate.price
        ? `$${money(candidate.price.minimumChargeUsd)}`
        : "-",
    })) ?? [];
  const accessTierRows = accessTiers.map((tier) => ({
    id: tier.id,
    tier: (
      <>
        <strong>{tier.name}</strong>
        <div className="muted">{tier.code}</div>
      </>
    ),
    status: <StatusPill status={tier.status} />,
    references: (
      <span className="muted">
        用户 {tier._count?.users ?? 0} · Key {tier._count?.apiKeys ?? 0} · 池{" "}
        {tier._count?.modelPools ?? 0} · 专线{" "}
        {tier._count?.dedicatedRouteRules ?? 0}
      </span>
    ),
    actions: (
      <div className="button-row">
        <button
          className="button secondary"
          disabled={busyId === tier.id}
          onClick={() =>
            updateTier(tier, tier.status === "ACTIVE" ? "DISABLED" : "ACTIVE")
          }
          type="button"
        >
          {tier.status === "ACTIVE" ? "禁用" : "启用"}
        </button>
        <button
          className="icon-button danger"
          disabled={tier.code === "standard" || busyId === tier.id}
          onClick={() => deleteTier(tier)}
          title="删除等级"
          type="button"
        >
          <Trash2 size={16} />
        </button>
      </div>
    ),
  }));
  const dedicatedRouteRows = dedicatedRouteRules.map((rule) => ({
    id: rule.id,
    rule: (
      <>
        <strong>{rule.name}</strong>
        <div className="muted">优先级 {rule.priority}</div>
        <div className="muted">{formatDedicatedRouteValidity(rule)}</div>
        {rule.conflictWarnings?.length ? (
          <div className="inline-warning">
            {rule.conflictWarnings.join("；")}
          </div>
        ) : null}
      </>
    ),
    target: formatDedicatedRouteTarget(rule),
    tier: (
      <>
        {rule.accessTier?.name ?? "-"}
        <div className="muted">{rule.accessTier?.code ?? ""}</div>
      </>
    ),
    route: (
      <>
        {rule.upstreamProvider || "不限制"}
        <div className="muted">
          {rule.upstreamProviderKey
            ? `${rule.upstreamProviderKey.name} (${rule.upstreamProviderKey.keyPrefix})`
            : "任意 Key"}
        </div>
      </>
    ),
    status: <StatusPill status={rule.status} />,
    actions: (
      <div className="button-row">
        <button
          className="button secondary"
          disabled={busyId === rule.id}
          onClick={() =>
            updateRule(
              rule,
              rule.status === "ACTIVE" ? "DISABLED" : "ACTIVE",
            )
          }
          type="button"
        >
          {rule.status === "ACTIVE" ? "禁用" : "启用"}
        </button>
        <button
          className="icon-button danger"
          disabled={busyId === rule.id}
          onClick={() => deleteRule(rule)}
          title="删除专线"
          type="button"
        >
          <Trash2 size={16} />
        </button>
      </div>
    ),
  }));

  async function runSimulation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onError(null);

    try {
      const result = await apiFetch<{ simulation: RouteSimulation }>(
        "/admin/route-simulator",
        {
          method: "POST",
          body: JSON.stringify({
            userId: simulationDraft.userId,
            apiKeyId: simulationDraft.apiKeyId,
            clientIp: simulationDraft.clientIp || null,
            model: simulationDraft.model,
          }),
        },
      );
      setSimulation(result.simulation);
    } catch (error) {
      onError(errorToText(error));
    }
  }

  async function createTier(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onError(null);
    try {
      await apiFetch("/admin/access-tiers", {
        method: "POST",
        body: JSON.stringify({
          code: tierDraft.code,
          name: tierDraft.name,
          sortOrder: Number(tierDraft.sortOrder) || 100,
          description: tierDraft.description || null,
          status: "ACTIVE",
        }),
      });
      setTierDraft({ code: "", name: "", sortOrder: "100", description: "" });
      onChanged();
    } catch (createError) {
      onError(errorToText(createError));
    }
  }

  async function updateTier(tier: AccessTier, status: "ACTIVE" | "DISABLED") {
    onError(null);
    setBusyId(tier.id);
    try {
      await apiFetch(`/admin/access-tiers/${tier.id}`, {
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

  async function deleteTier(tier: AccessTier) {
    if (
      !(await confirmAdminAction({
        title: "删除访问等级",
        description: `确定删除等级「${tier.name}」吗？`,
        confirmText: "删除等级",
        danger: true,
      }))
    ) {
      return;
    }

    onError(null);
    setBusyId(tier.id);
    try {
      await apiFetch(`/admin/access-tiers/${tier.id}`, {
        method: "DELETE",
      });
      onChanged();
    } catch (deleteError) {
      onError(errorToText(deleteError));
    } finally {
      setBusyId(null);
    }
  }

  async function createRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onError(null);
    try {
      await apiFetch("/admin/dedicated-route-rules", {
        method: "POST",
        body: JSON.stringify({
          name: ruleDraft.name,
          targetType: ruleDraft.targetType,
          userId: ruleDraft.targetType === "USER" ? ruleDraft.userId : null,
          apiKeyId:
            ruleDraft.targetType === "API_KEY" ? ruleDraft.apiKeyId : null,
          ipPattern: ruleDraft.targetType === "IP" ? ruleDraft.ipPattern : null,
          accessTierId: ruleDraft.accessTierId,
          upstreamProvider: ruleDraft.upstreamProvider || null,
          upstreamProviderKeyId: ruleDraft.upstreamProviderKeyId || null,
          priority: Number(ruleDraft.priority) || 100,
          startsAt: ruleDraft.startsAt
            ? new Date(ruleDraft.startsAt).toISOString()
            : null,
          expiresAt: ruleDraft.expiresAt
            ? new Date(ruleDraft.expiresAt).toISOString()
            : null,
          remark: ruleDraft.remark || null,
          status: "ACTIVE",
        }),
      });
      setRuleDraft((current) => ({
        ...current,
        name: "",
        ipPattern: "",
        upstreamProvider: "",
        upstreamProviderKeyId: "",
        startsAt: "",
        expiresAt: "",
        remark: "",
      }));
      onChanged();
    } catch (createError) {
      onError(errorToText(createError));
    }
  }

  async function updateRule(
    rule: DedicatedRouteRule,
    status: "ACTIVE" | "DISABLED",
  ) {
    onError(null);
    setBusyId(rule.id);
    try {
      await apiFetch(`/admin/dedicated-route-rules/${rule.id}`, {
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

  async function deleteRule(rule: DedicatedRouteRule) {
    if (
      !(await confirmAdminAction({
        title: "删除专线规则",
        description: `确定删除专线规则「${rule.name}」吗？`,
        confirmText: "删除规则",
        danger: true,
      }))
    ) {
      return;
    }

    onError(null);
    setBusyId(rule.id);
    try {
      await apiFetch(`/admin/dedicated-route-rules/${rule.id}`, {
        method: "DELETE",
      });
      onChanged();
    } catch (deleteError) {
      onError(errorToText(deleteError));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="stack">
      <section className="card">
        <div className="section-head">
          <div>
            <h2 className="section-title">路由模拟器</h2>
            <p className="section-subtitle">
              不发真实请求、不扣费，只按当前配置推演用户最终会走哪个等级、模型池、上游和
              Key。
            </p>
          </div>
          <StatusPill
            status={simulation?.route.selectedCandidate ? "READY" : "WAITING"}
          />
        </div>
        <form className="grid-form" onSubmit={runSimulation}>
          <label>
            用户
            <select
              className="input"
              onChange={(event) => {
                const nextUser = users.find(
                  (item) => item.id === event.target.value,
                );
                setSimulationDraft((current) => ({
                  ...current,
                  userId: event.target.value,
                  apiKeyId: nextUser?.apiKeys?.[0]?.id ?? "",
                }));
              }}
              required
              value={simulationDraft.userId}
            >
              {users.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.email}
                </option>
              ))}
            </select>
          </label>
          <label>
            API Key
            <select
              className="input"
              onChange={(event) =>
                setSimulationDraft((current) => ({
                  ...current,
                  apiKeyId: event.target.value,
                }))
              }
              required
              value={simulationDraft.apiKeyId}
            >
              {simulationUserKeys.map((key) => (
                <option key={key.id} value={key.id}>
                  {key.name} ({key.keyPrefix})
                </option>
              ))}
            </select>
          </label>
          <label>
            来源 IP
            <input
              className="input"
              onChange={(event) =>
                setSimulationDraft((current) => ({
                  ...current,
                  clientIp: event.target.value,
                }))
              }
              placeholder="可留空；用于测试 IP 专线"
              value={simulationDraft.clientIp}
            />
          </label>
          <label>
            模型
            <input
              className="input"
              list="routing-model-suggestions"
              onChange={(event) =>
                setSimulationDraft((current) => ({
                  ...current,
                  model: event.target.value,
                }))
              }
              placeholder="例如 gpt-4o-mini"
              required
              value={simulationDraft.model}
            />
            <datalist id="routing-model-suggestions">
              {simulationModels.map((model) => (
                <option key={model} value={model} />
              ))}
            </datalist>
          </label>
          <div className="form-actions">
            <button className="button" type="submit">
              <Send size={17} />
              模拟路由
            </button>
          </div>
        </form>
        {simulation ? (
          <div className="route-simulation-result">
            <div className="metric-grid">
              <Metric label="最终等级" value={simulation.policy.tierCode} />
              <Metric
                label="命中专线"
                value={simulation.policy.dedicatedRouteRuleId ? "是" : "否"}
              />
              <Metric
                label="首选上游"
                value={
                  simulation.route.selectedCandidate?.upstreamProvider ?? "-"
                }
              />
              <Metric
                label="候选渠道"
                value={String(simulation.route.routeCandidates.length)}
              />
            </div>
            <AdminDataTable
              columns={[{ accessorKey: "step", header: "推演步骤" }]}
              data={simulationStepRows}
              empty="暂无推演步骤"
            />
            {simulation.route.unavailableReasons.length > 0 ? (
              <div className="notice">
                {simulation.route.unavailableReasons.join("；")}
              </div>
            ) : null}
            {simulation.route.routeCandidates.length > 0 ? (
              <AdminDataTable
                columns={[
                  { accessorKey: "provider", header: "候选上游" },
                  { accessorKey: "status", header: "状态" },
                  { accessorKey: "activeKeys", header: "可用 Key" },
                  { accessorKey: "customerPrice", header: "客户价 / 1M" },
                  { accessorKey: "upstreamCost", header: "上游成本 / 1M" },
                  { accessorKey: "minimumCharge", header: "最低扣费" },
                ]}
                data={simulationCandidateRows}
                empty="暂无候选渠道"
              />
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="card">
        <div className="section-head">
          <div>
            <h2 className="section-title">访问等级</h2>
            <p className="section-subtitle">
              用户、API Key 和专线规则都会解析到一个访问等级。
            </p>
          </div>
          <StatusPill
            status={activeTiers.length > 0 ? "ACTIVE" : "UNAVAILABLE"}
          />
        </div>
        <form className="grid-form" onSubmit={createTier}>
          <label>
            等级编码
            <input
              className="input"
              onChange={(event) =>
                setTierDraft((current) => ({
                  ...current,
                  code: event.target.value,
                }))
              }
              placeholder="premium"
              required
              value={tierDraft.code}
            />
          </label>
          <label>
            等级名称
            <input
              className="input"
              onChange={(event) =>
                setTierDraft((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
              placeholder="Premium"
              required
              value={tierDraft.name}
            />
          </label>
          <label>
            排序
            <input
              className="input"
              min={1}
              onChange={(event) =>
                setTierDraft((current) => ({
                  ...current,
                  sortOrder: event.target.value,
                }))
              }
              type="number"
              value={tierDraft.sortOrder}
            />
          </label>
          <label>
            说明
            <input
              className="input"
              onChange={(event) =>
                setTierDraft((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
              value={tierDraft.description}
            />
          </label>
          <div className="form-actions">
            <button className="button" type="submit">
              <Plus size={17} />
              新增等级
            </button>
          </div>
        </form>
        <AdminDataTable
          columns={[
            { accessorKey: "tier", header: "等级" },
            { accessorKey: "status", header: "状态" },
            { accessorKey: "references", header: "引用" },
            { accessorKey: "actions", header: "操作" },
          ]}
          data={accessTierRows}
          empty="暂无访问等级"
        />
      </section>

      <section className="card">
        <div className="section-head">
          <div>
            <h2 className="section-title">专线规则</h2>
            <p className="section-subtitle">
              生效优先级固定为 IP、API Key、用户；同层级按优先级升序。
            </p>
          </div>
          <StatusPill
            status={
              dedicatedRouteRules.some((rule) => rule.status === "ACTIVE")
                ? "ACTIVE"
                : "DISABLED"
            }
          />
        </div>
        <form className="grid-form" onSubmit={createRule}>
          <label>
            规则名
            <input
              className="input"
              onChange={(event) =>
                setRuleDraft((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
              required
              value={ruleDraft.name}
            />
          </label>
          <label>
            目标类型
            <select
              className="input"
              onChange={(event) =>
                setRuleDraft((current) => ({
                  ...current,
                  targetType: event.target.value,
                }))
              }
              value={ruleDraft.targetType}
            >
              <option value="USER">用户</option>
              <option value="API_KEY">API Key</option>
              <option value="IP">IP / CIDR</option>
            </select>
          </label>
          {ruleDraft.targetType === "USER" ? (
            <label>
              用户
              <select
                className="input"
                onChange={(event) =>
                  setRuleDraft((current) => ({
                    ...current,
                    userId: event.target.value,
                  }))
                }
                required
                value={ruleDraft.userId}
              >
                {users.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.email}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {ruleDraft.targetType === "API_KEY" ? (
            <label>
              API Key
              <select
                className="input"
                onChange={(event) =>
                  setRuleDraft((current) => ({
                    ...current,
                    apiKeyId: event.target.value,
                  }))
                }
                required
                value={ruleDraft.apiKeyId}
              >
                {users.flatMap((item) =>
                  (item.apiKeys ?? []).map((key) => (
                    <option key={key.id} value={key.id}>
                      {item.email} · {key.name} ({key.keyPrefix})
                    </option>
                  )),
                )}
              </select>
            </label>
          ) : null}
          {ruleDraft.targetType === "IP" ? (
            <label>
              IP / CIDR
              <input
                className="input"
                onChange={(event) =>
                  setRuleDraft((current) => ({
                    ...current,
                    ipPattern: event.target.value,
                  }))
                }
                placeholder="203.0.113.10 或 203.0.113.0/24"
                required
                value={ruleDraft.ipPattern}
              />
            </label>
          ) : null}
          <label>
            访问等级
            <select
              className="input"
              onChange={(event) =>
                setRuleDraft((current) => ({
                  ...current,
                  accessTierId: event.target.value,
                }))
              }
              required
              value={ruleDraft.accessTierId}
            >
              {activeTiers.map((tier) => (
                <option key={tier.id} value={tier.id}>
                  {tier.name} ({tier.code})
                </option>
              ))}
            </select>
          </label>
          <label>
            专用上游
            <select
              className="input"
              onChange={(event) =>
                setRuleDraft((current) => ({
                  ...current,
                  upstreamProvider: event.target.value,
                  upstreamProviderKeyId: "",
                }))
              }
              value={ruleDraft.upstreamProvider}
            >
              <option value="">不限制</option>
              {providerNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            专用上游 Key
            <select
              className="input"
              onChange={(event) =>
                setRuleDraft((current) => ({
                  ...current,
                  upstreamProviderKeyId: event.target.value,
                }))
              }
              value={ruleDraft.upstreamProviderKeyId}
            >
              <option value="">不限制</option>
              {selectedProviderKeys.map((key) => (
                <option key={key.id} value={key.id}>
                  {key.providerName} · {key.name} ({key.keyPrefix})
                </option>
              ))}
            </select>
          </label>
          <label>
            优先级
            <input
              className="input"
              min={1}
              onChange={(event) =>
                setRuleDraft((current) => ({
                  ...current,
                  priority: event.target.value,
                }))
              }
              type="number"
              value={ruleDraft.priority}
            />
          </label>
          <label>
            开始时间
            <input
              className="input"
              onChange={(event) =>
                setRuleDraft((current) => ({
                  ...current,
                  startsAt: event.target.value,
                }))
              }
              type="datetime-local"
              value={ruleDraft.startsAt}
            />
          </label>
          <label>
            过期时间
            <input
              className="input"
              onChange={(event) =>
                setRuleDraft((current) => ({
                  ...current,
                  expiresAt: event.target.value,
                }))
              }
              type="datetime-local"
              value={ruleDraft.expiresAt}
            />
          </label>
          <label>
            备注
            <input
              className="input"
              onChange={(event) =>
                setRuleDraft((current) => ({
                  ...current,
                  remark: event.target.value,
                }))
              }
              value={ruleDraft.remark}
            />
          </label>
          <div className="form-actions">
            <button className="button" type="submit">
              <Plus size={17} />
              新增专线
            </button>
          </div>
        </form>
        <AdminDataTable
          columns={[
            { accessorKey: "rule", header: "规则" },
            { accessorKey: "target", header: "目标" },
            { accessorKey: "tier", header: "等级" },
            { accessorKey: "route", header: "专线" },
            { accessorKey: "status", header: "状态" },
            { accessorKey: "actions", header: "操作" },
          ]}
          data={dedicatedRouteRows}
          empty="暂无专线规则"
        />
      </section>
    </div>
  );
}

function formatDedicatedRouteTarget(rule: DedicatedRouteRule) {
  if (rule.targetType === "USER") {
    return rule.user?.email ?? rule.userId ?? "-";
  }

  if (rule.targetType === "API_KEY") {
    return rule.apiKey
      ? `${rule.apiKey.name} (${rule.apiKey.keyPrefix})`
      : (rule.apiKeyId ?? "-");
  }

  return rule.ipPattern ?? "-";
}

function formatDedicatedRouteValidity(rule: DedicatedRouteRule) {
  const starts = rule.startsAt ? dateTime(rule.startsAt) : "立即";
  const expires = rule.expiresAt ? dateTime(rule.expiresAt) : "长期";
  return `${starts} - ${expires}`;
}
