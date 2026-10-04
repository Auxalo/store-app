"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
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
import { when } from "./admin-format";

interface Action {
  id: string;
  at: string | null;
  admin: string;
  action: string;
  storeId: string | null;
  detail: string;
}

/** What operators did, newest first: everything, or one shop's. */
export function ActivityPanel({ storeId }: { storeId?: string }) {
  const [actions, setActions] = useState<Action[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = storeId ? `?storeId=${encodeURIComponent(storeId)}` : "";
    void adminFetch<{ actions: Action[] }>(`/api/admin/audit${q}`).then((r) => {
      if (r.ok) setActions(r.data.actions);
      else setError(reasonOf(r));
    });
  }, [storeId]);

  if (error)
    return (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    );
  if (!actions) return <Skeleton className="h-40 w-full" />;
  if (actions.length === 0)
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Nothing yet.
      </p>
    );
  return (
    <Card className="py-0">
      <CardContent className="p-0">
        <Table data-testid="admin-activity">
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Operator</TableHead>
              <TableHead>What</TableHead>
              {!storeId ? <TableHead>Shop</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {actions.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="whitespace-nowrap">
                  {when(a.at)}
                </TableCell>
                <TableCell>{a.admin}</TableCell>
                <TableCell className="whitespace-normal">
                  <span className="font-mono text-xs">{a.action}</span>
                  {a.detail ? ` — ${a.detail}` : ""}
                </TableCell>
                {!storeId ? (
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
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
