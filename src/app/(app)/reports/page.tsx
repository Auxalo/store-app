import { ReportsScreen } from "@/components/reports/reports-screen";
import { RequirePermission } from "@/components/shared/require-permission";

export default function Page() {
  return (
    <RequirePermission permission="report.view">
      <ReportsScreen />
    </RequirePermission>
  );
}
