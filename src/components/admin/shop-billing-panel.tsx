"use client";

import { useEffect, useState } from "react";
import type { BillingPlan, PlatformBilling } from "@/billing/plans";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { adminFetch, reasonOf } from "./admin-api";
import { day, dayKey, StateBadge, taka, toPoisha, when } from "./admin-format";
import { PaymentsPanel } from "./payments-panel";
import type { ShopRow } from "./shops-tab";

type Billing = ShopRow["billing"];

/**
 * Everything about one shop's billing: where it stands, its mode, plan, price and grace days, the
 * end date, extra days, a payment taken by hand, and its payments (approve or reject here too).
 */
export function ShopBillingPanel({
  storeId,
  billing,
  onChange,
}: {
  storeId: string;
  billing: Billing;
  onChange: () => Promise<void>;
}) {
  const [plans, setPlans] = useState<BillingPlan[]>([]);
  const [defaults, setDefaults] = useState<PlatformBilling | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [paymentsKey, setPaymentsKey] = useState(0);

  // Editable copies of what the shop has.
  const [planId, setPlanId] = useState(billing.planId ?? "");
  const [price, setPrice] = useState(
    billing.customPrice && billing.price !== null
      ? String(billing.price / 100)
      : "",
  );
  const [grace, setGrace] = useState(
    billing.graceDays === null ? "" : String(billing.graceDays),
  );
  const [until, setUntil] = useState(dayKey(billing.paidUntil));
  const [extra, setExtra] = useState("");
  const [extraReason, setExtraReason] = useState("");
  const [cash, setCash] = useState({
    amount: "",
    months: "1",
    method: "cash",
    trxId: "",
    note: "",
  });

  useEffect(() => {
    void adminFetch<{ settings: PlatformBilling }>(
      "/api/admin/settings/billing",
    ).then((r) => {
      if (r.ok) {
        setPlans(r.data.settings.plans);
        setDefaults(r.data.settings);
      }
    });
  }, []);
  useEffect(() => {
    setPlanId(billing.planId ?? "");
    setUntil(dayKey(billing.paidUntil));
    setGrace(billing.graceDays === null ? "" : String(billing.graceDays));
    setPrice(
      billing.customPrice && billing.price !== null
        ? String(billing.price / 100)
        : "",
    );
  }, [billing]);

  async function call(
    path: string,
    method: string,
    body: unknown,
    done: string,
  ) {
    setBusy(true);
    setError(null);
    setMessage(null);
    const result = await adminFetch(path, { method, body });
    setBusy(false);
    if (!result.ok) {
      setError(reasonOf(result));
      return false;
    }
    setMessage(done);
    await onChange();
    setPaymentsKey((k) => k + 1);
    return true;
  }

  const patch = (body: unknown, done: string) =>
    call(`/api/admin/shops/${storeId}/billing`, "PATCH", body, done);

  async function savePlan() {
    const custom = price.trim() ? toPoisha(price) : null;
    if (price.trim() && !custom) {
      setError(
        "The price must be an amount in taka (or empty for the plan's).",
      );
      return;
    }
    const g = grace.trim() === "" ? null : Number(grace);
    if (g !== null && (!Number.isInteger(g) || g < 0 || g > 60)) {
      setError(
        "Grace days: a whole number up to 60 (or empty for your default).",
      );
      return;
    }
    await patch(
      { planId: planId || null, price: custom, graceDays: g },
      "Plan saved.",
    );
  }

  async function recordCash() {
    const amount = toPoisha(cash.amount);
    const months = Number(cash.months);
    if (!amount || !Number.isInteger(months) || months < 1) {
      setError("Enter the amount received and the months it pays for.");
      return;
    }
    const ok = await call(
      `/api/admin/shops/${storeId}/payments`,
      "POST",
      {
        amount,
        months,
        method: cash.method,
        trxId: cash.trxId,
        note: cash.note,
        planId: planId || undefined,
      },
      "Payment recorded.",
    );
    if (ok) setCash({ ...cash, amount: "", trxId: "", note: "" });
  }

  const modes = [
    ["paid", "Paid"],
    ["free", "Free"],
    ["off", "Billing off"],
  ] as const;

  return (
    <div className="flex flex-col gap-4" data-testid="admin-shop-billing">
      <Card>
        <CardHeader className="flex-row items-center gap-3 space-y-0">
          <CardTitle className="flex-1 text-base">Where it stands</CardTitle>
          <StateBadge state={billing.state} />
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
          <Fact label="Plan" value={billing.planName ?? "—"} />
          <Fact
            label="Price"
            value={`${taka(billing.price)}${billing.customPrice ? " (agreed)" : ""}`}
          />
          <Fact
            label={billing.paidOnce ? "Paid until" : "Trial until"}
            value={day(billing.paidUntil)}
            testId="admin-billing-until"
          />
          <Fact label="Locks" value={day(billing.lockAt)} />
          {billing.provisionalUntil ? (
            <Fact
              label="Let in (payment waiting) until"
              value={when(billing.provisionalUntil)}
            />
          ) : null}
        </CardContent>
      </Card>

      {message ? (
        <p
          role="status"
          className="rounded-lg bg-muted p-3 text-sm"
          data-testid="admin-billing-message"
        >
          {message}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Billing for this shop</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <div className="flex flex-wrap gap-2">
            {modes.map(([mode, label]) => (
              <Button
                key={mode}
                size="sm"
                variant={billing.mode === mode ? "default" : "outline"}
                disabled={busy || billing.mode === mode}
                onClick={() =>
                  void patch(
                    { mode },
                    mode === "paid"
                      ? "Billing is on."
                      : mode === "free"
                        ? "This shop is free now."
                        : "Billing is off for this shop.",
                  )
                }
                data-testid={`admin-mode-${mode}`}
              >
                {label}
              </Button>
            ))}
          </div>
          {billing.mode === "off" && defaults ? (
            <p className="text-xs text-muted-foreground">
              Turning billing on gives the shop a {defaults.newShop.trialDays}
              -day trial first (or set an end date below).
            </p>
          ) : null}

          <div className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[1fr_8rem_7rem_auto]">
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Plan</Label>
              <select
                value={planId}
                onChange={(e) => setPlanId(e.target.value)}
                className="h-9 rounded-md border bg-background px-2 text-sm"
              >
                <option value="">—</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {taka(p.price)}
                    {p.active ? "" : " (hidden)"}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Agreed price (৳)</Label>
              <Input
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="Plan's price"
                inputMode="decimal"
                data-testid="admin-custom-price"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Grace days</Label>
              <Input
                value={grace}
                onChange={(e) => setGrace(e.target.value)}
                placeholder={
                  defaults ? `Default (${defaults.graceDays})` : "Default"
                }
                inputMode="numeric"
                data-testid="admin-grace"
              />
            </div>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void savePlan()}
              data-testid="admin-save-plan"
            >
              Save
            </Button>
          </div>

          <div className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[1fr_auto]">
            <div className="flex flex-col gap-1">
              <Label className="text-xs">
                End date (the shop can use the app until the end of this day)
              </Label>
              <Input
                type="date"
                value={until}
                onChange={(e) => setUntil(e.target.value)}
                data-testid="admin-until"
              />
            </div>
            <Button
              variant="outline"
              disabled={busy || !until}
              onClick={() => void patch({ paidUntil: until }, "End date set.")}
              data-testid="admin-set-until"
            >
              Set end date
            </Button>
          </div>

          {billing.mode === "paid" ? (
            <div className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[7rem_1fr_auto]">
              <div className="flex flex-col gap-1">
                <Label className="text-xs">Extra days</Label>
                <Input
                  value={extra}
                  onChange={(e) => setExtra(e.target.value)}
                  inputMode="numeric"
                  placeholder="7"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs">Why (for your log)</Label>
                <Input
                  value={extraReason}
                  onChange={(e) => setExtraReason(e.target.value)}
                  placeholder="A gift, or to make up for a problem"
                />
              </div>
              <Button
                variant="outline"
                disabled={busy || !Number(extra)}
                onClick={() =>
                  void call(
                    `/api/admin/shops/${storeId}/extend`,
                    "POST",
                    { days: Number(extra), reason: extraReason },
                    `${extra} day(s) given.`,
                  ).then((ok) => ok && setExtra(""))
                }
              >
                Give days
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {billing.mode !== "free" ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Record a payment you received
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 items-end gap-2 text-sm md:grid-cols-[7rem_5rem_7rem_1fr_1fr_auto]">
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Amount (৳)</Label>
              <Input
                value={cash.amount}
                onChange={(e) => setCash({ ...cash, amount: e.target.value })}
                inputMode="decimal"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Months</Label>
              <Input
                value={cash.months}
                onChange={(e) => setCash({ ...cash, months: e.target.value })}
                inputMode="numeric"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">How</Label>
              <select
                value={cash.method}
                onChange={(e) => setCash({ ...cash, method: e.target.value })}
                className="h-9 rounded-md border bg-background px-2 text-sm"
              >
                <option value="cash">Cash</option>
                <option value="bkash">bKash</option>
                <option value="nagad">Nagad</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">TrxID (if any)</Label>
              <Input
                value={cash.trxId}
                onChange={(e) => setCash({ ...cash, trxId: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Note</Label>
              <Input
                value={cash.note}
                onChange={(e) => setCash({ ...cash, note: e.target.value })}
              />
            </div>
            <Button disabled={busy} onClick={() => void recordCash()}>
              Record
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Payments</h3>
        <PaymentsPanel
          key={paymentsKey}
          storeId={storeId}
          onChange={onChange}
        />
      </div>
    </div>
  );
}

function Fact({
  label,
  value,
  testId,
}: {
  label: string;
  value: string;
  testId?: string;
}) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium" data-testid={testId}>
        {value}
      </div>
    </div>
  );
}
