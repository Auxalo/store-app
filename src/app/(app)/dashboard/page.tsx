import { DashboardScreen } from "@/components/dashboard/dashboard-screen";
import { RequirePermission } from "@/components/shared/require-permission";

export default function Page() {
  return (
    <RequirePermission permission="dashboard.view">
      <DashboardScreen />
    </RequirePermission>
  );
}
