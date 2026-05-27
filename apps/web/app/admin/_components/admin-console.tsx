"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import DashboardClient from "../../dashboard-client";
import { AdminConfirmProvider } from "./admin-confirm";

export default function AdminConsole() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 20_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
          mutations: {
            retry: 0,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <AdminConfirmProvider>
        <div className="admin-console-v2">
          <DashboardClient mode="admin" />
        </div>
      </AdminConfirmProvider>
    </QueryClientProvider>
  );
}
