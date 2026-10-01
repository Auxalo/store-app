"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useLiveQuery } from "dexie-react-hooks";
import { Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useDeferredValue, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { can } from "@/auth/permissions";
import { useProfile } from "@/auth/use-auth";
import { ValidationError } from "@/components/shared/field-text";
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
import { Skeleton } from "@/components/ui/skeleton";
import { getLocalDb } from "@/db/local/db";
import { searchCustomers } from "@/db/local/queries/customers";
import type { Customer } from "@/db/local/types";
import { useFormat } from "@/i18n/use-format";
import { newId } from "@/lib/ids";
import { useSyncStore } from "@/sync/store";
import { useCommands } from "@/sync/use-commands";

const formSchema = z.object({
  name: z.string().trim().min(1, { error: "required" }).max(120),
  phone: z.string().trim().max(30),
  address: z.string().trim().max(200),
  notes: z.string().trim().max(500),
});
type FormValues = z.infer<typeof formSchema>;

export function CustomersScreen() {
  const t = useTranslations();
  const f = useFormat();
  const run = useCommands();
  const { role } = useProfile();
  const initialSyncDone = useSyncStore((s) => s.initialSyncDone);
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query);
  const [editing, setEditing] = useState<Customer | "new" | null>(null);
  const [deleting, setDeleting] = useState<Customer | null>(null);

  const customers = useLiveQuery(
    () => searchCustomers(getLocalDb(), deferred, 200),
    [deferred],
  );
  const canManage = can(role, "product.edit");
  const rows = customers ?? [];
  const totalDue = rows.reduce((sum, c) => sum + Math.max(0, c.balance), 0);

  async function save(values: FormValues) {
    try {
      if (editing === "new" || editing === null) {
        await run("customer.create", { id: newId(), ...values });
      } else {
        const changes = Object.fromEntries(
          (Object.keys(values) as Array<keyof FormValues>)
            .filter((k) => values[k] !== editing[k])
            .map((k) => [k, values[k]]),
        );
        if (Object.keys(changes).length > 0)
          await run("customer.update", { id: editing.id, changes });
      }
      setEditing(null);
    } catch {
      toast.error(t("common.somethingWrong"));
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("customers.searchPlaceholder")}
            aria-label={t("customers.searchPlaceholder")}
            className="ps-9"
            inputMode="search"
          />
        </div>
        <Button onClick={() => setEditing("new")}>
          <Plus aria-hidden />
          <span className="max-sm:sr-only">{t("customers.add")}</span>
        </Button>
      </div>

      {customers !== undefined && rows.length > 0 ? (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            {t("customers.count", {
              count: rows.length,
              n: f.integer(rows.length),
            })}
          </span>
          {totalDue > 0 ? (
            <span className="font-semibold text-foreground">
              {t("customers.totalDue", { value: f.money(totalDue) })}
            </span>
          ) : null}
        </div>
      ) : null}

      {customers === undefined || (!initialSyncDone && rows.length === 0) ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {deferred ? t("customers.noMatch") : t("customers.empty")}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((c) => (
            <li
              key={c.id}
              className="flex items-center gap-3 rounded-xl border bg-card p-3"
              data-testid="customer-row"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{c.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {[c.phone, c.address].filter(Boolean).join(" · ")}
                </p>
              </div>
              {c.balance !== 0 ? (
                <Badge
                  variant={c.balance > 0 ? "secondary" : "outline"}
                  data-testid="customer-balance"
                >
                  {c.balance > 0 ? t("customers.due") : t("customers.advance")}{" "}
                  {f.money(Math.abs(c.balance))}
                </Badge>
              ) : null}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setEditing(c)}
                aria-label={t("common.edit")}
              >
                <Pencil aria-hidden />
              </Button>
              {canManage ? (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setDeleting(c)}
                  aria-label={t("common.delete")}
                >
                  <Trash2 aria-hidden />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <ResponsiveDialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        title={editing === "new" ? t("customers.add") : t("customers.edit")}
      >
        {editing !== null ? (
          <CustomerForm
            key={editing === "new" ? "new" : editing.id}
            customer={editing === "new" ? undefined : editing}
            onSubmit={save}
            onCancel={() => setEditing(null)}
          />
        ) : null}
      </ResponsiveDialog>

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("customers.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting
                ? t("customers.deleteBody", { name: deleting.name })
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleting)
                  void run("customer.delete", { id: deleting.id }).catch(() =>
                    toast.error(t("common.somethingWrong")),
                  );
              }}
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function CustomerForm({
  customer,
  onSubmit,
  onCancel,
}: {
  customer?: Customer;
  onSubmit: (v: FormValues) => Promise<void>;
  onCancel: () => void;
}) {
  const t = useTranslations();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: customer?.name ?? "",
      phone: customer?.phone ?? "",
      address: customer?.address ?? "",
      notes: customer?.notes ?? "",
    },
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate>
      <FieldGroup>
        <Field data-invalid={!!errors.name}>
          <FieldLabel htmlFor="c-name">{t("customers.name")}</FieldLabel>
          <Input
            id="c-name"
            autoFocus
            aria-invalid={!!errors.name}
            {...register("name")}
          />
          <ValidationError error={errors.name} />
        </Field>
        <Field>
          <FieldLabel htmlFor="c-phone">{t("customers.phone")}</FieldLabel>
          <Input id="c-phone" inputMode="tel" {...register("phone")} />
        </Field>
        <Field>
          <FieldLabel htmlFor="c-address">{t("customers.address")}</FieldLabel>
          <Input id="c-address" {...register("address")} />
        </Field>
        <Field>
          <FieldLabel htmlFor="c-notes">{t("customers.notes")}</FieldLabel>
          <Input id="c-notes" {...register("notes")} />
        </Field>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {t("common.save")}
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}
