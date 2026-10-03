"use client";

import { Plus, Search } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { BillingState } from "@/billing/state";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { adminFetch, reasonOf } from "./admin-api";
import {
  BILLING_STATES,
  day,
  StateBadge,
  stateLabel,
  taka,
  when,
} from "./admin-format";

export interface ShopRow {
  id: string;
  name: string;
  status: "active" | "suspended";
  createdAt: string | null;
  owner: { name: string; username: string } | null;
  devices: number;
  lastSeenAt: string | null;
  contactPhone: string;
  billing: {
    mode: "off" | "free" | "paid";
    state: BillingState;
    planId: string | null;
    planName: string | null;
    price: number | null;
    customPrice: boolean;
    months: number | null;
    paidOnce: boolean;
    paidUntil: string | null;
    lockAt: string | null;
    graceDays: number | null;
    provisionalUntil: string | null;
    daysLeft: number | null;
  };
}

type Filter = BillingState | "paused" | "all";
type Sort = "newest" | "ends" | "active";

/** Every shop, with its billing, findable by name, owner or phone and filtered by where it stands. */
export function ShopsTab() {
  const [shops, setShops] = useState<ShopRow[] | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("newest");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (q: string) => {
    const result = await adminFetch<{ shops: ShopRow[] }>(
      `/api/admin/shops?q=${encodeURIComponent(q)}`,
    );
    if (result.ok) setShops(result.data.shops);
    else setError(reasonOf(result));
  }, []);

  useEffect(() => {
    void load("");
  }, [load]);

  const shown = useMemo(() => {
    const rows = (shops ?? []).filter((s) =>
      filter === "all"
        ? true
        : filter === "paused"
          ? s.status === "suspended"
          : s.billing.state === filter,
    );
    const time = (iso: string | null, empty: number) =>
      iso ? Date.parse(iso) : empty;
    if (sort === "ends")
      rows.sort(
        (a, b) =>
          time(a.billing.paidUntil, Number.MAX_SAFE_INTEGER) -
          time(b.billing.paidUntil, Number.MAX_SAFE_INTEGER),
      );
    else if (sort === "active")
      rows.sort((a, b) => time(b.lastSeenAt, 0) - time(a.lastSeenAt, 0));
    return rows;
  }, [shops, filter, sort]);

  const count = (f: Filter) =>
    (shops ?? []).filter((s) =>
      f === "all"
        ? true
        : f === "paused"
          ? s.status === "suspended"
          : s.billing.state === f,
    ).length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <form
          className="flex min-w-0 flex-1 gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void load(query);
          }}
        >
          <div className="relative min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Shop name, owner or phone"
              className="ps-9"
              data-testid="admin-search"
            />
          </div>
          <Button type="submit" variant="outline">
            Search
          </Button>
        </form>
        <Button onClick={() => setCreating(true)} data-testid="admin-new-shop">
          <Plus aria-hidden /> New shop
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {(["all", ...BILLING_STATES, "paused"] as Filter[]).map((f) => (
          <Button
            key={f}
            size="sm"
            variant={filter === f ? "default" : "outline"}
            className="h-7"
            onClick={() => setFilter(f)}
          >
            {f === "all" ? "All" : f === "paused" ? "Paused" : stateLabel(f)}
            <span className="ms-1 tabular-nums opacity-70">{count(f)}</span>
          </Button>
        ))}
        <span className="flex-1" />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as Sort)}
          className="h-7 rounded-md border bg-background px-2 text-sm"
          aria-label="Sort"
        >
          <option value="newest">Newest first</option>
          <option value="ends">Ends soonest</option>
          <option value="active">Last active</option>
        </select>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {shops === null ? (
        <Skeleton className="h-40 w-full" />
      ) : shown.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          No shops.
        </p>
      ) : (
        <Card className="py-0">
          <CardContent className="p-0">
            <Table data-testid="admin-shops">
              <TableHeader>
                <TableRow>
                  <TableHead>Shop</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Billing</TableHead>
                  <TableHead>Ends</TableHead>
                  <TableHead className="text-end">Devices</TableHead>
                  <TableHead>Last active</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((s) => (
                  <TableRow key={s.id} data-testid="admin-shop-row">
                    <TableCell className="font-medium">
                      <Link
                        href={`/admin/shop?id=${s.id}`}
                        className="hover:underline"
                      >
                        {s.name}
                      </Link>
                      {s.status === "suspended" ? (
                        <span className="ms-2 rounded-full bg-destructive px-2 py-0.5 text-xs font-medium text-white">
                          Paused
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-sm">
                      {s.owner ? (
                        <>
                          {s.owner.name}{" "}
                          <span className="text-muted-foreground">
                            ({s.owner.username})
                          </span>
                        </>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <StateBadge state={s.billing.state} />
                        {s.billing.mode === "paid" ? (
                          <span className="text-xs text-muted-foreground">
                            {s.billing.planName ?? ""}
                            {s.billing.price !== null
                              ? ` · ${taka(s.billing.price)}`
                              : ""}
                            {s.billing.customPrice ? "*" : ""}
                          </span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      {s.billing.mode === "paid" ? (
                        <>
                          {day(s.billing.paidUntil)}
                          {s.billing.daysLeft !== null &&
                          s.billing.state !== "locked" ? (
                            <span className="ms-1 text-xs text-muted-foreground">
                              ({s.billing.daysLeft}d)
                            </span>
                          ) : null}
                        </>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-end tabular-nums">
                      {s.devices}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      {when(s.lastSeenAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <NewShopDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={() => load(query)}
      />
    </div>
  );
}

function NewShopDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [start, setStart] = useState<"trial" | "free" | "off" | "until">(
    "trial",
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create(form: FormData) {
    setError(null);
    const trialDays = Number(form.get("trialDays") ?? "");
    const until = String(form.get("until") ?? "");
    const billing =
      start === "trial"
        ? {
            mode: "paid",
            ...(form.get("trialDays") ? { trialDays } : {}),
          }
        : start === "until"
          ? { mode: "paid", paidUntil: until }
          : { mode: start };
    setBusy(true);
    const result = await adminFetch<{ storeId: string }>("/api/admin/shops", {
      method: "POST",
      body: {
        storeName: String(form.get("storeName") ?? ""),
        ownerName: String(form.get("ownerName") ?? ""),
        username: String(form.get("username") ?? ""),
        password: String(form.get("password") ?? ""),
        billing,
      },
    });
    setBusy(false);
    if (!result.ok) {
      setError(reasonOf(result));
      return;
    }
    onClose();
    await onCreated();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New shop</DialogTitle>
          <DialogDescription>
            Creates the shop and its owner account.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void create(new FormData(event.currentTarget));
          }}
        >
          <Input name="storeName" placeholder="Shop name" required />
          <Input name="ownerName" placeholder="Owner's name" required />
          <Input
            name="username"
            placeholder="Username (a phone number works)"
            autoCapitalize="none"
            required
          />
          <Input
            name="password"
            type="password"
            placeholder="Password (8+ characters)"
            required
          />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-shop-billing">Billing starts with</Label>
            <select
              id="new-shop-billing"
              value={start}
              onChange={(e) => setStart(e.target.value as typeof start)}
              className="h-9 rounded-md border bg-background px-2 text-sm"
              data-testid="admin-new-shop-billing"
            >
              <option value="trial">A free trial, then paid</option>
              <option value="until">Paid until a date</option>
              <option value="free">Free (never pays)</option>
              <option value="off">Billing off</option>
            </select>
          </div>
          {start === "trial" ? (
            <Input
              name="trialDays"
              type="number"
              min={0}
              max={365}
              placeholder="Trial days (empty = your default)"
            />
          ) : null}
          {start === "until" ? (
            <Input name="until" type="date" required aria-label="Paid until" />
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <Button type="submit" disabled={busy} data-testid="admin-create-shop">
            Create shop
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
