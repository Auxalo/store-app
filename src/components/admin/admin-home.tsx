"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ActivityPanel } from "./activity-panel";
import { adminFetch } from "./admin-api";
import { OverviewTab } from "./overview-tab";
import { PaymentsPanel } from "./payments-panel";
import { SettingsTab } from "./settings-tab";
import { ShopsTab } from "./shops-tab";

const TABS = ["overview", "shops", "payments", "activity", "settings"] as const;
type Tab = (typeof TABS)[number];

function Home() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const asked = params.get("tab") as Tab | null;
  const tab: Tab = asked && TABS.includes(asked) ? asked : "overview";
  const [pending, setPending] = useState<number | null>(null);

  const refreshPending = useCallback(async () => {
    const result = await adminFetch<{ payments: unknown[] }>(
      "/api/admin/payments?status=pending",
    );
    if (result.ok) setPending(result.data.payments.length);
  }, []);
  useEffect(() => {
    void refreshPending();
  }, [refreshPending]);

  const go = (next: string) => {
    const search = new URLSearchParams(params);
    search.set("tab", next);
    router.replace(`${pathname}?${search.toString()}`);
  };

  return (
    <Tabs value={tab} onValueChange={go} className="gap-4">
      <div className="-mx-1 overflow-x-auto px-1">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="shops">Shops</TabsTrigger>
          <TabsTrigger value="payments" data-testid="admin-tab-payments">
            Payments
            {pending ? (
              <span className="ms-1 rounded-full bg-amber-500 px-1.5 text-[11px] font-semibold text-white">
                {pending}
              </span>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="overview">
        <OverviewTab onOpen={go} />
      </TabsContent>
      <TabsContent value="shops">
        <ShopsTab />
      </TabsContent>
      <TabsContent value="payments">
        <PaymentsPanel onChange={refreshPending} />
      </TabsContent>
      <TabsContent value="activity">
        <ActivityPanel />
      </TabsContent>
      <TabsContent value="settings">
        <SettingsTab />
      </TabsContent>
    </Tabs>
  );
}

/** The operator's panel: overview, shops, payments to check, what was done, and settings. */
export function AdminHome() {
  return (
    <Suspense fallback={<Skeleton className="h-60 w-full" />}>
      <Home />
    </Suspense>
  );
}
