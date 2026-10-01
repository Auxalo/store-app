import { Suspense } from "react";
import { ProductViewScreen } from "@/components/products/product-view-screen";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ProductViewScreen />
    </Suspense>
  );
}
