import DashboardClient from "../dashboard-client";

export const dynamic = "force-dynamic";

export default function AdminPage() {
  return <DashboardClient mode="admin" />;
}
