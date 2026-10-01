"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { can } from "@/auth/permissions";
import { useProfile } from "@/auth/use-auth";
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
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { getLocalDb } from "@/db/local/db";
import type { Category } from "@/db/local/types";
import { useFormat } from "@/i18n/use-format";
import { newId } from "@/lib/ids";
import { normalizeSearch } from "@/lib/search";
import type { CategoryFormValues } from "@/schemas/category";
import { usePreferences } from "@/stores/preferences";
import { useSyncStore } from "@/sync/store";
import { useCommands } from "@/sync/use-commands";
import { CategoryForm } from "./category-form";

export function CategoriesScreen() {
  const t = useTranslations();
  const f = useFormat();
  const run = useCommands();
  const { role } = useProfile();
  const locale = usePreferences((s) => s.locale);
  const initialSyncDone = useSyncStore((s) => s.initialSyncDone);

  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Category | "new" | null>(null);
  const [deleting, setDeleting] = useState<Category | null>(null);

  const categories = useLiveQuery(
    () =>
      getLocalDb()
        .categories.filter((c) => !c.deletedAt)
        .toArray(),
    [],
  );
  const canCreate = can(role, "product.create");
  const canEdit = can(role, "product.edit");

  const visible = useMemo(() => {
    const needle = normalizeSearch(query);
    return (categories ?? [])
      .filter(
        (c) =>
          !needle || normalizeSearch(`${c.name} ${c.nameBn}`).includes(needle),
      )
      .sort((a, b) =>
        locale === "bn" && a.nameBn && b.nameBn
          ? a.nameBn.localeCompare(b.nameBn, "bn")
          : a.name.localeCompare(b.name),
      );
  }, [categories, query, locale]);

  const fail = () => toast.error(t("common.somethingWrong"));

  async function save(values: CategoryFormValues) {
    try {
      if (editing === "new" || editing === null) {
        await run("category.create", {
          id: newId(),
          ...values,
          isActive: true,
        });
      } else {
        const changes = Object.fromEntries(
          (Object.keys(values) as Array<keyof CategoryFormValues>)
            .filter((k) => values[k] !== editing[k])
            .map((k) => [k, values[k]]),
        );
        if (Object.keys(changes).length > 0)
          await run("category.update", { id: editing.id, changes });
      }
      setEditing(null);
    } catch {
      fail();
    }
  }

  async function toggleActive(category: Category, isActive: boolean) {
    try {
      await run("category.update", { id: category.id, changes: { isActive } });
    } catch {
      fail();
    }
  }

  async function remove(category: Category) {
    try {
      await run("category.delete", { id: category.id });
    } catch {
      fail();
    }
  }

  const displayName = (c: Category) =>
    locale === "bn" && c.nameBn ? c.nameBn : c.name;
  const otherName = (c: Category) =>
    locale === "bn" ? (c.nameBn ? c.name : "") : c.nameBn;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("categories.searchPlaceholder")}
            aria-label={t("categories.searchPlaceholder")}
            className="ps-9"
            inputMode="search"
          />
        </div>
        {canCreate ? (
          <Button onClick={() => setEditing("new")}>
            <Plus aria-hidden />
            <span className="max-sm:sr-only">{t("categories.add")}</span>
          </Button>
        ) : null}
      </div>

      {categories === undefined ||
      (!initialSyncDone && categories.length === 0) ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {categories.length === 0
            ? t("categories.empty")
            : t("categories.noMatch")}
        </p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {t("categories.count", {
              count: visible.length,
              n: f.integer(visible.length),
            })}
          </p>
          <ul className="flex flex-col gap-2">
            {visible.map((category) => (
              <li
                key={category.id}
                className="flex items-center gap-3 rounded-xl border bg-card p-3"
                data-testid="category-row"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">
                      {displayName(category)}
                    </span>
                    {!category.isActive ? (
                      <Badge variant="secondary">
                        {t("categories.inactive")}
                      </Badge>
                    ) : null}
                  </div>
                  {otherName(category) ? (
                    <p className="truncate text-sm text-muted-foreground">
                      {otherName(category)}
                    </p>
                  ) : null}
                  {category.description ? (
                    <p className="truncate text-xs text-muted-foreground">
                      {category.description}
                    </p>
                  ) : null}
                </div>
                {canEdit ? (
                  <>
                    <Switch
                      checked={category.isActive}
                      onCheckedChange={(checked) =>
                        toggleActive(category, checked)
                      }
                      aria-label={t("categories.active")}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setEditing(category)}
                      aria-label={t("common.edit")}
                    >
                      <Pencil aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setDeleting(category)}
                      aria-label={t("common.delete")}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      )}

      <ResponsiveDialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        title={editing === "new" ? t("categories.add") : t("categories.edit")}
      >
        {editing !== null ? (
          <CategoryForm
            key={editing === "new" ? "new" : editing.id}
            category={editing === "new" ? undefined : editing}
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
            <AlertDialogTitle>{t("categories.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting
                ? t("categories.deleteBody", { name: displayName(deleting) })
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleting) void remove(deleting);
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
