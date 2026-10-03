"use client";

import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect } from "react";
import { useBillingStatus } from "@/billing/client";
import { Skeleton } from "@/components/ui/skeleton";

const BillingScreen = dynamic(
  () => import("./billing-screen").then((m) => m.BillingScreen),
  { loading: () => <Skeleton className="h-64 w-full" /> },
);

/**
 * While the subscription is overdue past its grace days, every screen goes to the billing page.
 * The billing screen is shown at once (nothing of the page underneath appears) and the address
 * changes to /billing. Decided on the device from what the server last said, so it also holds
 * offline; the server refuses the shop's screens anyway (402).
 */
export function BillingGate({ children }: { children: ReactNode }) {
  const { locked } = useBillingStatus();
  const pathname = usePathname();
  const router = useRouter();
  const away = locked && pathname !== "/billing";
  useEffect(() => {
    if (away) router.replace("/billing");
  }, [away, router]);
  return away ? <BillingScreen /> : children;
}
