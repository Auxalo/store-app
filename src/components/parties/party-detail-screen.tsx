"use client";

import Dexie from "dexie";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowLeft, HandCoins, Phone } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { can } from "@/auth/permissions";
import { useProfile } from "@/auth/use-auth";
import { MoneyField } from "@/components/pos/money-field";
import { ResponsiveDialog } from "@/components/shared/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { getLocalDb } from "@/db/local/db";
import type { PartyKind } from "@/db/local/queries/customers";
import { useFormat } from "@/i18n/use-format";
import { newId } from "@/lib/ids";
import { cn } from "@/lib/utils";
import { PAYMENT_METHODS, type PaymentMethod } from "@/schemas/sale";
import { useCommands } from "@/sync/use-commands";

const LINKS: Record<string, string> = {
  sale: "/sales/view?id=",
  sale_void: "/sales/view?id=",
  purchase: "/purchases/view?id=",
};

/** One customer or supplier: what they owe (or are owed), their full statement, and payments. */
export function PartyDetailScreen({ kind }: { kind: PartyKind }) {
  const t = useTranslations();
  const f = useFormat();
  const { role } = useProfile();
  const id = useSearchParams().get("id") ?? "";
  const [paying, setPaying] = useState(false);

  const party = useLiveQuery(async () => {
    const db = getLocalDb();
    return (
      (await (kind === "customer" ? db.customers : db.suppliers).get(id)) ??
      null
    );
  }, [kind, id]);
  const entries = useLiveQuery(
    () =>
      getLocalDb()
        .ledgerEntries.where("[partyId+createdAt]")
        .between([id, Dexie.minKey], [id, Dexie.maxKey])
        .reverse()
        .limit(200)
        .toArray(),
    [id],
    [],
  );

  if (party === undefined)
    return <Skeleton className="mx-auto h-64 w-full max-w-2xl" />;
  if (party === null || party.deletedAt) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        {t("products.notFound")}
      </p>
    );
  }
  if (kind === "supplier" && !can(role, "purchase.manage")) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        {t("products.noAccess")}
      </p>
    );
  }

  const balance = party.balance;
  const status =
    balance === 0
      ? t("party.settled")
      : balance > 0
        ? kind === "customer"
          ? t("party.owesYou")
          : t("party.youOwe")
        : t("party.advance");

  // Running balance: newest entry ends at the current balance; each earlier one is that minus what followed.
  let running = balance;
  const rows = entries.map((e) => {
    const after = running;
    running -= e.amountDelta;
    return { entry: e, after };
  });

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <Link
        href={`/${kind}s`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
        {t("common.back")}
      </Link>

      <Card>
        <CardContent className="flex flex-col gap-3 pt-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-xl font-semibold">{party.name}</h2>
              {party.phone ? (
                <a
                  href={`tel:${party.phone}`}
                  className="inline-flex items-center gap-1 text-sm text-muted-foreground"
                >
                  <Phone className="size-3.5" aria-hidden />
                  {party.phone}
                </a>
              ) : null}
              {party.address ? (
                <p className="text-sm text-muted-foreground">{party.address}</p>
              ) : null}
            </div>
            <div className="text-end">
              <p className="text-sm text-muted-foreground">{status}</p>
              <p
                className={cn(
                  "text-2xl font-semibold",
                  balance > 0 && "text-amber-600",
                )}
                data-testid="party-balance-total"
              >
                {f.money(Math.abs(balance))}
              </p>
            </div>
          </div>
          <Button onClick={() => setPaying(true)} data-testid="record-payment">
            <HandCoins aria-hidden />
            {kind === "customer" ? t("party.collect") : t("party.pay")}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("party.statement")}</CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("party.noEntries")}
            </p>
          ) : (
            <ul className="divide-y" data-testid="statement">
              {rows.map(({ entry, after }) => {
                const href = LINKS[entry.refType];
                const label = t(
                  `party.entryTypes.${entry.refType}` as never,
                  {} as never,
                ) as string;
                const body = (
                  <div
                    className="flex items-center justify-between gap-3 py-2 text-sm"
                    data-testid="statement-row"
                  >
                    <div className="min-w-0">
                      <p className="font-medium">
                        {label}
                        {entry.note ? (
                          <span className="ms-2 font-normal text-muted-foreground">
                            {entry.note}
                          </span>
                        ) : null}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {f.dateTime(entry.createdAt)}
                      </p>
                    </div>
                    <div className="shrink-0 text-end">
                      <p
                        className={cn(
                          "font-semibold",
                          entry.amountDelta < 0
                            ? "text-emerald-600"
                            : "text-amber-600",
                        )}
                      >
                        {entry.amountDelta > 0 ? "+" : "−"}
                        {f.money(Math.abs(entry.amountDelta))}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t("party.balanceAfter", { value: f.money(after) })}
                      </p>
                    </div>
                  </div>
                );
                return (
                  <li key={entry.id}>
                    {href ? (
                      <Link
                        href={`${href}${entry.refId}`}
                        className="block hover:bg-muted/40"
                      >
                        {body}
                      </Link>
                    ) : (
                      body
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <PaymentDialog
        kind={kind}
        partyId={id}
        partyName={party.name}
        open={paying}
        onClose={() => setPaying(false)}
      />
    </div>
  );
}

function PaymentDialog({
  kind,
  partyId,
  partyName,
  open,
  onClose,
}: {
  kind: PartyKind;
  partyId: string;
  partyName: string;
  open: boolean;
  onClose: () => void;
}) {
  const t = useTranslations();
  const run = useCommands();
  const [amount, setAmount] = useState<number | null>(null);
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!amount) return;
    setSaving(true);
    try {
      await run(kind === "customer" ? "payment.collect" : "payment.pay", {
        id: newId(),
        partyId,
        amount,
        method,
        note,
      });
      setAmount(null);
      setNote("");
      onClose();
    } catch {
      toast.error(t("common.somethingWrong"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={kind === "customer" ? t("party.collect") : t("party.pay")}
      description={partyName}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="pay-amount">
              {t("party.amount")} (৳)
            </FieldLabel>
            <MoneyField
              id="pay-amount"
              autoFocus
              value={amount}
              onValue={setAmount}
              data-testid="payment-amount"
            />
          </Field>
          <Field>
            <FieldLabel>{t("party.method")}</FieldLabel>
            <Select
              value={method}
              onValueChange={(v) => setMethod(v as PaymentMethod)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_METHODS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {t(`payment.${m}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="pay-note">{t("party.note")}</FieldLabel>
            <Input
              id="pay-note"
              value={note}
              maxLength={200}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={!amount || saving}
              data-testid="save-payment"
            >
              {t("common.save")}
            </Button>
          </div>
        </FieldGroup>
      </form>
    </ResponsiveDialog>
  );
}
