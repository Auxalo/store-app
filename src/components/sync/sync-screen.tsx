"use client";

import { useLiveQuery } from "dexie-react-hooks";
import {
  AlertTriangle,
  CheckCircle2,
  CloudOff,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getLocalDb } from "@/db/local/db";
import { getMeta } from "@/db/local/meta";
import type { OutboxOp } from "@/db/local/types";
import { useFormat } from "@/i18n/use-format";
import { nudgeSync, syncNow } from "@/sync/manager";
import {
  discardOperation,
  resolveConflict,
  retryOperation,
} from "@/sync/resolve";
import { useSyncStatus } from "@/sync/use-sync-status";

const CLOCK_SKEW_WARN_MS = 5 * 60_000;

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-all text-end font-medium">{children}</dd>
    </div>
  );
}

/** "category.update" → "categoryUpdate", to look up its label. */
const opKey = (type: string) =>
  type.replace(/\.(\w)/, (_, c: string) => c.toUpperCase());

function ChangeSummary({ op }: { op: OutboxOp }) {
  const server = op.serverDoc as Record<string, unknown> | undefined;
  const changes = (op.payload as { changes?: Record<string, unknown> }).changes;
  if (!changes || !server) return null;
  return (
    <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
      {Object.entries(changes).map(([field, mine]) => (
        <li key={field}>
          {field}:{" "}
          <span className="font-medium text-foreground">{String(mine)}</span> ↔{" "}
          {String(server[field] ?? "")}
        </li>
      ))}
    </ul>
  );
}

