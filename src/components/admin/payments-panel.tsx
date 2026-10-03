"use client";

import { Check, Download, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { adminFetch, reasonOf } from "./admin-api";
import { PaymentBadge, taka, thisMonth, toPoisha, when } from "./admin-format";

export interface PaymentRow {
  id: string;
  storeId: string;
  storeName: string;
  amount: number;
  method: string;
  trxId: string;
  sender: string;
  planId: string | null;
  months: number;
  status: "pending" | "approved" | "rejected";
  submittedAt: string | null;
  submittedBy: string;
  reviewedAt: string | null;
  reviewedBy: string;
  reason: string;
  note: string;
  periodEnd: string | null;
}

type Filter = "pending" | "approved" | "rejected" | "all";

const QUICK_REASONS = [
  "No payment with this transaction id reached us.",
  "The amount is less than the plan price.",
  "The transaction id is wrong. Please check the message and send it again.",
];

/**
 * Payments to check and the history. On the panel's Payments tab it covers every shop (the
 * waiting ones first, oldest first); inside a shop it shows only that shop's.
 */
export function PaymentsPanel({
  storeId,
  onChange,
}: {
  storeId?: string;
  onChange?: () => void;
}) {
  const [filter, setFilter] = useState<Filter>(storeId ? "all" : "pending");
  const [month, setMonth] = useState(storeId ? "" : thisMonth());
  const [rows, setRows] = useState<PaymentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [approving, setApproving] = useState<PaymentRow | null>(null);
  const [rejecting, setRejecting] = useState<PaymentRow | null>(null);

  const query = useCallback(() => {
    const q = new URLSearchParams();
    if (filter !== "all") q.set("status", filter);
    if (storeId) q.set("storeId", storeId);
    else if (filter !== "pending" && month) q.set("month", month);
    return q.toString();
  }, [filter, month, storeId]);

  const load = useCallback(async () => {
    const result = await adminFetch<{ payments: PaymentRow[] }>(
      `/api/admin/payments?${query()}`,
    );
    if (result.ok) setRows(result.data.payments);
    else setError(reasonOf(result));
  }, [query]);

  useEffect(() => {
    setRows(null);
    void load();
  }, [load]);

  const changed = async () => {
    await load();
    onChange?.();
  };

  return (
    <div className="flex flex-col gap-3" data-testid="admin-payments">
      <div className="flex flex-wrap items-center gap-2">
        {(["pending", "approved", "rejected", "all"] as const).map((f) => (
          <Button
            key={f}
            size="sm"
            variant={filter === f ? "default" : "outline"}
            onClick={() => setFilter(f)}
          >
            {f === "pending"
              ? "Waiting"
              : f === "all"
                ? "All"
                : f[0].toUpperCase() + f.slice(1)}
          </Button>
        ))}
        {!storeId && filter !== "pending" ? (
          <Input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="h-8 w-40"
            aria-label="Month"
          />
        ) : null}
        <span className="flex-1" />
        {!storeId ? (
          <Button asChild size="sm" variant="outline">
            <a href={`/api/admin/payments/export?${query()}`}>
              <Download aria-hidden /> CSV
            </a>
          </Button>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {rows === null ? (
        <Skeleton className="h-40 w-full" />
      ) : rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {filter === "pending" ? "No payments waiting." : "No payments."}
        </p>
      ) : (
        <Card className="py-0">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sent</TableHead>
                  {!storeId ? <TableHead>Shop</TableHead> : null}
                  <TableHead className="text-end">Amount</TableHead>
                  <TableHead>Payment</TableHead>
                  <TableHead>Months</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((p) => (
                  <TableRow key={p.id} data-testid="admin-payment-row">
                    <TableCell className="whitespace-nowrap">
                      {when(p.submittedAt)}
                    </TableCell>
                    {!storeId ? (
                      <TableCell>
                        <Link
                          href={`/admin/shop?id=${p.storeId}&tab=billing`}
                          className="font-medium hover:underline"
                        >
                          {p.storeName || p.storeId.slice(0, 8)}
                        </Link>
                      </TableCell>
                    ) : null}
                    <TableCell className="text-end font-semibold tabular-nums">
                      {taka(p.amount)}
                    </TableCell>
                    <TableCell className="text-xs">
                      <div className="font-mono text-sm">{p.trxId || "—"}</div>
                      <div className="text-muted-foreground">
                        {p.method}
                        {p.sender ? ` · from ${p.sender}` : ""}
                        {p.note ? ` · ${p.note}` : ""}
                      </div>
                    </TableCell>
                    <TableCell className="tabular-nums">{p.months}</TableCell>
                    <TableCell>
                      <PaymentBadge status={p.status} />
                      {p.status !== "pending" ? (
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {p.reviewedBy}
                          {p.status === "rejected" && p.reason
                            ? ` · ${p.reason}`
                            : ""}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-end">
                      {p.status === "pending" ? (
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            onClick={() => setApproving(p)}
                            data-testid="admin-approve"
                          >
                            <Check aria-hidden /> Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setRejecting(p)}
                            data-testid="admin-reject"
                          >
                            <X aria-hidden /> Reject
                          </Button>
                        </div>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <ApproveDialog
        payment={approving}
        onClose={() => setApproving(null)}
        onDone={changed}
      />
      <RejectDialog
        payment={rejecting}
        onClose={() => setRejecting(null)}
        onDone={changed}
      />
    </div>
  );
}

function ApproveDialog({
  payment,
  onClose,
  onDone,
}: {
  payment: PaymentRow | null;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [amount, setAmount] = useState("");
  const [months, setMonths] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!payment) return;
    setAmount(String(payment.amount / 100));
    setMonths(String(payment.months));
    setError(null);
  }, [payment]);

  async function approve() {
    if (!payment) return;
    const poisha = toPoisha(amount);
    const m = Number(months);
    if (!poisha || !Number.isInteger(m) || m < 1) {
      setError("Enter the amount received and the months it pays for.");
      return;
    }
    setBusy(true);
    const result = await adminFetch(
      `/api/admin/payments/${payment.id}/approve`,
      { method: "POST", body: { amount: poisha, months: m } },
    );
    setBusy(false);
    if (!result.ok) {
      setError(reasonOf(result));
      return;
    }
    onClose();
    await onDone();
  }

  return (
    <Dialog open={!!payment} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Approve this payment?</DialogTitle>
          <DialogDescription>
            {payment
              ? `${payment.storeName}: ${payment.method} ${payment.trxId}. Check it arrived in your ${payment.method} account first. The shop's period moves on and a locked shop opens.`
              : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="approve-amount">Amount received (৳)</Label>
            <Input
              id="approve-amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="approve-months">Months</Label>
            <Input
              id="approve-months"
              value={months}
              onChange={(e) => setMonths(e.target.value)}
              inputMode="numeric"
            />
          </div>
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <Button
          onClick={() => void approve()}
          disabled={busy}
          data-testid="admin-approve-confirm"
        >
          Approve
        </Button>
      </DialogContent>
    </Dialog>
  );
}

function RejectDialog({
  payment,
  onClose,
  onDone,
}: {
  payment: PaymentRow | null;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (payment) {
      setReason("");
      setError(null);
    }
  }, [payment]);

  async function reject() {
    if (!payment) return;
    if (!reason.trim()) {
      setError("Write the reason; the shop sees it.");
      return;
    }
    setBusy(true);
    const result = await adminFetch(
      `/api/admin/payments/${payment.id}/reject`,
      { method: "POST", body: { reason: reason.trim() } },
    );
    setBusy(false);
    if (!result.ok) {
      setError(reasonOf(result));
      return;
    }
    onClose();
    await onDone();
  }

  return (
    <Dialog open={!!payment} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reject this payment?</DialogTitle>
          <DialogDescription>
            The shop sees the reason. If it was let in while this was checked,
            it is locked again.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-1.5">
          {QUICK_REASONS.map((r) => (
            <Button
              key={r}
              type="button"
              size="sm"
              variant="outline"
              className="h-auto whitespace-normal py-1 text-start text-xs"
              onClick={() => setReason(r)}
            >
              {r}
            </Button>
          ))}
        </div>
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason"
          maxLength={200}
        />
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <Button
          variant="destructive"
          onClick={() => void reject()}
          disabled={busy}
          data-testid="admin-reject-confirm"
        >
          Reject
        </Button>
      </DialogContent>
    </Dialog>
  );
}
