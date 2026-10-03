"use client";

import { Plus, Search } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
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

interface Shop {
  id: string;
  name: string;
  status: "active" | "suspended";
  createdAt: string | null;
  owner: { name: string; username: string } | null;
  devices: number;
  lastSeenAt: string | null;
}

interface Action {
  id: string;
  at: string | null;
  admin: string;
  action: string;
  storeId: string | null;
  detail: string;
}

const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";

export function ShopsScreen() {
  const [tab, setTab] = useState<"shops" | "activity">("shops");
  const [shops, setShops] = useState<Shop[] | null>(null);
  const [actions, setActions] = useState<Action[] | null>(null);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (q: string) => {
    const result = await adminFetch<{ shops: Shop[] }>(
      `/api/admin/shops?q=${encodeURIComponent(q)}`,
    );
    if (result.ok) setShops(result.data.shops);
    else setError(reasonOf(result));
  }, []);

  useEffect(() => {
    void load("");
  }, [load]);

  useEffect(() => {
    if (tab !== "activity") return;
    void adminFetch<{ actions: Action[] }>("/api/admin/audit").then((r) => {
      if (r.ok) setActions(r.data.actions);
    });
  }, [tab]);

  async function createShop(form: FormData) {
    setError(null);
    const result = await adminFetch<{ storeId: string }>("/api/admin/shops", {
      method: "POST",
      body: {
        storeName: String(form.get("storeName") ?? ""),
        ownerName: String(form.get("ownerName") ?? ""),
        username: String(form.get("username") ?? ""),
        password: String(form.get("password") ?? ""),
      },
    });
    if (!result.ok) {
      setError(reasonOf(result));
      return;
    }
    setCreating(false);
    await load(query);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={tab === "shops" ? "default" : "outline"}
          size="sm"
          onClick={() => setTab("shops")}
        >
          Shops
        </Button>
        <Button
          variant={tab === "activity" ? "default" : "outline"}
          size="sm"
          onClick={() => setTab("activity")}
        >
          Activity
        </Button>
        <span className="flex-1" />
        {tab === "shops" ? (
          <Button
            size="sm"
            onClick={() => setCreating(true)}
            data-testid="admin-new-shop"
          >
            <Plus aria-hidden /> New shop
          </Button>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {tab === "shops" ? (
        <>
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void load(query);
            }}
          >
            <div className="relative flex-1">
              <Search
                className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by shop name"
                className="ps-9"
                data-testid="admin-search"
              />
            </div>
            <Button type="submit" variant="outline">
              Search
            </Button>
          </form>

          {shops === null ? (
            <Skeleton className="h-40 w-full" />
          ) : shops.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No shops.
            </p>
          ) : (
            <Card>
              <CardContent className="p-0">
                <Table data-testid="admin-shops">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Shop</TableHead>
                      <TableHead>Owner</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-end">Devices</TableHead>
                      <TableHead>Last active</TableHead>
                      <TableHead>Created</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {shops.map((s) => (
                      <TableRow key={s.id} data-testid="admin-shop-row">
                        <TableCell className="font-medium">
                          <Link
                            href={`/admin/shop?id=${s.id}`}
                            className="hover:underline"
                          >
                            {s.name}
                          </Link>
                        </TableCell>
                        <TableCell>
                          {s.owner
                            ? `${s.owner.name} (${s.owner.username})`
                            : "—"}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              s.status === "suspended"
                                ? "destructive"
                                : "secondary"
                            }
                          >
                            {s.status === "suspended" ? "Paused" : "Active"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-end tabular-nums">
                          {s.devices}
                        </TableCell>
                        <TableCell>{when(s.lastSeenAt)}</TableCell>
                        <TableCell>{when(s.createdAt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      ) : actions === null ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table data-testid="admin-activity">
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Operator</TableHead>
                  <TableHead>What</TableHead>
                  <TableHead>Shop</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {actions.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>{when(a.at)}</TableCell>
                    <TableCell>{a.admin}</TableCell>
                    <TableCell>
                      {a.action}
                      {a.detail ? ` — ${a.detail}` : ""}
                    </TableCell>
                    <TableCell>
                      {a.storeId ? (
                        <Link
                          href={`/admin/shop?id=${a.storeId}`}
                          className="hover:underline"
                        >
                          {a.storeId.slice(0, 8)}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Dialog open={creating} onOpenChange={setCreating}>
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
              void createShop(new FormData(event.currentTarget));
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
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <Button type="submit" data-testid="admin-create-shop">
              Create shop
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
