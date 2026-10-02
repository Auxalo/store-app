"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useLiveQuery } from "dexie-react-hooks";
import { ChevronRight, Pencil, Plus, Search, Trash2 } from "lucide-react";
import Link from "next/link";
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
import {
  type Party,
  type PartyKind,
  searchParties,
} from "@/db/local/queries/customers";
import { useFormat } from "@/i18n/use-format";
import { newId } from "@/lib/ids";
import { isValidPhone, normalizePhone } from "@/lib/phone";
import { useSyncStore } from "@/sync/store";
import { useCommands } from "@/sync/use-commands";

const text = (max: number) => z.string().trim().max(max);
/** Optional, but a phone that is given must be a real number; stored as plain digits. */
const phone = text(30)
  .refine(isValidPhone, { error: "invalidPhone" })
  .transform(normalizePhone);
const schemas = {
  customer: z.object({
    name: text(120).min(1, { error: "required" }),
    phone,
    address: text(200),
    notes: text(500),
  }),
  supplier: z.object({
    name: text(120).min(1, { error: "required" }),
    phone,
    email: text(120),
    contactPerson: text(120),
    address: text(200),
    notes: text(500),
  }),
};
const FIELDS: Record<PartyKind, string[]> = {
  customer: ["name", "phone", "address", "notes"],
  supplier: ["name", "phone", "contactPerson", "email", "address", "notes"],
};

type FormValues = Record<string, string>;

/**
 * Customers and suppliers share one screen: a searchable list with their balance, add / edit /
 * delete, and a link to the statement. `kind` picks the table, the commands and the wording.
 */
export function PartiesScreen({ kind }: { kind: PartyKind }) {
  const t = useTranslations();
  const f = useFormat();
  const run = useCommands();
  const { role } = useProfile();
  const initialSyncDone = useSyncStore((s) => s.initialSyncDone);
  const ns = kind === "customer" ? "customers" : "suppliers";
  const tk = (key: string, values?: Record<string, string | number>) =>
    t(`${ns}.${key}` as never, values as never);

  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query);
  const [editing, setEditing] = useState<Party | "new" | null>(null);
  const [deleting, setDeleting] = useState<Party | null>(null);

  const parties = useLiveQuery(
    () => searchParties(getLocalDb(), kind, deferred, 200),
    [kind, deferred],
  );
  const allowed = kind === "customer" || can(role, "purchase.manage");
  const canDelete = can(
    role,
    kind === "customer" ? "product.edit" : "purchase.manage",
  );
  const rows = parties ?? [];
  const totalOwing = rows.reduce((sum, p) => sum + Math.max(0, p.balance), 0);

  if (!allowed)
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        {t("products.noAccess")}
      </p>
    );

  async function save(values: FormValues) {
    try {
      if (editing === "new" || editing === null) {
        await run(
          `${kind}.create` as never,
          { id: newId(), ...values } as never,
        );
      } else {
        const current = editing as unknown as Record<string, string>;
        const changes = Object.fromEntries(
          Object.keys(values)
            .filter((k) => values[k] !== current[k])
            .map((k) => [k, values[k]]),
        );
        if (Object.keys(changes).length > 0)
          await run(
            `${kind}.update` as never,
            { id: editing.id, changes } as never,
          );
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
            placeholder={tk("searchPlaceholder")}
            aria-label={tk("searchPlaceholder")}
            className="ps-9"
            inputMode="search"
          />
        </div>
        <Button onClick={() => setEditing("new")}>
          <Plus aria-hidden />
          <span className="max-sm:sr-only">{tk("add")}</span>
        </Button>
      </div>

      {parties !== undefined && rows.length > 0 ? (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            {tk("count", { count: rows.length, n: f.integer(rows.length) })}
          </span>
          {totalOwing > 0 ? (
            <span className="font-semibold text-foreground">
              {tk(kind === "customer" ? "totalDue" : "totalOwed", {
                value: f.money(totalOwing),
              })}
            </span>
          ) : null}
        </div>
      ) : null}

      {parties === undefined || (!initialSyncDone && rows.length === 0) ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {deferred ? tk("noMatch") : tk("empty")}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((p) => (
            <li
              key={p.id}
              className="flex items-center gap-2 rounded-xl border bg-card p-3"
              data-testid="party-row"
            >
              <Link
                href={`/${kind}s/view?id=${p.id}`}
                className="flex min-w-0 flex-1 items-center gap-3"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{p.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {[p.phone, p.address].filter(Boolean).join(" · ")}
                  </span>
                </span>
                {p.balance !== 0 ? (
                  <Badge
                    variant={p.balance > 0 ? "secondary" : "outline"}
                    data-testid="party-balance"
                  >
                    {p.balance > 0
                      ? tk(kind === "customer" ? "due" : "owed")
                      : tk("advance")}{" "}
                    {f.money(Math.abs(p.balance))}
                  </Badge>
                ) : null}
                <ChevronRight
                  className="size-4 text-muted-foreground rtl:rotate-180"
                  aria-hidden
                />
              </Link>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setEditing(p)}
                aria-label={t("common.edit")}
              >
                <Pencil aria-hidden />
              </Button>
              {canDelete ? (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setDeleting(p)}
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
        title={editing === "new" ? tk("add") : tk("edit")}
      >
        {editing !== null ? (
          <PartyForm
            key={editing === "new" ? "new" : editing.id}
            kind={kind}
            party={editing === "new" ? undefined : editing}
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
            <AlertDialogTitle>{tk("deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting ? tk("deleteBody", { name: deleting.name }) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleting)
                  void run(
                    `${kind}.delete` as never,
                    { id: deleting.id } as never,
                  ).catch(() => toast.error(t("common.somethingWrong")));
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

function PartyForm({
  kind,
  party,
  onSubmit,
  onCancel,
}: {
  kind: PartyKind;
  party?: Party;
  onSubmit: (v: FormValues) => Promise<void>;
  onCancel: () => void;
}) {
  const t = useTranslations();
  const ns = kind === "customer" ? "customers" : "suppliers";
  const fields = FIELDS[kind];
  const current = (party ?? {}) as unknown as Record<string, string>;
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schemas[kind]) as never,
    defaultValues: Object.fromEntries(fields.map((k) => [k, current[k] ?? ""])),
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate>
      <FieldGroup>
        {fields.map((name, i) => (
          <Field key={name} data-invalid={!!errors[name]}>
            <FieldLabel htmlFor={`p-${name}`}>
              {t(`${ns}.${name}` as never)}
            </FieldLabel>
            <Input
              id={`p-${name}`}
              autoFocus={i === 0}
              inputMode={
                name === "phone"
                  ? "tel"
                  : name === "email"
                    ? "email"
                    : undefined
              }
              aria-invalid={!!errors[name]}
              {...register(name)}
            />
            <ValidationError error={errors[name] as never} />
          </Field>
        ))}
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
