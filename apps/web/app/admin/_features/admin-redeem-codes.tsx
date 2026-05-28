"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, RefreshCw, Save, Ticket } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { adminDownload, adminFetch, adminQueryKeys } from "../_components/admin-api";
import { dateTime, money } from "../_components/admin-format";
import { useAdminResource } from "../_components/admin-hooks";
import {
  AdminDataTable,
  AdminPanel,
  MobileEmpty,
  MobileField,
  MobileRecord,
  ModalShell,
  StatusPill,
  StatusTile,
} from "../_components/admin-ui";

type RedeemCode = {
  id: string;
  code?: string;
  codePrefix: string;
  amount: string;
  currency: string;
  status: "ACTIVE" | "DISABLED";
  maxRedemptions: number;
  redeemedCount: number;
  campaignName?: string | null;
  validUserTierId?: string | null;
  validUserTier?: { id: string; code: string; name: string } | null;
  perUserLimit: number;
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

type AccessTier = {
  id: string;
  code: string;
  name: string;
  status: string;
};

function errorToText(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "操作失败，请稍后再试。";
}

export function AdminRedeemCodes({
  onError,
}: {
  onError: (error: string | null) => void;
}) {
  const queryClient = useQueryClient();
  const { data, error, isFetching, refetch } = useAdminResource<{
    codes: RedeemCode[];
  }>("redeemCodes", "/admin/redeem-codes");
  const { data: tiersData } = useAdminResource<{ tiers: AccessTier[] }>(
    "accessTiers",
    "/admin/access-tiers",
  );
  const codes = data?.codes ?? [];
  const activeTiers =
    tiersData?.tiers.filter((tier) => tier.status === "ACTIVE") ?? [];

  const [amount, setAmount] = useState("10");
  const [count, setCount] = useState(1);
  const [maxRedemptions, setMaxRedemptions] = useState(1);
  const [expiryMode, setExpiryMode] = useState<"never" | "custom">("never");
  const [expiresAt, setExpiresAt] = useState("");
  const [remark, setRemark] = useState("");
  const [campaignName, setCampaignName] = useState("");
  const [validUserTierId, setValidUserTierId] = useState("");
  const [perUserLimit, setPerUserLimit] = useState(1);
  const [codeSearch, setCodeSearch] = useState("");
  const [generated, setGenerated] = useState<RedeemCode[]>([]);
  const [redeemModalOpen, setRedeemModalOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const invalidateRedeemCodes = () =>
    queryClient.invalidateQueries({
      queryKey: adminQueryKeys.resource("redeemCodes", "/admin/redeem-codes"),
    });

  const createMutation = useMutation({
    mutationFn: (payload: {
      amount: string;
      count: number;
      maxRedemptions: number;
      remark?: string;
      campaignName: string | null;
      validUserTierId: string | null;
      perUserLimit: number;
      expiresAt: string | null;
    }) =>
      adminFetch<{ codes: RedeemCode[] }>("/admin/redeem-codes", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: (result) => {
      setGenerated(result.codes);
      setRedeemModalOpen(false);
      void invalidateRedeemCodes();
    },
    onError: (createError) => onError(errorToText(createError)),
  });

  const toggleMutation = useMutation({
    mutationFn: (code: RedeemCode) =>
      adminFetch(`/admin/redeem-codes/${code.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: code.status === "ACTIVE" ? "DISABLED" : "ACTIVE",
        }),
      }),
    onSuccess: () => void invalidateRedeemCodes(),
    onError: (updateError) => onError(errorToText(updateError)),
  });

  const filteredCodes = useMemo(
    () =>
      codes.filter((code) =>
        `${code.codePrefix} ${code.amount} ${code.status} ${code.remark ?? ""} ${code.redemptions?.[0]?.user.email ?? ""}`
          .toLowerCase()
          .includes(codeSearch.trim().toLowerCase()),
      ),
    [codeSearch, codes],
  );

  const activeCount = codes.filter((code) => code.status === "ACTIVE").length;
  const redeemedCount = codes.reduce(
    (sum, code) => sum + code.redeemedCount,
    0,
  );

  const redeemColumns = [
    {
      header: "前缀",
      cell: ({ row }: { row: { original: RedeemCode } }) =>
        row.original.codePrefix,
    },
    {
      header: "金额",
      cell: ({ row }: { row: { original: RedeemCode } }) =>
        `$${money(row.original.amount)}`,
    },
    {
      header: "状态",
      cell: ({ row }: { row: { original: RedeemCode } }) => (
        <StatusPill status={row.original.status} />
      ),
    },
    {
      header: "兑换",
      cell: ({ row }: { row: { original: RedeemCode } }) =>
        `${row.original.redeemedCount}/${row.original.maxRedemptions}`,
    },
    {
      header: "活动/限制",
      cell: ({ row }: { row: { original: RedeemCode } }) => {
        const code = row.original;
        return (
          <>
            <strong>{code.campaignName ?? "-"}</strong>
            <span className="muted">
              每用户 {code.perUserLimit} 次 ·{" "}
              {code.validUserTier ? code.validUserTier.name : "不限等级"}
            </span>
          </>
        );
      },
    },
    {
      header: "过期",
      cell: ({ row }: { row: { original: RedeemCode } }) =>
        row.original.expiresAt ? dateTime(row.original.expiresAt) : "-",
    },
    {
      header: "备注",
      cell: ({ row }: { row: { original: RedeemCode } }) =>
        row.original.remark || "-",
    },
    {
      header: "最近兑换",
      cell: ({ row }: { row: { original: RedeemCode } }) =>
        row.original.redemptions?.[0]?.user.email ?? "-",
    },
    {
      id: "actions",
      header: "操作",
      cell: ({ row }: { row: { original: RedeemCode } }) => {
        const code = row.original;
        return (
          <button
            className="button secondary"
            disabled={toggleMutation.isPending}
            onClick={() => {
              onError(null);
              toggleMutation.mutate(code);
            }}
            type="button"
          >
            {code.status === "ACTIVE" ? "停用" : "启用"}
          </button>
        );
      },
    },
  ];

  async function createCodes(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onError(null);
    createMutation.mutate({
      amount,
      count: Number(count),
      maxRedemptions: Number(maxRedemptions),
      remark: remark || undefined,
      campaignName: campaignName || null,
      validUserTierId: validUserTierId || null,
      perUserLimit: Number(perUserLimit),
      expiresAt:
        expiryMode === "custom" && expiresAt
          ? new Date(expiresAt).toISOString()
          : null,
    });
  }

  async function exportRedeemCodes() {
    setExporting(true);
    onError(null);
    try {
      await adminDownload(
        "/admin/redeem-codes/export",
        `redeem-codes-${new Date().toISOString().slice(0, 10)}.csv`,
      );
    } catch (exportError) {
      onError(errorToText(exportError));
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <div className="grid admin-page admin-redeem-page">
        <section className="admin-hero-panel">
          <div>
            <span className="eyebrow">Campaign Credits</span>
            <h2>兑换码工作台</h2>
            <p>集中管理活动额度、等级限制、过期策略、导出与启停状态。</p>
          </div>
          <div className="admin-hero-status">
            <StatusTile label="全部兑换码" ok={undefined} value={`${codes.length} 个`} />
            <StatusTile label="启用中" ok={activeCount > 0 ? true : undefined} value={`${activeCount} 个`} />
            <StatusTile label="已兑换次数" ok={redeemedCount > 0 ? true : undefined} value={`${redeemedCount} 次`} />
          </div>
        </section>

        {generated.length > 0 ? (
          <section className="card generated-code-card">
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

        <AdminPanel
          className="redeem-list-panel"
          title="兑换码列表"
          description="按前缀、金额、状态或兑换用户查找。"
          actions={
            <>
              <button
                className="button"
                onClick={() => setRedeemModalOpen(true)}
                type="button"
              >
                <Plus size={17} />
                生成兑换码
              </button>
              <button
                className="button secondary"
                disabled={isFetching}
                onClick={() => void refetch()}
                type="button"
              >
                <RefreshCw size={17} />
                {isFetching ? "刷新中..." : "刷新"}
              </button>
              <button
                className="button secondary"
                disabled={exporting || codes.length === 0}
                onClick={exportRedeemCodes}
                type="button"
              >
                <Save size={17} />
                {exporting ? "导出中..." : "导出 CSV"}
              </button>
              <input
                className="input search-input"
                value={codeSearch}
                onChange={(event) => setCodeSearch(event.target.value)}
                placeholder="搜索兑换码"
              />
            </>
          }
        >
          {error ? <p className="form-error">{errorToText(error)}</p> : null}
          <AdminDataTable
            columns={redeemColumns}
            data={filteredCodes}
            empty="暂无兑换码"
          />
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
                    disabled={toggleMutation.isPending}
                    onClick={() => {
                      onError(null);
                      toggleMutation.mutate(code);
                    }}
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
                <MobileField label="活动" wide>
                  {code.campaignName || "-"} · 每用户 {code.perUserLimit} 次 ·{" "}
                  {code.validUserTier?.name ?? "不限等级"}
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
        </AdminPanel>
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
              <div className="grid cols-3">
                <label className="field">
                  <span>活动名称</span>
                  <input
                    className="input"
                    value={campaignName}
                    onChange={(event) => setCampaignName(event.target.value)}
                    placeholder="例如：端午活动"
                  />
                </label>
                <label className="field">
                  <span>每用户限制</span>
                  <input
                    className="input"
                    min={1}
                    max={Math.max(1, Number(maxRedemptions) || 1)}
                    value={perUserLimit}
                    onChange={(event) =>
                      setPerUserLimit(Number(event.target.value))
                    }
                    type="number"
                  />
                </label>
                <label className="field">
                  <span>限制等级</span>
                  <select
                    className="input"
                    value={validUserTierId}
                    onChange={(event) => setValidUserTierId(event.target.value)}
                  >
                    <option value="">不限等级</option>
                    {activeTiers.map((tier) => (
                      <option key={tier.id} value={tier.id}>
                        {tier.name} ({tier.code})
                      </option>
                    ))}
                  </select>
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
              <button
                className="button"
                disabled={createMutation.isPending}
                type="submit"
              >
                <Ticket size={17} />
                {createMutation.isPending ? "生成中..." : "生成"}
              </button>
            </div>
          </form>
        </ModalShell>
      ) : null}
    </>
  );
}
