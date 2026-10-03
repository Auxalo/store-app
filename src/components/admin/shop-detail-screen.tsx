"use client";

import {
  ArrowLeft,
  Download,
  KeyRound,
  PauseCircle,
  PlayCircle,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
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
import { Skeleton } from "@/components/ui/skeleton";
import { adminFetch, reasonOf } from "./admin-api";

interface Detail {
  id: string;
  name: string;
  status: "active" | "suspended";
  createdAt: string | null;
  lastSeenAt: string | null;
  owner: { name: string; username: string } | null;
  counts: Record<string, number>;
  people: Array<{
    name: string;
    username: string;
    role: string;
    isActive: boolean;
  }>;
}

const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";

function Detail() {
  const id = useSearchParams().get("id") ?? "";
  const [shop, setShop] = useState<Detail | null | undefined>(undefined);
  const [confirming, setConfirming] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

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

  async function toggle() {
    if (!shop) return;
    const next = shop.status === "active" ? "suspended" : "active";
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
    await load();
  }

  async function resetPassword(form: FormData) {
    if (!shop) return;
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

  if (shop === undefined) return <Skeleton className="h-60 w-full" />;
  if (shop === null)
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm">Shop not found.</p>
        <Button asChild variant="outline" className="w-fit">
          <Link href="/admin">Back</Link>
        </Button>
      </div>
    );

  const paused = shop.status === "suspended";
  return (
    <div className="flex flex-col gap-4" data-testid="admin-shop-detail">
      <Link
        href="/admin"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden /> All shops
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-semibold">{shop.name}</h2>
        <Badge
          variant={paused ? "destructive" : "secondary"}
          data-testid="admin-shop-status"
        >
          {paused ? "Paused" : "Active"}
        </Badge>
        <span className="text-xs text-muted-foreground">id {shop.id}</span>
      </div>
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
        <CardContent className="grid grid-cols-2 gap-3 text-sm md:grid-cols-3">
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
          <CardTitle className="text-base">People</CardTitle>
        </CardHeader>
        <CardContent>
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

export function ShopDetailScreen() {
  return (
    <Suspense fallback={<Skeleton className="h-60 w-full" />}>
      <Detail />
    </Suspense>
  );
}
