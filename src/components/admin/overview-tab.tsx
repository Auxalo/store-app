"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { BillingState } from "@/billing/state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { adminFetch, reasonOf } from "./admin-api";
import { day, StateBadge, stateLabel, taka, when } from "./admin-format";

interface Row {
  id: string;
  name: string;
  state: BillingState;
  paidUntil: string | null;
  lockAt: string | null;
  lastSeenAt: string | null;
}

interface Overview {
  shops: {
    total: number;
    paused: number;
    byState: Record<BillingState, number>;
  };
  pending: number;
  collected: {
    thisMonth: number;
    thisMonthCount: number;
    lastMonth: number;
    lastMonthCount: number;
  };
  expectedMonthly: number;
  attention: {
    ending: Row[];
    overdue: Row[];
    locked: Row[];
    quiet: Row[];
  };
}

function Figure({
  label,
  value,
  hint,
  onClick,
  testId,
}: {
  label: string;
  value: string | number;
  hint?: string;
  onClick?: () => void;
  testId?: string;
}) {
  const body = (
    <>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold tabular-nums" data-testid={testId}>
        {value}
      </div>
      {hint ? (
        <div className="text-xs text-muted-foreground">{hint}</div>
      ) : null}
    </>
  );
  return (
    <Card className="py-0">
      <CardContent className="p-4">
        {onClick ? (
          <button type="button" onClick={onClick} className="w-full text-start">
            {body}
          </button>
        ) : (
          body
        )}
      </CardContent>
    </Card>
  );
}

function AttentionList({
  title,
  rows,
  show,
}: {
  title: string;
  rows: Row[];
  show: (row: Row) => string;
}) {
  if (rows.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {title} <span className="text-muted-foreground">({rows.length})</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y text-sm">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-2 py-2">
              <Link
                href={`/admin/shop?id=${r.id}&tab=billing`}
                className="min-w-0 flex-1 truncate font-medium hover:underline"
              >
                {r.name}
              </Link>
              <span className="text-xs text-muted-foreground">{show(r)}</span>
              <StateBadge state={r.state} />
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/** The first page: how many shops are where, what is waiting, money in, and who needs a look. */
export function OverviewTab({ onOpen }: { onOpen: (tab: string) => void }) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void adminFetch<Overview>("/api/admin/overview").then((r) => {
      if (r.ok) setData(r.data);
      else setError(reasonOf(r));
    });
  }, []);

  if (error)
    return (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    );
  if (!data) return <Skeleton className="h-60 w-full" />;

  const s = data.shops.byState;
  return (
    <div className="flex flex-col gap-4" data-testid="admin-overview">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Figure
          label="Payments to check"
          value={data.pending}
          hint={data.pending ? "Open the queue" : "Nothing waiting"}
          onClick={() => onOpen("payments")}
          testId="admin-pending-count"
        />
        <Figure
          label="Collected this month"
          value={taka(data.collected.thisMonth)}
          hint={`${data.collected.thisMonthCount} payment(s)`}
        />
        <Figure
          label="Last month"
          value={taka(data.collected.lastMonth)}
          hint={`${data.collected.lastMonthCount} payment(s)`}
        />
        <Figure
          label="Expected per month"
          value={taka(data.expectedMonthly)}
          hint="Paying shops at their price"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Shops{" "}
            <span className="text-muted-foreground">({data.shops.total})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {(
            [
              "active",
              "trial",
              "ending",
              "overdue",
              "locked",
              "free",
              "off",
            ] as BillingState[]
          ).map((state) => (
            <span
              key={state}
              className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm"
            >
              <StateBadge state={state} />
              <span className="font-semibold tabular-nums">{s[state]}</span>
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm">
            <span className="rounded-full bg-destructive px-2 py-0.5 text-xs font-medium text-white">
              Paused
            </span>
            <span className="font-semibold tabular-nums">
              {data.shops.paused}
            </span>
          </span>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <AttentionList
          title="Locked"
          rows={data.attention.locked}
          show={(r) => `since ${day(r.lockAt)}`}
        />
        <AttentionList
          title="Overdue (in grace days)"
          rows={data.attention.overdue}
          show={(r) => `locks ${day(r.lockAt)}`}
        />
        <AttentionList
          title={stateLabel("ending")}
          rows={data.attention.ending}
          show={(r) => `ends ${day(r.paidUntil)}`}
        />
        <AttentionList
          title="No activity for 14 days"
          rows={data.attention.quiet}
          show={(r) => (r.lastSeenAt ? `last ${when(r.lastSeenAt)}` : "never")}
        />
      </div>
    </div>
  );
}
