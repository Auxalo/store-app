import { MoneyScreen } from "@/components/money/money-screen";
import { RequirePermission } from "@/components/shared/require-permission";

export default function Page() {
  return (
    <RequirePermission permission="report.view">
      <MoneyScreen />
    </RequirePermission>
  );
}