export function SyncScreen() {
  const t = useTranslations("sync");
  const f = useFormat();
  const status = useSyncStatus();

  const attention = useLiveQuery(
    () =>
      getLocalDb()
        .outbox.where("status")
        .anyOf("failed", "conflict")
        .toArray()
        .then((ops) => ops.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))),
    [],
    [] as OutboxOp[],
  );
  const cursor = useLiveQuery(() => getMeta(getLocalDb(), "cursor"), []);

  const [storage, setStorage] = useState<{
    persisted: boolean;
    usage?: number;
    quota?: number;
  }>();
  useEffect(() => {
    void (async () => {
      const persisted = (await navigator.storage?.persisted?.()) ?? false;
      const estimate = await navigator.storage?.estimate?.();
      setStorage({ persisted, usage: estimate?.usage, quota: estimate?.quota });
    })();
  }, []);

  const bytes = (n: number) =>
    `${f.number(Math.round((n / 1024 / 1024) * 10) / 10)} MB`;
  const skewMinutes =
    status.clockOffsetMs !== undefined
      ? Math.round(Math.abs(status.clockOffsetMs) / 60_000)
      : 0;
  const skewed =
    status.clockOffsetMs !== undefined &&
    Math.abs(status.clockOffsetMs) > CLOCK_SKEW_WARN_MS;

  const headline = {
    issue: t("statusIssue"),
    offline: t("statusOffline"),
    syncing: t("statusSyncing"),
    pending: t("statusPending", {
      count: status.pending,
      n: f.integer(status.pending),
    }),
    synced: t("statusSynced"),
  }[status.indicator];
  const Icon = {
    issue: AlertTriangle,
    offline: CloudOff,
    syncing: Loader2,
    pending: RefreshCw,
    synced: CheckCircle2,
  }[status.indicator];

  const reason = (code?: string) => {
    const key = `reasons.${code ?? "UNKNOWN"}` as Parameters<typeof t>[0];
    return t.has(key) ? t(key) : t("reasons.UNKNOWN");
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <Card>
        <CardContent className="flex flex-col gap-4 pt-4">
          <div className="flex items-start gap-3">
            <Icon
              className={`mt-0.5 size-5 shrink-0 ${status.indicator === "syncing" ? "animate-spin" : ""}`}
              aria-hidden
            />
            <p
              className="flex-1 text-sm font-medium"
              data-testid="sync-headline"
            >
              {headline}
            </p>
            <Button
              onClick={() => void syncNow()}
              disabled={status.running || !status.online}
            >
              <RefreshCw
                className={status.running ? "animate-spin" : ""}
                aria-hidden
              />
              {t("syncNow")}
            </Button>
          </div>

          {status.problem && status.problem !== "network" ? (
            <p
              role="alert"
              className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive"
            >
              {t(`problem.${status.problem}`)}
            </p>
          ) : null}
          {skewed ? (
            <p role="alert" className="rounded-lg bg-amber-500/10 p-3 text-sm">
              {t("clockSkew", { minutes: f.integer(skewMinutes) })}
            </p>
          ) : null}

          <div className="grid grid-cols-3 gap-2 text-center">
            {(
              [
                ["pending", status.pending],
                ["failed", status.failed],
                ["conflicts", status.conflict],
              ] as const
            ).map(([key, value]) => (
              <div key={key} className="rounded-lg border p-2">
                <div
                  className="text-xl font-semibold"
                  data-testid={`count-${key}`}
                >
                  {f.integer(value)}
                </div>
                <div className="text-xs text-muted-foreground">{t(key)}</div>
              </div>
            ))}
          </div>

          <dl className="divide-y">
            <Row label={t("lastSync")}>
              {status.lastSyncAt ? f.dateTime(status.lastSyncAt) : t("never")}
            </Row>
            <Row label={t("lastAttempt")}>
              {status.lastAttemptAt
                ? f.dateTime(status.lastAttemptAt)
                : t("never")}
            </Row>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("queue")}</CardTitle>
        </CardHeader>
        <CardContent>
          {attention.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("queueEmpty")}</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {attention.map((op) => (
                <li
                  key={op.operationId}
                  className="rounded-lg border p-3"
                  data-testid="attention-row"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">
                      {t(`ops.${opKey(op.type)}` as Parameters<typeof t>[0])}
                    </span>
                    <Badge
                      variant={
                        op.status === "conflict" ? "secondary" : "destructive"
                      }
                    >
                      {op.status === "conflict" ? t("conflicts") : t("failed")}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {f.dateTime(op.createdAt)} · {reason(op.lastError)}
                  </p>
                  {op.status === "conflict" ? <ChangeSummary op={op} /> : null}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {op.status === "conflict" ? (
                      <>
                        <Button
                          size="sm"
                          onClick={() =>
                            void resolveConflict(
                              getLocalDb(),
                              op.operationId,
                              "mine",
                            ).then(nudgeSync)
                          }
                        >
                          {t("keepMine")}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            void resolveConflict(
                              getLocalDb(),
                              op.operationId,
                              "server",
                            )
                          }
                        >
                          {t("keepServer")}
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          onClick={() =>
                            void retryOperation(
                              getLocalDb(),
                              op.operationId,
                            ).then(() => syncNow())
                          }
                        >
                          {t("retry")}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            void discardOperation(getLocalDb(), op.operationId)
                          }
                        >
                          {t("discard")}
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("device")}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="divide-y">
            <Row label={t("deviceCode")}>
              {status.deviceCode ?? t("deviceNotRegistered")}
            </Row>
            <Row label={t("deviceId")}>
              <code className="text-xs">{status.deviceId ?? "…"}</code>
            </Row>
            <Row label={t("cursor")}>{f.integer(cursor ?? 0)}</Row>
            <Row label={t("storage")}>
              {storage?.usage !== undefined && storage.quota !== undefined
                ? t("storageUsage", {
                    used: bytes(storage.usage),
                    quota: bytes(storage.quota),
                  })
                : "…"}
            </Row>
          </dl>
          {storage ? (
            <p className="mt-2 text-xs text-muted-foreground">
              {storage.persisted
                ? t("storagePersisted")
                : t("storageNotPersisted")}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
