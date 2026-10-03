import { AdminGate } from "@/components/admin/admin-gate";
import { AdminHome } from "@/components/admin/admin-home";

export default function AdminPage() {
  return (
    <AdminGate>
      <AdminHome />
    </AdminGate>
  );
}
