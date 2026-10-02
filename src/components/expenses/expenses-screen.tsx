"use client";

import { Ban, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { can } from "@/auth/permissions";
import { useProfile } from "@/auth/use-auth";
import { MoneyField } from "@/components/pos/money-field";
import {
  type FilterValues,
  ListToolbar,
} from "@/components/shared/list-toolbar";
import { ListError, LoadMore } from "@/components/shared/load-more";
import { ResponsiveDialog } from "@/components/shared/responsive-dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCommand, useList, useTotals } from "@/data/hooks";
import { useDataMode } from "@/data/mode-store";
import type { Expense } from "@/db/local/types";
import { useFormat } from "@/i18n/use-format";
import { newId } from "@/lib/ids";
import { cn } from "@/lib/utils";
import { EXPENSE_CATEGORIES, type ExpenseCategory } from "@/schemas/expense";
import { PAYMENT_METHODS, type PaymentMethod } from "@/schemas/sale";
import { usePreferences } from "@/stores/preferences";
import { useSyncStore } from "@/sync/store";

type Period = "today" | "month" | "all" | "custom";
const NONE = "all";
const SORTS = ["newest", "oldest", "amount"] as const;

const todayIn = (timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

export function ExpensesScreen() {
  const t = useTranslations();
  const f = useFormat();
  const run = useCommand();
  const { role } = useProfile();
  const mode = useDataMode();
  const timeZone = usePreferences((s) => s.timeZone);
  const initialSyncDone = useSyncStore((s) => s.initialSyncDone);
  const [period, setPeriod] = useState<Period>("month");
  const [adding, setAdding] = useState(false);
  const [voiding, setVoiding] = useState<Expense | null>(null);
  const [reason, setReason] = useState("");

  const allowed = can(role, "expense.manage");
  const [sort, setSort] = useState<(typeof SORTS)[number]>("newest");
  const [filters, setFilters] = useState<FilterValues>({
    category: NONE,
    method: NONE,
    status: NONE,
  });

  const today = todayIn(timeZone);
  const dates =
    period === "custom"
      ? {
          from: filters.from as string | undefined,
          to: filters.to as string | undefined,
        }
      : period === "all"
        ? {}
        : {
            from: period === "today" ? today : `${today.slice(0, 7)}-01`,
            to: today,
          };
  const params = {
    ...dates,
    category:
      filters.category === NONE
        ? undefined
        : (filters.category as ExpenseCategory),
    method:
      filters.method === NONE ? undefined : (filters.method as PaymentMethod),
    status: filters.status as "all" | "active" | "voided",
    sort,
  };
  const list = useList("expenses", params, { enabled: allowed });
  const totals = useTotals("expenses", params, { enabled: allowed });
  const rows = list.items;
  const waiting =
    list.status === "loading" ||
    (rows.length === 0 && mode === "offline" && !initialSyncDone);

  if (!allowed)
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        {t("products.noAccess")}
      </p>
    );

  async function cancel() {
    if (!voiding) return;
    try {
      await run("expense.void", { id: voiding.id, reason });
      setVoiding(null);
      setReason("");
    } catch {
      toast.error(t("common.somethingWrong"));
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
      <ListToolbar
        fields={[
          {
            kind: "dates",
            fromKey: "from",
            toKey: "to",
            label: t("list.dates"),
          },
          {
            kind: "choice",
            key: "category",
            label: t("expenses.category"),
            none: NONE,
            options: [
              { value: NONE, label: t("expenses.all") },
              ...EXPENSE_CATEGORIES.map((c) => ({
                value: c,
                label: t(`expenses.categories.${c}`),
              })),
            ],
          },
          {
            kind: "choice",
            key: "method",
            label: t("expenses.method"),
            none: NONE,
            options: [
              { value: NONE, label: t("expenses.all") },
              ...PAYMENT_METHODS.map((m) => ({
                value: m,
                label: t(`payment.${m}`),
              })),
            ],
          },
          {
            kind: "choice",
            key: "status",
            label: t("sales.filterStatus"),
            none: NONE,
            options: [
              { value: NONE, label: t("sales.statusAll") },
              { value: "active", label: t("sales.statusActive") },
              { value: "voided", label: t("sales.statusVoided") },
            ],
          },
        ]}
        values={
          period === "custom"
            ? filters
            : { ...filters, from: undefined, to: undefined }
        }
        onValue={(key, value) => {
          setFilters((c) => ({ ...c, [key]: value }));
          if (key === "from" || key === "to") setPeriod("custom");
        }}
        sort={sort}
        sortOptions={SORTS.map((o) => ({
          value: o,
          label: t(`list.sorts.${o}`),
        }))}
        onSort={(v) => setSort(v as (typeof SORTS)[number])}
        onClear={() => {
          setFilters({ category: NONE, method: NONE, status: NONE });
          if (period === "custom") setPeriod("month");
        }}
        trailing={
          <Button onClick={() => setAdding(true)} data-testid="add-expense">
            <Plus aria-hidden />
            <span className="max-sm:sr-only">{t("expenses.add")}</span>
          </Button>
        }
      />

      <Tabs
        value={period === "custom" ? "" : period}
        onValueChange={(v) => setPeriod(v as Period)}
      >
        <TabsList>
          <TabsTrigger value="today">{t("expenses.today")}</TabsTrigger>
          <TabsTrigger value="month">{t("expenses.month")}</TabsTrigger>
          <TabsTrigger value="all">{t("expenses.all")}</TabsTrigger>
        </TabsList>
      </Tabs>

      {totals && totals.count > 0 ? (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span data-testid="expense-count">
            {t("expenses.count", {
              count: totals.count,
              n: f.integer(totals.count),
            })}
          </span>
          <span
            className="font-semibold text-foreground"
            data-testid="expense-total"
          >
            {t("expenses.totalSpent", { value: f.money(totals.amount) })}
          </span>
        </div>
      ) : null}

      {list.status === "error" ? (
        <ListError onRetry={list.refetch} />
      ) : waiting ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {period === "all" &&
          filters.category === NONE &&
          filters.method === NONE &&
          filters.status === NONE
            ? t("expenses.empty")
            : t("expenses.emptyFilter")}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((e) => (
            <li
              key={e.id}
              className={cn(
                "flex items-center gap-3 rounded-xl border bg-card p-3",
                e.status === "voided" && "opacity-60",
              )}
              data-testid="expense-row"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">
                  {t(`expenses.categories.${e.category}`)}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {f.date(`${e.date}T12:00:00Z`)}
                  {e.description ? ` · ${e.description}` : ""} ·{" "}
                  {t(`payment.${e.method}`)}
                </p>
              </div>
              {e.status === "voided" ? (
                <Badge variant="destructive">{t("expenses.voided")}</Badge>
              ) : null}
              <span
                className={cn(
                  "shrink-0 font-semibold",
                  e.status === "voided" && "line-through",
                )}
              >
                {f.money(e.amount)}
              </span>
              {e.status === "active" ? (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setVoiding(e)}
                  aria-label={t("expenses.voidConfirm")}
                >
                  <Ban aria-hidden />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <LoadMore list={list} />

      <ResponsiveDialog
        open={adding}
        onOpenChange={setAdding}
        title={t("expenses.add")}
      >
        {adding ? (
          <ExpenseForm today={today} onDone={() => setAdding(false)} />
        ) : null}
      </ResponsiveDialog>

      <AlertDialog
        open={voiding !== null}
        onOpenChange={(open) => !open && setVoiding(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("expenses.voidTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("expenses.voidBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={reason}
            maxLength={200}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("expenses.voidReason")}
            aria-label={t("expenses.voidReason")}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void cancel()}>
              {t("expenses.voidConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ExpenseForm({ today, onDone }: { today: string; onDone: () => void }) {
  const t = useTranslations();
  const run = useCommand();
  const [category, setCategory] = useState<ExpenseCategory>("rent");
  const [amount, setAmount] = useState<number | null>(null);
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(today);
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!amount) return;
    setSaving(true);
    try {
      await run("expense.create", {
        id: newId(),
        category,
        amount,
        description,
        date,
        method,
      });
      onDone();
    } catch {
      toast.error(t("common.somethingWrong"));
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <FieldGroup>
        <Field>
          <FieldLabel>{t("expenses.category")}</FieldLabel>
          <Select
            value={category}
            onValueChange={(v) => setCategory(v as ExpenseCategory)}
          >
            <SelectTrigger className="w-full" data-testid="expense-category">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EXPENSE_CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {t(`expenses.categories.${c}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="exp-amount">
            {t("expenses.amount")} (৳)
          </FieldLabel>
          <MoneyField
            id="exp-amount"
            autoFocus
            value={amount}
            onValue={setAmount}
            data-testid="expense-amount"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="exp-desc">
            {t("expenses.description")}
          </FieldLabel>
          <Input
            id="exp-desc"
            value={description}
            maxLength={200}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field>
            <FieldLabel htmlFor="exp-date">{t("expenses.date")}</FieldLabel>
            <Input
              id="exp-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel>{t("expenses.method")}</FieldLabel>
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
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onDone}>
            {t("common.cancel")}
          </Button>
          <Button
            type="submit"
            disabled={!amount || saving}
            data-testid="save-expense"
          >
            {t("common.save")}
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}
