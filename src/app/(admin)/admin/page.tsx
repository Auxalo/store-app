import { AdminGate } from "@/components/admin/admin-gate";
import { ShopsScreen } from "@/components/admin/shops-screen";

export default function AdminPage() {
  return (
    <AdminGate>
      <ShopsScreen />
    </AdminGate>
  );
}
