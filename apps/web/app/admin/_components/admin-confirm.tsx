"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

type ConfirmOptions = {
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
};

type PendingConfirm = ConfirmOptions & {
  resolve: (confirmed: boolean) => void;
};

const AdminConfirmContext = createContext<
  ((options: ConfirmOptions) => Promise<boolean>) | null
>(null);

let externalConfirm: ((options: ConfirmOptions) => Promise<boolean>) | null =
  null;

export function confirmAdminAction(options: ConfirmOptions) {
  if (externalConfirm) {
    return externalConfirm(options);
  }

  return Promise.resolve(false);
}

export function AdminConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  const confirm = useMemo(
    () => (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setPending({ ...options, resolve });
      }),
    [],
  );

  externalConfirm = confirm;

  function close(confirmed: boolean) {
    const current = pending;
    setPending(null);
    current?.resolve(confirmed);
  }

  return (
    <AdminConfirmContext.Provider value={confirm}>
      {children}
      <Dialog.Root open={Boolean(pending)} onOpenChange={(open) => !open && close(false)}>
        <Dialog.Portal>
          <Dialog.Overlay className="admin-confirm-backdrop" />
          <Dialog.Content className="admin-confirm-dialog">
            <Dialog.Title className="admin-confirm-title">
              {pending?.title ?? "确认操作"}
            </Dialog.Title>
            {pending?.description ? (
              <Dialog.Description className="admin-confirm-description">
                {pending.description}
              </Dialog.Description>
            ) : null}
            <div className="admin-confirm-actions">
              <Dialog.Close className="button secondary" type="button">
                {pending?.cancelText ?? "取消"}
              </Dialog.Close>
              <button
                className={pending?.danger ? "button danger" : "button"}
                onClick={() => close(true)}
                type="button"
              >
                {pending?.confirmText ?? "确认"}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </AdminConfirmContext.Provider>
  );
}

export function useAdminConfirm() {
  const confirm = useContext(AdminConfirmContext);
  if (!confirm) {
    throw new Error("useAdminConfirm must be used inside AdminConfirmProvider");
  }
  return confirm;
}
