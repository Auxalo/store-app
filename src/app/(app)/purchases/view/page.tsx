import { Suspense } from "react";
import { PurchaseViewScreen } from "@/components/purchases/purchase-view-screen";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <PurchaseViewScreen />
    </Suspense>
  );
}
