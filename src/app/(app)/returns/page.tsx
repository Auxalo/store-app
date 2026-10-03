import { ReturnsScreen } from "@/components/returns/returns-screen";
import { RequirePermission } from "@/components/shared/require-permission";

export default function Page() {
  return (
    <RequirePermission permission="sale.void">
      <ReturnsScreen />
    </RequirePermission>
  );
}
