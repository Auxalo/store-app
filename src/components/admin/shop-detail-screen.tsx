"use client";

import {
  ArrowLeft,
  Download,
  KeyRound,
  PauseCircle,
  PlayCircle,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ActivityPanel } from "./activity-panel";
import { adminFetch, reasonOf } from "./admin-api";
import { StateBadge, when } from "./admin-format";
import { ShopBillingPanel } from "./shop-billing-panel";
import type { ShopRow } from "./shops-tab";

interface Detail extends ShopRow {
  adminNote: string;
  counts: Record<string, number>;
  people: Array<{
    name: string;
    username: string;
    role: string;
    isActive: boolean;
  }>;
}

interface Device {
  id: string;
  code: string;
  name: string;
  createdAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
}

const TABS = ["overview", "billing", "people", "devices", "activity"] as const;
type Tab = (typeof TABS)[number];

function DetailView() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const id = params.get("id") ?? "";
  const asked = params.get("tab") as Tab | null;
  const tab: Tab = asked && TABS.includes(asked) ? asked : "overview";
  const [shop, setShop] = useState<Detail | null | undefined>(undefined);

  const load = useCallback(async () => {
    const result = await adminFetch<{ shop: Detail }>(
      `/api/admin/shops/${encodeURIComponent(id)}`,
    );
    setShop(result.ok ? result.data.shop : null);
  }, [id]);

  useEffect(() => {
    if (id) void load();
    else setShop(null);
  }, [id, load]);

  const go = (next: string) => {
    const search = new URLSearchParams(params);
    search.set("tab", next);
    router.replace(`${pathname}?${search.toString()}`);
  };

  if (shop === undefined) return <Skeleton className="h-60 w-full" />;
  if (shop === null)
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm">Shop not found.</p>
        <Button asChild variant="outline" className="w-fit">
          <Link href="/admin?tab=shops">Back</Link>
        </Button>
      </div>
    );

  const paused = shop.status === "suspended";
  return (
    <div className="flex flex-col gap-4" data-testid="admin-shop-detail">
      <Link
        href="/admin?tab=shops"
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden /> All shops
      </Link>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-xl font-semibold">{shop.name}</h2>
        <Badge
          variant={paused ? "destructive" : "secondary"}
          data-testid="admin-shop-status"
        >
          {paused ? "Paused" : "Active"}
        </Badge>
        <StateBadge state={shop.billing.state} />
        <span className="text-xs text-muted-foreground">id {shop.id}</span>
      </div>

      <Tabs value={tab} onValueChange={go} className="gap-4">
        <div className="-mx-1 overflow-x-auto px-1">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="billing">Billing</TabsTrigger>
            <TabsTrigger value="people">People</TabsTrigger>
            <TabsTrigger value="devices">Devices</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="overview">
          <OverviewPanel shop={shop} onChange={load} />
        </TabsContent>
        <TabsContent value="billing">
          <ShopBillingPanel
            storeId={shop.id}
            billing={shop.billing}
            onChange={load}
          />
        </TabsContent>
        <TabsContent value="people">
          <PeoplePanel shop={shop} />
        </TabsContent>
        <TabsContent value="devices">
          <DevicesPanel storeId={shop.id} />
        </TabsContent>
        <TabsContent value="activity">
          <ActivityPanel storeId={shop.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function OverviewPanel({
  shop,
  onChange,
}: {
  shop: Detail;
  onChange: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [profile, setProfile] = useState({
    name: shop.name,
    contactPhone: shop.contactPhone,
    adminNote: shop.adminNote,
  });
  const paused = shop.status === "suspended";

  async function toggle() {
    const next = paused ? "active" : "suspended";
    const result = await adminFetch(`/api/admin/shops/${shop.id}/status`, {
      method: "POST",
      body: { status: next },
    });
    setConfirming(false);
    setMessage(
      result.ok
        ? next === "suspended"
          ? "Shop paused."
          : "Shop resumed."
        : reasonOf(result),
    );
    await onChange();
  }

  async function resetPassword(form: FormData) {
    const result = await adminFetch(
      `/api/admin/shops/${shop.id}/reset-password`,
      {
        method: "POST",
        body: { password: String(form.get("password") ?? "") },
      },
    );
    if (result.ok) {
      setResetting(false);
      setMessage("The owner's password was changed and they were signed out.");
    } else setMessage(reasonOf(result));
  }

  async function saveProfile() {
    const result = await adminFetch(`/api/admin/shops/${shop.id}`, {
      method: "PATCH",
      body: profile,
    });
    setMessage(result.ok ? "Saved." : reasonOf(result));
    if (result.ok) await onChange();
  }

  return (
    <div className="flex flex-col gap-4">
      {message ? (
        <p
          role="status"
          className="rounded-lg bg-muted p-3 text-sm"
          data-testid="admin-message"
        >
          {message}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          variant={paused ? "default" : "outline"}
          onClick={() => setConfirming(true)}
          data-testid="admin-toggle"
        >
          {paused ? <PlayCircle aria-hidden /> : <PauseCircle aria-hidden />}
          {paused ? "Resume shop" : "Pause shop"}
        </Button>
        <Button
          variant="outline"
          onClick={() => setResetting(true)}
          data-testid="admin-reset"
        >
          <KeyRound aria-hidden /> Reset owner's password
        </Button>
        <Button asChild variant="outline">
          <a
            href={`/api/admin/shops/${encodeURIComponent(shop.id)}/export`}
            data-testid="admin-export"
          >
            <Download aria-hidden /> Download backup
          </a>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">What is in it</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
          {Object.entries(shop.counts).map(([key, value]) => (
            <div key={key}>
              <div className="text-muted-foreground">{key}</div>
              <div className="text-lg font-semibold tabular-nums">{value}</div>
            </div>
          ))}
          <div>
            <div className="text-muted-foreground">last active</div>
            <div className="text-sm font-medium">{when(shop.lastSeenAt)}</div>
          </div>
          <div>
            <div className="text-muted-foreground">created</div>
            <div className="text-sm font-medium">{when(shop.createdAt)}</div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Your notes (the shop never sees these)
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Shop name</Label>
              <Input
                value={profile.name}
                onChange={(e) =>
                  setProfile({ ...profile, name: e.target.value })
                }
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Phone to reach the shop</Label>
              <Input
                value={profile.contactPhone}
                inputMode="tel"
                onChange={(e) =>
                  setProfile({ ...profile, contactPhone: e.target.value })
                }
              />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Notes</Label>
            <Textarea
              value={profile.adminNote}
              maxLength={2000}
              onChange={(e) =>
                setProfile({ ...profile, adminNote: e.target.value })
              }
              placeholder="Address, how they pay, anything to remember"
              data-testid="admin-note"
            />
          </div>
          <Button
            variant="outline"
            className="w-fit"
            onClick={() => void saveProfile()}
            data-testid="admin-save-profile"
          >
            Save
          </Button>
        </CardContent>
      </Card>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {paused ? "Resume this shop?" : "Pause this shop?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {paused
                ? "Its devices and sign-ins work again within a few seconds."
                : "Its devices and sign-ins are refused and the app shows who to contact. Nothing is deleted; it all comes back when you resume."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void toggle()}
              data-testid="admin-confirm"
            >
              {paused ? "Resume" : "Pause"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={resetting} onOpenChange={setResetting}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset the owner's password</DialogTitle>
            <DialogDescription>
              {shop.owner
                ? `${shop.owner.name} (${shop.owner.username}) will be signed out everywhere.`
                : "This shop has no owner."}
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void resetPassword(new FormData(event.currentTarget));
            }}
          >
            <Input
              name="password"
              type="password"
              placeholder="New password (8+ characters)"
              required
              minLength={8}
            />
            <Button type="submit" data-testid="admin-reset-confirm">
              Change password
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PeoplePanel({ shop }: { shop: Detail }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <ul className="divide-y text-sm">
          {shop.people.map((p) => (
            <li
              key={p.username}
              className="flex items-center justify-between gap-2 py-2"
            >
              <span>
                {p.name}{" "}
                <span className="text-muted-foreground">({p.username})</span>
              </span>
              <span className="text-muted-foreground">
                {p.role}
                {p.isActive ? "" : " · deactivated"}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function DevicesPanel({ storeId }: { storeId: string }) {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [revoking, setRevoking] = useState<Device | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await adminFetch<{ devices: Device[] }>(
      `/api/admin/shops/${storeId}/devices`,
    );
    setDevices(result.ok ? result.data.devices : []);
  }, [storeId]);
  useEffect(() => {
    void load();
  }, [load]);

  async function revoke() {
    if (!revoking) return;
    const result = await adminFetch(
      `/api/admin/shops/${storeId}/devices/${revoking.id}/revoke`,
      { method: "POST" },
    );
    setRevoking(null);
    setMessage(result.ok ? "Device revoked." : reasonOf(result));
    await load();
  }

  if (!devices) return <Skeleton className="h-40 w-full" />;
  return (
    <div className="flex flex-col gap-3">
      {message ? (
        <p role="status" className="rounded-lg bg-muted p-3 text-sm">
          {message}
        </p>
      ) : null}
      {devices.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No devices.
        </p>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <ul className="divide-y text-sm" data-testid="admin-devices">
              {devices.map((d) => (
                <li key={d.id} className="flex items-center gap-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{d.name}</span>{" "}
                    <span className="text-muted-foreground">({d.code})</span>
                    <span className="block text-xs text-muted-foreground">
                      last used {when(d.lastSeenAt)} · added {when(d.createdAt)}
                    </span>
                  </span>
                  {d.revokedAt ? (
                    <span className="text-xs text-muted-foreground">
                      revoked {when(d.revokedAt)}
                    </span>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setRevoking(d)}
                    >
                      Revoke
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      <AlertDialog
        open={!!revoking}
        onOpenChange={(open) => !open && setRevoking(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke {revoking?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              It can no longer use the shop (for a lost or stolen phone). It has
              to be signed in again to be used.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void revoke()}>
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function ShopDetailScreen() {
  return (
    <Suspense fallback={<Skeleton className="h-60 w-full" />}>
      <DetailView />
    </Suspense>
  );
}
