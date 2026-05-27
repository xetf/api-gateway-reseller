"use client";

import { useQuery } from "@tanstack/react-query";
import { adminFetch, adminQueryKeys, type AdminResource } from "./admin-api";

export function useAdminResource<T>(
  resource: AdminResource,
  path: string,
  enabled = true,
) {
  return useQuery({
    queryKey: adminQueryKeys.resource(resource),
    queryFn: () => adminFetch<T>(path),
    enabled,
  });
}
