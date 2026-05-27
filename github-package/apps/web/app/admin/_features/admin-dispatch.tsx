"use client";

import { Plus, Save, Trash2 } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../../lib/api";
import { confirmAdminAction } from "../_components/admin-confirm";
import { useAdminResource } from "../_components/admin-hooks";
import { AdminDataTable, StatusPill } from "../_components/admin-ui";

type DispatchSettings = {
  stickyEnabled: boolean;
  stickyTtlSeconds: number;
  stickySlowUnbindEnabled: boolean;
  slowFirstTokenMs: number;
  slowTotalLatencyMs: number;
  slowUnbindThreshold: number;
  penaltyEnabled: boolean;
  penaltyFailureThreshold: number;
  penaltySeconds: number;
  healthCheckIntervalSeconds: number;
  speedRankPenalty: number;
  stickyHitPenalty: number;
  forceAvailableButtonEnabled: boolean;
};

type AccessTier = {
  id: string;
  code: string;
  name: string;
  status: string;
};

type IpAccessTierRule = {
  id: string;
  cidrOrIp: string;
  tierId: string;
  status: "ACTIVE" | "DISABLED" | string;
  priority: number;
  remark?: string | null;
  tier?: AccessTier | null;
};

const emptySettings: DispatchSettings = {
  stickyEnabled: true,
  stickyTtlSeconds: 600,
  stickySlowUnbindEnabled: true,
  slowFirstTokenMs: 15000,
  slowTotalLatencyMs: 45000,
  slowUnbindThreshold: 3,
  penaltyEnabled: true,
  penaltyFailureThreshold: 2,
  penaltySeconds: 60,
  healthCheckIntervalSeconds: 30,
  speedRankPenalty: 300,
  stickyHitPenalty: 500,
  forceAvailableButtonEnabled: true,
};

function errorToText(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请稍后再试。";
}

