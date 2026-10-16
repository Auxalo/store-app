"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { ChevronDown, ChevronUp, Wallet } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { can } from "@/auth/permissions";
import { useProfile } from "@/auth/use-auth";
import { MoneyField } from "@/components/pos/money-field";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCommand } from "@/data/hooks";
import { getLocalDb } from "@/db/local/db";
import { useFormat } from "@/i18n/use-format";
import { newId } from "@/lib/ids";
import { cn } from "@/lib/utils";
import { dayKey } from "@/reports/compute";
import { useCash } from "@/reports/use-cash";
import { useActiveUser } from "@/stores/active-user";
import { usePreferences } from "@/stores/preferences";

/**
 * The cash that should be in the drawer now. The owner or a manager sets the opening amount when
 * the shop opens; every cash sale, refund, due collected, purchase, supplier payment and expense
 * then moves it, and it starts again the next day. Only the owner can correct the opening; each
 * entry stays in the day's log.
 */
export function CashDrawerCard() {
  const t = useTranslations("dashboard");
  const f = useFormat();
  const run = useCommand();
  const profile = useProfile();
  const timeZone = usePreferences((s) => s.timeZone);

  // The shop's day, kept right across midnight.
  const [day, setDay] = useState(() => dayKey(Date.now(), timeZone));
  useEffect(() => {
    const tick = () => setDay(dayKey(Date.now(), timeZone));
    tick();
    const timer = setInterval(tick, 60_000);
    return () => clearInterval(timer);
  }, [timeZone]);

  const cash = useCash(day);
  const activeUserId = useActiveUser((s) => s.activeUserId);
  const person = useLiveQuery(
    () =>
      activeUserId ? getLocalDb().localUsers.get(activeUserId) : undefined,
    [activeUserId],
  );
  const byName = person?.name ?? profile.name;

  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [details, setDetails] = useState(false);

  const canOpen = can(profile.role, "drawer.open");
  const canCorrect = can(profile.role, "drawer.correct");
  if (!canOpen) return null;

  const isSet = cash?.opening != null;
  const form = !isSet || editing;
  // Until the opening is set (and nothing has moved), a big "৳০" says nothing: only the form shows.
  const showFigure =
    !!cash && (isSet || cash.flow.totalIn !== 0 || cash.flow.totalOut !== 0);

  async function save() {
    if (amount === null || saving) return;
    setSaving(true);
    try {
      await run("drawer.set", { id: newId(), day, amount, byName });
      setEditing(false);
      setAmount(null);
    } catch {
      toast.error(t("drawerSaveFailed"));
    } finally {
      setSaving(false);
    }
  }

  const flow = cash?.flow;
  const lines: Array<[string, string, number]> = flow
    ? [
        ["sales", t("drawerSales"), flow.sales],
        ["dues", t("drawerDues"), flow.customerPayments],
        ["supplierBack", t("drawerSupplierBack"), flow.supplierRefunds],
        ["refunds", t("drawerRefunds"), -flow.customerRefunds],
        ["purchases", t("drawerPurchases"), -flow.purchases],
        ["supplierPaid", t("drawerSupplierPaid"), -flow.supplierPayments],
        ["expenses", t("drawerExpenses"), -flow.expenses],
      ]
    : [];

  return (
    <section
      className="flex flex-col gap-3 rounded-2xl border bg-card p-4"
      data-testid="cash-drawer"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Wallet className="size-4 text-primary" aria-hidden />
          {t("drawerTitle")}
        </h2>
        {isSet && !editing ? (
          canCorrect ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setAmount(cash?.opening ?? null);
                setEditing(true);
              }}
              data-testid="drawer-correct"
            >
              {t("drawerCorrect")}
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">
              {t("drawerOnlyOwner")}
            </span>
          )
        ) : null}
      </div>

      {!cash ? (
        <Skeleton className="h-14 w-full" />
      ) : (
        <>
          {form ? (
            <div
              className="flex flex-col gap-2 rounded-xl border border-primary/40 bg-primary/5 p-3"
              data-testid="drawer-form"
            >
              <p className="text-sm font-medium">
                {isSet ? t("drawerCorrectTitle") : t("drawerSetPrompt")}
              </p>
              {!isSet ? (
                <p className="text-xs text-muted-foreground">
                  {t("drawerSetHint")}
                </p>
              ) : null}
              <div className="flex items-center gap-2">
                <MoneyField
                  aria-label={t("drawerAmount")}
                  value={amount}
                  onValue={setAmount}
                  placeholder="0"
                  className="h-10 flex-1"
                  data-testid="drawer-amount"
                />
                <Button
                  onClick={() => void save()}
                  disabled={amount === null || saving}
                  data-testid="drawer-save"
                >
                  {t("drawerSave")}
                </Button>
                {editing ? (
                  <Button variant="ghost" onClick={() => setEditing(false)}>
                    {t("drawerCancel")}
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}

          {showFigure ? (
            <>
              <div>
                <p className="text-xs text-muted-foreground">
                  {t("drawerExpected")}
                </p>
                <p
                  className={cn(
                    "text-3xl font-bold tabular-nums",
                    cash.expected < 0 && "text-destructive",
                  )}
                  data-testid="drawer-expected"
                >
                  {f.money(cash.expected)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {isSet ? (
                    <span data-testid="drawer-opening">
                      {t("drawerOpening")} {f.money(cash.opening ?? 0)}
                    </span>
                  ) : (
                    t("drawerNotSet")
                  )}
                  {" · "}
                  {t("drawerIn")} {f.money(cash.flow.totalIn)}
                  {" · "}
                  {t("drawerOut")} {f.money(cash.flow.totalOut)}
                </p>
              </div>

              <Button
                variant="ghost"
                size="sm"
                className="self-start"
                onClick={() => setDetails((d) => !d)}
                aria-expanded={details}
                data-testid="drawer-details-toggle"
              >
                {details ? (
                  <ChevronUp aria-hidden />
                ) : (
                  <ChevronDown aria-hidden />
                )}
                {details ? t("drawerHideDetails") : t("drawerDetails")}
              </Button>

              {details ? (
                <div
                  className="flex flex-col gap-3 text-sm"
                  data-testid="drawer-details"
                >
                  <dl className="space-y-0.5">
                    {lines.map(([key, label, value]) => (
                      <div
                        key={key}
                        className="flex justify-between gap-2"
                        data-testid={`drawer-flow-${key}`}
                      >
                        <dt className="text-muted-foreground">{label}</dt>
                        <dd
                          className={cn(
                            "tabular-nums",
                            value < 0 && "text-destructive",
                          )}
                        >
                          {value < 0 ? "−" : value > 0 ? "+" : ""}
                          {f.money(Math.abs(value))}
                        </dd>
                      </div>
                    ))}
                  </dl>

                  <div data-testid="drawer-log">
                    <p className="mb-1 text-xs font-medium text-muted-foreground">
                      {t("drawerLog")}
                    </p>
                    {cash.entries.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        {t("drawerNotSet")}
                      </p>
                    ) : (
                      <ul className="space-y-0.5">
                        {cash.entries.map((e) => (
                          <li
                            key={e.id}
                            className="flex justify-between gap-2"
                            data-testid="drawer-log-entry"
                          >
                            <span>
                              {e.kind === "open"
                                ? t("drawerLogOpen")
                                : t("drawerLogCorrect")}
                              {e.byName
                                ? ` · ${t("drawerBy", { name: e.byName })}`
                                : ""}
                              <span className="text-xs text-muted-foreground">
                                {" "}
                                {f.time(e.createdAt)}
                              </span>
                            </span>
                            <span className="tabular-nums">
                              {f.money(e.amount)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {cash.history.length > 0 ? (
                    <div data-testid="drawer-history">
                      <p className="mb-1 text-xs font-medium text-muted-foreground">
                        {t("drawerHistory")}
                      </p>
                      <ul className="space-y-0.5">
                        {cash.history.map((h) => (
                          <li
                            key={h.day}
                            className="flex justify-between gap-2"
                          >
                            <span>{f.date(h.day)}</span>
                            <span className="tabular-nums">
                              {t("drawerOpening")} {f.money(h.opening)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : null}
        </>
      )}
    </section>
  );
}
