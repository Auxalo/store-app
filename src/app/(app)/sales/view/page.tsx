import { Suspense } from "react";
import { SaleViewScreen } from "@/components/sales/sale-view-screen";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <SaleViewScreen />
    </Suspense>
  );
}
