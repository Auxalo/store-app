"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { can } from "@/auth/permissions";
import { useProfile } from "@/auth/use-auth";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useSetting } from "@/hooks/use-setting";
import { useFormat } from "@/i18n/use-format";
import { AUDIT_SETTING } from "@/lib/constants";
import { api } from "./api";

interface AuditRow {
  id: string;
  at: string;
  action: string;
  entity: string;
  userName: string;
  oldValue?: unknown;
  newValue?: unknown;
}

const PAGE = 50;

/** Short text for what changed, e.g. `120 → 150`. */
function change(row: AuditRow): string | null {
  const show = (v: unknown) =>
    v === undefined || v === null
      ? ""
      : typeof v === "object"
        ? JSON.stringify(v)
        : String(v);
  if (row.oldValue === undefined && row.newValue === undefined) return null;
  return `${show(row.oldValue)} → ${show(row.newValue)}`;
}

/** Who changed prices, stock and sales, newest first. Needs internet: the log lives on the server. */
export function AuditScreen() {
  const t = useTranslations();
  const f = useFormat();
  const { role } = useProfile();
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [more, setMore] = useState(false);
  const [offline, setOffline] = useState(false);
  const [loading, setLoading] = useState(false);
  const auditOn = useSetting<boolean>(AUDIT_SETTING, false).value;

  const load = useCallback(async (before?: string) => {
    setLoading(true);
    const query = `limit=${PAGE}${before ? `&before=${encodeURIComponent(before)}` : ""}`;
    const result = await api<{ logs: AuditRow[] }>(`/api/audit?${query}`);
    setLoading(false);
    if (!result.ok || !result.data) return setOffline(true);
    const logs = result.data.logs;
    setOffline(false);
    setMore(logs.length === PAGE);
    setRows((prev) => (before ? [...(prev ?? []), ...logs] : logs));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!can(role, "report.view"))
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        {t("settings.noAccess")}
      </p>
    );

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-3">
      {offline ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive"
        >
          {t("audit.needsInternet")}
        </p>
      ) : null}
      {!auditOn ? (
        <p
          className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
          data-testid="audit-off"
        >
          {t("audit.off")}{" "}
          {can(role, "settings.manage") ? (
            <Link href="/settings" className="font-medium text-primary">
              {t("audit.turnOn")}
            </Link>
          ) : null}
        </p>
      ) : null}
      {rows === null && !offline ? <Skeleton className="h-16 w-full" /> : null}
      {rows?.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {t("audit.empty")}
        </p>
      ) : null}
      <ul className="grid gap-2" data-testid="audit-list">
        {rows?.map((row) => {
          const key = row.action.replace(".", "_");
          const label = t.has(`audit.actions.${key}` as never)
            ? t(`audit.actions.${key}` as never)
            : row.action;
          const diff = change(row);
          return (
            <li
              key={row.id}
              className="rounded-xl border bg-card p-3"
              data-testid="audit-row"
            >
              <p className="font-medium">{label}</p>
              {diff ? (
                <p className="break-words text-sm text-muted-foreground">
                  {diff}
                </p>
              ) : null}
              <p className="text-xs text-muted-foreground">
                {t("audit.by", { name: row.userName })} · {f.dateTime(row.at)}
              </p>
            </li>
          );
        })}
      </ul>
      {more && rows?.length ? (
        <Button
          variant="outline"
          disabled={loading}
          onClick={() => void load(rows[rows.length - 1].at)}
        >
          {t("audit.loadMore")}
        </Button>
      ) : null}
    </div>
  );
}
