"use client";

import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { BillingPlan, PlatformBilling } from "@/billing/plans";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { adminFetch, reasonOf } from "./admin-api";
import { toPoisha } from "./admin-format";

/** A plan as edited: the price is typed in taka. */
type PlanDraft = Omit<BillingPlan, "price"> & { price: string };

const numberField = (value: string) => {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : null;
};

/** The plans shops can pay for, where they send money, and how billing behaves. */
export function SettingsTab() {
  const [settings, setSettings] = useState<PlatformBilling | null>(null);
  const [plans, setPlans] = useState<PlanDraft[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void adminFetch<{ settings: PlatformBilling }>(
      "/api/admin/settings/billing",
    ).then((r) => {
      if (!r.ok) {
        setError(reasonOf(r));
        return;
      }
      setSettings(r.data.settings);
      setPlans(
        r.data.settings.plans.map((p) => ({
          ...p,
          price: String(p.price / 100),
        })),
      );
    });
  }, []);

  if (!settings)
    return error ? (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    ) : (
      <Skeleton className="h-60 w-full" />
    );

  const set = (patch: Partial<PlatformBilling>) =>
    setSettings({ ...settings, ...patch });
  const setPlan = (index: number, patch: Partial<PlanDraft>) =>
    setPlans(plans.map((p, i) => (i === index ? { ...p, ...patch } : p)));

  async function save() {
    if (!settings) return;
    setError(null);
    setMessage(null);
    const out: BillingPlan[] = [];
    for (const p of plans) {
      const price = toPoisha(p.price);
      if (!price || !p.name.trim() || !p.nameBn.trim() || p.months < 1) {
        setError(
          "Every plan needs a name (English and Bangla), months and a price.",
        );
        return;
      }
      out.push({ ...p, price });
    }
    setBusy(true);
    const result = await adminFetch<{ settings: PlatformBilling }>(
      "/api/admin/settings/billing",
      { method: "PUT", body: { ...settings, plans: out } },
    );
    setBusy(false);
    if (!result.ok) {
      setError(reasonOf(result));
      return;
    }
    setSettings(result.data.settings);
    setMessage("Saved.");
  }

  return (
    <div className="flex flex-col gap-4" data-testid="admin-settings">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Plans</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            What shops can pay for. A hidden plan stays on the shops already
            using it but is no longer offered. A shop can also have its own
            agreed price (on its Billing tab).
          </p>
          {plans.map((plan, i) => (
            <div
              key={plan.id}
              className="grid grid-cols-2 items-end gap-2 rounded-lg border p-3 md:grid-cols-[1fr_1fr_5rem_7rem_auto_auto]"
              data-testid="admin-plan"
            >
              <div className="flex flex-col gap-1">
                <Label className="text-xs">Name</Label>
                <Input
                  value={plan.name}
                  onChange={(e) => setPlan(i, { name: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs">Name (Bangla)</Label>
                <Input
                  value={plan.nameBn}
                  onChange={(e) => setPlan(i, { nameBn: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs">Months</Label>
                <Input
                  type="number"
                  min={1}
                  max={36}
                  value={plan.months}
                  onChange={(e) =>
                    setPlan(i, { months: Number(e.target.value) })
                  }
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs">Price (৳)</Label>
                <Input
                  value={plan.price}
                  inputMode="decimal"
                  onChange={(e) => setPlan(i, { price: e.target.value })}
                  data-testid="admin-plan-price"
                />
              </div>
              <Label className="flex h-9 items-center gap-2 text-sm">
                <Checkbox
                  checked={plan.active}
                  onCheckedChange={(v) => setPlan(i, { active: v === true })}
                />
                Offered
              </Label>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Remove plan"
                disabled={plans.length === 1}
                onClick={() => setPlans(plans.filter((_, j) => j !== i))}
              >
                <Trash2 aria-hidden />
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            className="w-fit"
            onClick={() =>
              setPlans([
                ...plans,
                {
                  id: `p${Date.now().toString(36)}`,
                  name: "",
                  nameBn: "",
                  months: 1,
                  price: "",
                  active: true,
                },
              ])
            }
          >
            <Plus aria-hidden /> Add a plan
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Where shops send money</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {(["bkash", "nagad"] as const).map((m) => (
            <div key={m} className="flex flex-col gap-1">
              <Label className="text-xs">
                {m === "bkash" ? "bKash" : "Nagad"} number (Send Money)
              </Label>
              <Input
                value={settings.payTo[m]}
                inputMode="tel"
                onChange={(e) =>
                  set({ payTo: { ...settings.payTo, [m]: e.target.value } })
                }
              />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Rules</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
          <div className="flex flex-col gap-1">
            <Label className="text-xs">New shops start</Label>
            <select
              value={settings.newShop.mode}
              onChange={(e) =>
                set({
                  newShop: {
                    ...settings.newShop,
                    mode: e.target.value as PlatformBilling["newShop"]["mode"],
                  },
                })
              }
              className="h-9 rounded-md border bg-background px-2 text-sm"
            >
              <option value="paid">With a free trial, then paid</option>
              <option value="free">Free</option>
              <option value="off">Billing off</option>
            </select>
          </div>
          {(
            [
              ["Trial days", "trialDays"],
              ["Grace days after the end", "graceDays"],
              ["Remind this many days before", "reminderDays"],
              ["Hours a locked shop opens after paying", "provisionalHours"],
            ] as const
          ).map(([label, key]) => (
            <div key={key} className="flex flex-col gap-1">
              <Label className="text-xs">{label}</Label>
              <Input
                type="number"
                min={0}
                value={
                  key === "trialDays"
                    ? settings.newShop.trialDays
                    : settings[key]
                }
                onChange={(e) => {
                  const n = numberField(e.target.value);
                  if (n === null) return;
                  if (key === "trialDays")
                    set({ newShop: { ...settings.newShop, trialDays: n } });
                  else set({ [key]: n } as Partial<PlatformBilling>);
                }}
              />
            </div>
          ))}
          <p className="text-xs text-muted-foreground sm:col-span-2 md:col-span-3">
            New grace or reminder days apply to every paying shop at once (a
            shop with its own grace days keeps them).
          </p>
        </CardContent>
      </Card>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {message ? (
        <p role="status" className="text-sm text-emerald-700">
          {message}
        </p>
      ) : null}
      <Button
        onClick={() => void save()}
        disabled={busy}
        className="w-fit"
        data-testid="admin-settings-save"
      >
        Save settings
      </Button>
    </div>
  );
}
