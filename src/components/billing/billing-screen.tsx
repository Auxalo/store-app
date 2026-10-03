"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLiveQuery } from "dexie-react-hooks";
import {
  CheckCircle2,
  Copy,
  CreditCard,
  Lock,
  MessageCircle,
  Repeat,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { can } from "@/auth/permissions";
import { useProfile } from "@/auth/use-auth";
import { useBillingStatus } from "@/billing/client";
import type { BillingView, PayMethod, PaymentView } from "@/billing/plans";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { DEVELOPER } from "@/config/developer";
import { DataError } from "@/data/errors";
import { fetchBilling, postPayment } from "@/data/online";
import { getLocalDb } from "@/db/local/db";
import { useFormat } from "@/i18n/use-format";
import { parseMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { submitPaymentSchema } from "@/schemas/billing";
import { useActiveUser } from "@/stores/active-user";
import { useConnectivity } from "@/stores/connectivity";
import { STATE_TONE, useBillingSummary } from "./billing-summary";

const METHODS: PayMethod[] = ["bkash", "nagad"];

/**
 * The billing page: where the shop stands, how to pay (bKash or Nagad Send Money, then the
 * transaction id), and its payments. A locked shop is sent here from every screen.
 */
export function BillingScreen() {
  const { role } = useProfile();
  const canPay = can(role, "billing.manage");
  const status = useBillingStatus();
  const online = useConnectivity((s) => s.online);
  const view = useQuery({
    queryKey: ["billing"],
    queryFn: fetchBilling,
    staleTime: 30_000,
    enabled: online,
  });

  return (
    <div
      className="mx-auto flex w-full max-w-2xl flex-col gap-4"
      data-testid="billing-screen"
    >
      <StatusCard />
      {status.mode === "paid" && canPay ? (
        view.data?.plans ? (
          <PayCard view={view.data} />
        ) : view.isPending && online ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <NeedInternet />
        )
      ) : null}
      {status.locked && !canPay ? <AskOwner /> : null}
      {canPay && view.data?.payments ? (
        <History payments={view.data.payments} />
      ) : null}
      <Help />
    </div>
  );
}

function StatusCard() {
  const t = useTranslations("billing");
  const status = useBillingStatus();
  const { planName, stateLabel, timeLeft, date } = useBillingSummary(status);

  return (
    <Card
      className={cn(status.locked && "border-red-500/50")}
      data-testid="billing-status"
    >
      {status.locked ? (
        <div className="flex items-start gap-3 rounded-t-xl bg-red-500/10 p-4">
          <Lock className="mt-0.5 size-5 shrink-0 text-red-600" aria-hidden />
          <div>
            <p className="font-semibold" data-testid="billing-locked">
              {t("lockedTitle")}
            </p>
            <p className="text-sm text-muted-foreground">{t("lockedBody")}</p>
          </div>
        </div>
      ) : null}
      <CardHeader className="flex-row items-center gap-3 space-y-0">
        <CreditCard className="size-5 text-muted-foreground" aria-hidden />
        <CardTitle className="min-w-0 flex-1 truncate text-base">
          {planName ?? t("title")}
        </CardTitle>
        <span
          className={cn(
            "rounded-full px-2.5 py-0.5 text-xs font-medium",
            STATE_TONE[status.state],
          )}
          data-testid="billing-state"
        >
          {stateLabel}
        </span>
      </CardHeader>
      <CardContent className="flex flex-col gap-1 text-sm">
        {status.mode === "free" ? <p>{t("freeBody")}</p> : null}
        {status.mode === "off" ? (
          <p className="text-muted-foreground">{t("offBody")}</p>
        ) : null}
        {status.mode === "paid" && status.paidUntil ? (
          <p>
            {t(status.trial ? "trialEndsOn" : "endsOn", {
              date: date(status.paidUntil),
            })}
          </p>
        ) : null}
        {timeLeft && status.state !== "overdue" ? (
          <p className="font-medium" data-testid="billing-left">
            {timeLeft}
          </p>
        ) : null}
        {status.state === "overdue" && !status.provisional ? (
          <p className="font-medium text-red-600">
            {t("locksOn", { date: date(status.lockAt) })}
          </p>
        ) : null}
        {status.provisional ? (
          <p className="font-medium text-amber-700 dark:text-amber-400">
            {t("provisional", { date: date(status.provisionalUntil) })}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function PayCard({ view }: { view: BillingView }) {
  const t = useTranslations("billing");
  const f = useFormat();
  const locale = useLocale();
  const { storeName } = useProfile();
  const client = useQueryClient();
  const plans = view.plans ?? [];
  const [planId, setPlanId] = useState(
    plans.find((p) => p.id === view.planId)?.id ?? plans[0]?.id ?? "",
  );
  const plan = plans.find((p) => p.id === planId) ?? plans[0];
  const [method, setMethod] = useState<PayMethod>("bkash");
  const [trxId, setTrxId] = useState("");
  const [sender, setSender] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<PaymentView | null>(null);

  // The amount follows the chosen plan until the person types their own.
  const [amountTouched, setAmountTouched] = useState(false);
  useEffect(() => {
    if (plan && !amountTouched) setAmount(String(plan.price / 100));
  }, [plan, amountTouched]);

  const number = view.payTo?.[method] ?? DEVELOPER.whatsapp;
  const price = plan ? f.money(plan.price) : "";

  async function copyNumber() {
    try {
      await navigator.clipboard.writeText(number);
      toast.success(t("copied"));
    } catch {
      /* the number is on screen to copy by hand */
    }
  }

  async function submit() {
    setError(null);
    const poisha = parseMoney(amount);
    if (!poisha || poisha <= 0) {
      setError(t("errors.amount"));
      return;
    }
    const parsed = submitPaymentSchema.safeParse({
      method,
      trxId,
      sender,
      amount: poisha,
      planId: plan?.id ?? "",
    });
    if (!parsed.success) {
      const key = parsed.error.issues[0]?.message ?? "other";
      setError(
        t.has(`errors.${key}` as never)
          ? t(`errors.${key}` as never)
          : t("errors.other"),
      );
      return;
    }
    setBusy(true);
    try {
      const result = await postPayment(parsed.data);
      setSent(result.payment);
      setTrxId("");
      toast.success(t("submitted"));
      if (result.opened)
        toast.success(
          t("opened", { n: f.integer(view.provisionalHours ?? 48) }),
        );
      await client.invalidateQueries({ queryKey: ["billing"] });
    } catch (e) {
      const code = e instanceof DataError ? e.code : "other";
      setError(
        t.has(`errors.${code}` as never)
          ? t(`errors.${code}` as never)
          : t("errors.other"),
      );
    } finally {
      setBusy(false);
    }
  }

  const whatsapp = sent
    ? `${DEVELOPER.whatsappUrl}?text=${encodeURIComponent(
        t("whatsappMessage", {
          amount: f.money(sent.amount),
          method: t(sent.method === "nagad" ? "nagad" : "bkash"),
          shop: storeName ?? "",
          trxId: sent.trxId,
        }),
      )}`
    : null;

  return (
    <Card data-testid="billing-pay">
      <CardHeader>
        <CardTitle className="text-base">{t("howToPay")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        {plans.length > 1 ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 font-medium">{t("choosePlan")}</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {plans.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setPlanId(p.id);
                    setAmountTouched(false);
                  }}
                  aria-pressed={p.id === plan?.id}
                  className={cn(
                    "rounded-lg border p-3 text-start transition-colors",
                    p.id === plan?.id
                      ? "border-primary bg-primary/5 ring-1 ring-primary"
                      : "hover:bg-muted",
                  )}
                  data-testid="billing-plan"
                >
                  <span className="block font-medium">
                    {locale === "bn" ? p.nameBn : p.name}
                  </span>
                  <span className="block text-lg font-semibold tabular-nums">
                    {f.money(p.price)}
                  </span>
                </button>
              ))}
            </div>
          </fieldset>
        ) : plan ? (
          <p>
            {t("plan")}:{" "}
            <span className="font-medium">
              {locale === "bn" ? plan.nameBn : plan.name}
            </span>{" "}
            · <span className="font-semibold tabular-nums">{price}</span>
          </p>
        ) : null}

        <div className="flex gap-2">
          {METHODS.map((m) => (
            <Button
              key={m}
              type="button"
              variant={method === m ? "default" : "outline"}
              onClick={() => setMethod(m)}
              className="flex-1"
              data-testid={`billing-method-${m}`}
            >
              {t(m)}
            </Button>
          ))}
        </div>

        <ol className="flex list-decimal flex-col gap-2 ps-5">
          <li>{t("step1")}</li>
          <li>
            {t("step2", { amount: price })}
            <div className="mt-1.5 flex items-center gap-2">
              <span
                className="rounded-md border bg-muted px-3 py-1.5 font-mono text-base font-semibold tracking-wider"
                data-testid="billing-pay-number"
              >
                {number}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void copyNumber()}
              >
                <Copy aria-hidden /> {t("copy")}
              </Button>
            </div>
          </li>
          <li>{t("step3")}</li>
        </ol>

        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="billing-trx">{t("trxId")}</Label>
            <Input
              id="billing-trx"
              value={trxId}
              onChange={(e) => setTrxId(e.target.value)}
              autoCapitalize="characters"
              autoComplete="off"
              placeholder="9J7A3B2C1D"
              required
            />
            <p className="text-xs text-muted-foreground">{t("trxIdHint")}</p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="billing-sender">{t("sender")}</Label>
              <Input
                id="billing-sender"
                value={sender}
                onChange={(e) => setSender(e.target.value)}
                inputMode="tel"
                autoComplete="tel"
                placeholder="01XXXXXXXXX"
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="billing-amount">{t("amount")}</Label>
              <Input
                id="billing-amount"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setAmountTouched(true);
                }}
                inputMode="decimal"
                required
              />
            </div>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <Button type="submit" disabled={busy} data-testid="billing-submit">
            {busy ? t("sending") : t("submit")}
          </Button>
        </form>

        {sent && whatsapp ? (
          <div
            className="flex flex-col gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3"
            data-testid="billing-sent"
          >
            <p className="flex items-center gap-2 font-medium">
              <CheckCircle2 className="size-4 text-emerald-600" aria-hidden />
              {t("submitted")}
            </p>
            <Button asChild variant="outline" size="sm" className="w-fit">
              <a href={whatsapp} target="_blank" rel="noopener noreferrer">
                <MessageCircle aria-hidden />
                {t("tellOnWhatsapp", { name: DEVELOPER.name })}
              </a>
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function History({ payments }: { payments: PaymentView[] }) {
  const t = useTranslations("billing");
  const f = useFormat();
  return (
    <Card data-testid="billing-history">
      <CardHeader>
        <CardTitle className="text-base">{t("history")}</CardTitle>
      </CardHeader>
      <CardContent>
        {payments.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noPayments")}</p>
        ) : (
          <ul className="divide-y text-sm">
            {payments.map((p) => (
              <li
                key={p.id}
                className="flex flex-col gap-0.5 py-2.5"
                data-testid="billing-payment"
              >
                <div className="flex items-center gap-2">
                  <span className="font-semibold tabular-nums">
                    {f.money(p.amount)}
                  </span>
                  <span className="text-muted-foreground">
                    {p.method === "bkash" || p.method === "nagad"
                      ? t(p.method)
                      : p.method}
                    {p.trxId ? ` · ${p.trxId}` : ""}
                  </span>
                  <span className="flex-1" />
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-xs font-medium",
                      p.status === "approved"
                        ? STATE_TONE.active
                        : p.status === "rejected"
                          ? STATE_TONE.locked
                          : STATE_TONE.ending,
                    )}
                  >
                    {t(`status.${p.status}`)}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {f.dateTime(p.submittedAt)}
                  {p.status === "approved" && p.periodEnd
                    ? ` · ${t("periodTo", { date: f.date(p.periodEnd) })}`
                    : ""}
                </div>
                {p.status === "rejected" && p.reason ? (
                  <div className="text-xs text-red-600">
                    {t("rejectedReason", { reason: p.reason })}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function AskOwner() {
  const t = useTranslations("billing");
  const lock = useActiveUser((s) => s.lock);
  const pinUsers = useLiveQuery(
    () =>
      getLocalDb()
        .localUsers.filter((u) => u.isActive && !!u.pinHash)
        .count(),
    [],
    0,
  );
  return (
    <Card data-testid="billing-ask-owner">
      <CardContent className="flex flex-col gap-3 pt-6 text-sm">
        <p className="font-medium">{t("askOwner")}</p>
        {pinUsers > 0 ? (
          <Button variant="outline" className="w-fit" onClick={lock}>
            <Repeat aria-hidden /> {t("switchUser")}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

function NeedInternet() {
  const t = useTranslations("billing");
  return (
    <Card>
      <CardContent className="pt-6 text-sm text-muted-foreground">
        {t("needInternet")}
      </CardContent>
    </Card>
  );
}

function Help() {
  const t = useTranslations("billing");
  return (
    <p className="text-center text-xs text-muted-foreground">
      <a
        href={DEVELOPER.whatsappUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 hover:text-foreground hover:underline"
      >
        <MessageCircle className="size-3.5" aria-hidden />
        {t("help", { number: DEVELOPER.whatsapp })}
      </a>
    </p>
  );
}
