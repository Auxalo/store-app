import { Suspense } from "react";
import { ProductFormScreen } from "@/components/products/product-form-screen";

// useSearchParams needs a Suspense boundary for the page to be prerendered (and so work offline).
export default function Page() {
  return (
    <Suspense fallback={null}>
      <ProductFormScreen />
    </Suspense>
  );
}