export function AdminDispatchPage({
  onError,
}: {
  onError: (error: string | null) => void;
}) {
  const settingsQuery = useAdminResource<{ settings: DispatchSettings; defaults: DispatchSettings }>(
    "dispatchSettings",
    "/admin/dispatch-settings",
  );
  const tiersQuery = useAdminResource<{ tiers: AccessTier[] }>(
    "accessTiers",
    "/admin/access-tiers",
  );
  const ipRulesQuery = useAdminResource<{ rules: IpAccessTierRule[] }>(
    "ipAccessTiers",
    "/admin/ip-access-tiers",
  );
  const [draft, setDraft] = useState<DispatchSettings>(emptySettings);
  const [ipDraft, setIpDraft] = useState({
    cidrOrIp: "",
    tierId: "",
    priority: "100",
    remark: "",
  });
  const [busy, setBusy] = useState(false);

  const tiers = tiersQuery.data?.tiers ?? [];
  const activeTiers = useMemo(
    () => tiers.filter((tier) => tier.status === "ACTIVE"),
    [tiers],
  );
  const defaultTierId = activeTiers[0]?.id ?? "";
  const rules = ipRulesQuery.data?.rules ?? [];

  useEffect(() => {
    if (settingsQuery.data?.settings) {
      setDraft(settingsQuery.data.settings);
    }
  }, [settingsQuery.data?.settings]);

  useEffect(() => {
    setIpDraft((current) => ({
      ...current,
      tierId: current.tierId || defaultTierId,
    }));
  }, [defaultTierId]);

  useEffect(() => {
    const error = settingsQuery.error ?? tiersQuery.error ?? ipRulesQuery.error;
    onError(error ? errorToText(error) : null);
  }, [settingsQuery.error, tiersQuery.error, ipRulesQuery.error, onError]);

  function setNumber(key: keyof DispatchSettings, value: string) {
    setDraft((current) => ({ ...current, [key]: Number(value) }));
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    onError(null);
    try {
      const result = await apiFetch<{ settings: DispatchSettings }>(
        "/admin/dispatch-settings",
        {
          method: "PATCH",
          body: JSON.stringify(draft),
        },
      );
      setDraft(result.settings);
      void settingsQuery.refetch();
    } catch (error) {
      onError(errorToText(error));
    } finally {
      setBusy(false);
    }
  }

  async function addIpRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ipDraft.cidrOrIp || !ipDraft.tierId) {
      onError("请填写 IP/CIDR 并选择等级。");
      return;
    }
    setBusy(true);
    onError(null);
    try {
      await apiFetch("/admin/ip-access-tiers", {
        method: "POST",
        body: JSON.stringify({
          cidrOrIp: ipDraft.cidrOrIp,
          tierId: ipDraft.tierId,
          priority: Number(ipDraft.priority),
          remark: ipDraft.remark || null,
          status: "ACTIVE",
        }),
      });
      setIpDraft((current) => ({ ...current, cidrOrIp: "", remark: "" }));
      void ipRulesQuery.refetch();
    } catch (error) {
      onError(errorToText(error));
    } finally {
      setBusy(false);
    }
  }

  async function toggleIpRule(rule: IpAccessTierRule) {
    setBusy(true);
    onError(null);
    try {
      await apiFetch(`/admin/ip-access-tiers/${rule.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: rule.status === "ACTIVE" ? "DISABLED" : "ACTIVE",
        }),
      });
      void ipRulesQuery.refetch();
    } catch (error) {
      onError(errorToText(error));
    } finally {
      setBusy(false);
    }
  }

  async function deleteIpRule(rule: IpAccessTierRule) {
    const confirmed = await confirmAdminAction({
      title: "删除 IP 等级规则",
      description: `确定删除 ${rule.cidrOrIp} 的等级规则吗？`,
      confirmText: "删除",
      danger: true,
    });
    if (!confirmed) {
      return;
    }
    setBusy(true);
    onError(null);
    try {
      await apiFetch(`/admin/ip-access-tiers/${rule.id}`, {
        method: "DELETE",
      });
      void ipRulesQuery.refetch();
    } catch (error) {
      onError(errorToText(error));
    } finally {
      setBusy(false);
    }
  }

  const ruleRows = rules.map((rule) => ({
    id: rule.id,
    ip: rule.cidrOrIp,
    tier: rule.tier ? `${rule.tier.name} (${rule.tier.code})` : "-",
    priority: rule.priority,
    status: <StatusPill status={rule.status} />,
    remark: rule.remark ?? "-",
    actions: (
      <div className="button-row compact">
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => void toggleIpRule(rule)}
          type="button"
        >
          {rule.status === "ACTIVE" ? "停用" : "启用"}
        </button>
        <button
          className="button danger"
          disabled={busy}
          onClick={() => void deleteIpRule(rule)}
          type="button"
        >
          <Trash2 size={14} />
          删除
        </button>
      </div>
    ),
  }));

  return (
    <div className="grid admin-page admin-dispatch-page">
      <section className="admin-hero-panel">
        <div>
          <span className="eyebrow">Dispatch System</span>
          <h2>调度与分发系统</h2>
          <p>这里集中配置 IP 粘性、慢定义、解绑、惩罚、健康检测和熵值选择规则。</p>
        </div>
        <div className="admin-hero-status">
          <div className="status-tile">
            <span>粘性规则</span>
            <strong>{draft.stickyEnabled ? "开启" : "关闭"}</strong>
          </div>
          <div className="status-tile">
            <span>惩罚规则</span>
            <strong>{draft.penaltyEnabled ? "开启" : "关闭"}</strong>
          </div>
        </div>
      </section>

      <form className="grid" onSubmit={saveSettings}>
        <section className="card">
          <div className="section-head">
            <div>
              <h2 className="section-title">粘性规则</h2>
              <p className="section-subtitle">某个 IP 成功调用后，会在时间窗口内继续使用同一个上游和 Key。</p>
            </div>
            <label className="check-row">
              <input
                checked={draft.stickyEnabled}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, stickyEnabled: event.target.checked }))
                }
                type="checkbox"
              />
              开启 1号粘性规则
            </label>
          </div>
          <div className="grid cols-3">
            <Field label="粘性时长（秒）" hint="成功调用后，IP 粘住同一上游 Key 的时间。">
              <input className="input" type="number" min={60} max={86400} value={draft.stickyTtlSeconds} onChange={(event) => setNumber("stickyTtlSeconds", event.target.value)} />
            </Field>
            <Field label="强制可用按钮" hint="控制模型池页面是否允许管理员手动强制渠道可用。">
              <label className="check-row">
                <input checked={draft.forceAvailableButtonEnabled} onChange={(event) => setDraft((current) => ({ ...current, forceAvailableButtonEnabled: event.target.checked }))} type="checkbox" />
                允许使用
              </label>
            </Field>
          </div>
        </section>

        <section className="card">
          <div className="section-head">
            <div>
              <h2 className="section-title">慢定义与解绑</h2>
              <p className="section-subtitle">compact 相关请求不会命中慢定义；解绑规则关闭时，慢定义不生效。</p>
            </div>
            <label className="check-row">
              <input checked={draft.stickySlowUnbindEnabled} disabled={!draft.stickyEnabled} onChange={(event) => setDraft((current) => ({ ...current, stickySlowUnbindEnabled: event.target.checked }))} type="checkbox" />
              开启 3号粘性解绑
            </label>
          </div>
          <div className="grid cols-3">
            <Field label="首 token 慢阈值（毫秒）" hint="首 token 超过这个时间，就算本次调用慢。">
              <input className="input" type="number" min={1000} max={300000} value={draft.slowFirstTokenMs} onChange={(event) => setNumber("slowFirstTokenMs", event.target.value)} />
            </Field>
            <Field label="总时长慢阈值（毫秒）" hint="非流式或无首 token 数据时，总时长超过这个值算慢。">
              <input className="input" type="number" min={1000} max={600000} value={draft.slowTotalLatencyMs} onChange={(event) => setNumber("slowTotalLatencyMs", event.target.value)} />
            </Field>
            <Field label="连续慢几次解绑" hint="同一 IP 连续慢达到这个次数，就清除粘性。">
              <input className="input" type="number" min={1} max={100} value={draft.slowUnbindThreshold} onChange={(event) => setNumber("slowUnbindThreshold", event.target.value)} />
            </Field>
          </div>
        </section>

        <section className="card">
          <div className="section-head">
            <div>
              <h2 className="section-title">标准选择与熵值</h2>
              <p className="section-subtitle">标准选择、负载均衡、熵值规则始终开启；这里调节熵增权重。</p>
            </div>
            <StatusPill status="ACTIVE" />
          </div>
          <div className="grid cols-2">
            <Field label="速度排名熵增" hint="速度排名每落后一名，渠道增加多少熵值。">
              <input className="input" type="number" min={0} max={60000} value={draft.speedRankPenalty} onChange={(event) => setNumber("speedRankPenalty", event.target.value)} />
            </Field>
            <Field label="粘性数量熵增" hint="每多一个 IP 粘住该渠道或 Key，就增加多少熵值。">
              <input className="input" type="number" min={0} max={60000} value={draft.stickyHitPenalty} onChange={(event) => setNumber("stickyHitPenalty", event.target.value)} />
            </Field>
          </div>
        </section>

        <section className="card">
          <div className="section-head">
            <div>
              <h2 className="section-title">惩罚与健康检测</h2>
              <p className="section-subtitle">真实调用连续失败触发惩罚；健康检测始终开启，任一 Key 失败则进不可用区。</p>
            </div>
            <label className="check-row">
              <input checked={draft.penaltyEnabled} onChange={(event) => setDraft((current) => ({ ...current, penaltyEnabled: event.target.checked }))} type="checkbox" />
              开启 9号惩罚规则
            </label>
          </div>
          <div className="grid cols-3">
            <Field label="连续失败几次惩罚" hint="同一 IP 连续调用同一上游失败达到次数后，渠道进入惩罚中。">
              <input className="input" type="number" min={1} max={100} value={draft.penaltyFailureThreshold} onChange={(event) => setNumber("penaltyFailureThreshold", event.target.value)} />
            </Field>
            <Field label="惩罚时长（秒）" hint="惩罚中不可调用，到期后触发健康检测。">
              <input className="input" type="number" min={1} max={86400} value={draft.penaltySeconds} onChange={(event) => setNumber("penaltySeconds", event.target.value)} />
            </Field>
            <Field label="健康检测间隔（秒）" hint="可调用渠道每隔多久检测一次所有 active Key。">
              <input className="input" type="number" min={5} max={3600} value={draft.healthCheckIntervalSeconds} onChange={(event) => setNumber("healthCheckIntervalSeconds", event.target.value)} />
            </Field>
          </div>
        </section>

        <div className="button-row">
          <button className="button" disabled={busy} type="submit">
            <Save size={16} />
            保存调度设置
          </button>
        </div>
      </form>

      <section className="card">
        <div className="section-head">
          <div>
            <h2 className="section-title">IP 等级规则</h2>
            <p className="section-subtitle">IP 等级优先于用户和 Key 等级，支持单 IP 和 IPv4 CIDR。</p>
          </div>
        </div>
        <form className="filter-row" onSubmit={addIpRule}>
          <input className="input" placeholder="例如 1.2.3.4 或 1.2.3.0/24" value={ipDraft.cidrOrIp} onChange={(event) => setIpDraft((current) => ({ ...current, cidrOrIp: event.target.value }))} />
          <select className="input" value={ipDraft.tierId} onChange={(event) => setIpDraft((current) => ({ ...current, tierId: event.target.value }))}>
            {activeTiers.map((tier) => (
              <option key={tier.id} value={tier.id}>{tier.name} ({tier.code})</option>
            ))}
          </select>
          <input className="input" type="number" min={1} max={10000} value={ipDraft.priority} onChange={(event) => setIpDraft((current) => ({ ...current, priority: event.target.value }))} />
          <input className="input" placeholder="备注" value={ipDraft.remark} onChange={(event) => setIpDraft((current) => ({ ...current, remark: event.target.value }))} />
          <button className="button" disabled={busy || activeTiers.length === 0} type="submit">
            <Plus size={16} />
            添加
          </button>
        </form>
        <AdminDataTable
          columns={[
            { accessorKey: "ip", header: "IP/CIDR" },
            { accessorKey: "tier", header: "等级" },
            { accessorKey: "priority", header: "优先级" },
            { accessorKey: "status", header: "状态" },
            { accessorKey: "remark", header: "备注" },
            { accessorKey: "actions", header: "操作" },
          ]}
          data={ruleRows}
          empty="暂无 IP 等级规则"
        />
      </section>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      <small className="muted">{hint}</small>
    </label>
  );
}
