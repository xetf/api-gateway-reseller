"use client";

import { Ticket } from "lucide-react";
import { type FormEvent, useState } from "react";
import { apiFetch } from "../../../lib/api";
import { dateTime, money } from "../../admin/_components/admin-format";
import { AdminDataTable, AdminPanel, Metric, MobileEmpty, MobileField, MobileRecord } from "../../admin/_components/admin-ui";

export type Wallet = {
  id: string;
  balance: string;
  reservedBalance?: string;
  currency: string;
};

export type Transaction = {
  id: string;
  type: string;
  amount: string;
  balanceBefore: string;
  balanceAfter: string;
  remark?: string | null;
  createdAt: string;
};

function errorToText(error: unknown) { return error instanceof Error ? error.message : "未知错误"; }

export function WalletView({
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
  const transactionRows = transactions.map((item) => ({
    id: item.id,
    type: item.type,
    amount: money(item.amount),
    balanceBefore: money(item.balanceBefore),
    balanceAfter: money(item.balanceAfter),
    remark: item.remark,
    createdAt: dateTime(item.createdAt),
  }));

  return (
    <AdminPanel title="账本流水">
      <AdminDataTable
        columns={[
          { accessorKey: "type", header: "类型" },
          { accessorKey: "amount", header: "金额" },
          { accessorKey: "balanceBefore", header: "之前" },
          { accessorKey: "balanceAfter", header: "之后" },
          { accessorKey: "remark", header: "备注" },
          { accessorKey: "createdAt", header: "时间" },
        ]}
        data={transactionRows}
        empty="暂无账本流水"
      />
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
    </AdminPanel>
  );
}
