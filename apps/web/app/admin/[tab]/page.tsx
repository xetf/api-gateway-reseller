import DashboardClient from "../../dashboard-client";

export const dynamic = "force-dynamic";

export default function AdminTabPage() {
  return <DashboardClient mode="admin" />;
}
