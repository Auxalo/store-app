import { AdminGate } from "@/components/admin/admin-gate";
import { ShopDetailScreen } from "@/components/admin/shop-detail-screen";

export default function AdminShopPage() {
  return (
    <AdminGate>
      <ShopDetailScreen />
    </AdminGate>
  );
}
