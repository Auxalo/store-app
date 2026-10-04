"use client";

import {
  Check,
  ChevronRight,
  Download,
  KeyRound,
  PackagePlus,
  ScrollText,
  Smartphone,
} from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { can } from "@/auth/permissions";
import { useProfile } from "@/auth/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDataMode } from "@/data/mode-store";
import { getLocalDb } from "@/db/local/db";
import { useSetting } from "@/hooks/use-setting";
import { download, toCsv } from "@/lib/export";
import { parseDecimal } from "@/lib/numerals";
import { type ReceiptPaper, usePreferences } from "@/stores/preferences";
import { AuditToggleCard } from "./audit-toggle";

export type StoreProfile = {
  name: string;
  address: string;
  phone: string;
};
const EMPTY_PROFILE: StoreProfile = { name: "", address: "", phone: "" };

/** Owner's settings: store details, receipt, security, and links to staff, devices, audit and export. */
export function SettingsScreen() {
  const t = useTranslations();
  const { role, storeName } = useProfile();
  const paper = usePreferences((s) => s.receiptPaper);
  const setPaper = usePreferences((s) => s.setReceiptPaper);

  const profile = useSetting<StoreProfile>("store.profile", EMPTY_PROFILE);
  const footer = useSetting<string>("receipt.footer", "");
  const idle = useSetting<number>("security.idleLockMinutes", 10);

  const [form, setForm] = useState<StoreProfile>({
    ...EMPTY_PROFILE,
    name: storeName ?? "",
  });
  const [footerText, setFooterText] = useState("");
  const [idleText, setIdleText] = useState("10");
  const [exporting, setExporting] = useState(false);

  // Fill the boxes once from what is saved; later edits are the user's until saved.
  const savedProfile = JSON.stringify(profile.value);
  // biome-ignore lint/correctness/useExhaustiveDependencies: refill only when the saved value changes
  useEffect(
    () =>
      setForm({
        ...EMPTY_PROFILE,
        ...profile.value,
        name: profile.value.name || (storeName ?? ""),
      }),
    [savedProfile, storeName],
  );
  useEffect(() => setFooterText(footer.value), [footer.value]);
  useEffect(() => setIdleText(String(idle.value)), [idle.value]);
  // In online mode the shop's data lives on the server, so this device has nothing to download.
  const online = useDataMode() === "online";

  if (!can(role, "settings.manage"))
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        {t("settings.noAccess")}
      </p>
    );

  const saved = () => toast.success(t("settings.saved"));
  // A save that fails must say so (it used to do nothing, and the person thought it was saved).
  const failed = () => toast.error(t("common.somethingWrong"));

  async function exportAll() {
    setExporting(true);
    try {
      const db = getLocalDb();
      const names = [
        "categories",
        "products",
        "stockMovements",
        "customers",
        "suppliers",
        "sales",
        "saleItems",
        "purchases",
        "purchaseItems",
        "payments",
        "expenses",
        "returns",
        "ledgerEntries",
        "settings",
      ] as const;
      const data = Object.fromEntries(
        await Promise.all(
          names.map(async (n) => [n, await db.table(n).toArray()]),
        ),
      );
      download(
        `store-backup-${new Date().toISOString().slice(0, 10)}.json`,
        JSON.stringify({ exportedAt: new Date().toISOString(), data }, null, 2),
        "application/json",
      );
    } finally {
      setExporting(false);
    }
  }

  // Amounts are kept in poisha and stock in thousandths inside; a spreadsheet gets taka and units.
  const MONEY = new Set([
    "purchasePrice",
    "sellingPrice",
    "balance",
    "total",
    "paid",
    "due",
  ]);
  async function exportCsv(
    table: "products" | "customers" | "suppliers" | "sales",
    columns: string[],
  ) {
    const rows = (await getLocalDb().table(table).toArray())
      .filter((r) => !r.deletedAt)
      .map((r) => {
        const row: Record<string, unknown> = { ...r };
        for (const column of columns) {
          if (typeof row[column] !== "number") continue;
          if (MONEY.has(column)) row[column] = (row[column] as number) / 100;
          else if (column === "stock")
            row[column] = (row[column] as number) / 1000;
        }
        return row;
      });
    download(
      `${table}-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(rows, columns),
      "text/csv",
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("settings.store")}</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void profile.set(form).then(saved, failed);
            }}
          >
            <FieldGroup>
              {(["name", "address", "phone"] as const).map((field) => (
                <Field key={field}>
                  <FieldLabel htmlFor={`store-${field}`}>
                    {t(
                      `settings.${field === "name" ? "storeName" : field}` as never,
                    )}
                  </FieldLabel>
                  <Input
                    id={`store-${field}`}
                    value={form[field]}
                    maxLength={120}
                    onChange={(e) =>
                      setForm({ ...form, [field]: e.target.value })
                    }
                    data-testid={`store-${field}`}
                  />
                </Field>
              ))}
              <Button
                type="submit"
                className="self-end"
                data-testid="save-store"
              >
                <Check aria-hidden />
                {t("common.save")}
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("settings.receipt")}</CardTitle>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void footer.set(footerText).then(saved, failed);
              }}
            >
              <Field>
                <FieldLabel htmlFor="receipt-footer">
                  {t("settings.receiptFooter")}
                </FieldLabel>
                <Input
                  id="receipt-footer"
                  value={footerText}
                  maxLength={120}
                  onChange={(e) => setFooterText(e.target.value)}
                  data-testid="receipt-footer"
                />
                <FieldDescription>
                  {t("settings.receiptFooterHint")}
                </FieldDescription>
              </Field>
              <Button
                type="submit"
                variant="outline"
                size="sm"
                className="mt-2"
                data-testid="save-footer"
              >
                {t("common.save")}
              </Button>
            </form>
            <Field>
              <FieldLabel>{t("settings.paper")}</FieldLabel>
              <Select
                value={paper}
                onValueChange={(v) => setPaper(v as ReceiptPaper)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="58mm">{t("settings.paper58")}</SelectItem>
                  <SelectItem value="80mm">{t("settings.paper80")}</SelectItem>
                  <SelectItem value="a4">{t("settings.paperA4")}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("settings.security")}</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              // Bangla digits count ("৫" is 5); anything that is not a number is not saved
              // (it used to become 0, which turns the lock off).
              const typed = parseDecimal(idleText);
              if (Number.isNaN(typed)) {
                toast.error(t("validation.invalidNumber"));
                return;
              }
              const minutes = Math.max(0, Math.min(1440, Math.round(typed)));
              void idle.set(minutes).then(saved, failed);
            }}
          >
            <Field>
              <FieldLabel htmlFor="idle-lock">
                {t("settings.idleLock")}
              </FieldLabel>
              <Input
                id="idle-lock"
                inputMode="numeric"
                value={idleText}
                onChange={(e) => setIdleText(e.target.value)}
                data-testid="idle-lock"
              />
              <FieldDescription>{t("settings.idleLockHint")}</FieldDescription>
            </Field>
            <Button
              type="submit"
              variant="outline"
              size="sm"
              className="mt-2"
              data-testid="save-idle"
            >
              {t("common.save")}
            </Button>
          </form>
        </CardContent>
      </Card>

      <AuditToggleCard />

      <div className="grid gap-2">
        {[
          {
            href: "/settings/staff",
            icon: KeyRound,
            title: t("settings.staff"),
            hint: t("settings.staffHint"),
          },
          {
            href: "/settings/devices",
            icon: Smartphone,
            title: t("settings.devices"),
            hint: t("settings.devicesHint"),
          },
          {
            href: "/settings/setup",
            icon: PackagePlus,
            title: t("setup.settingsLink"),
            hint: t("setup.settingsLinkHint"),
          },
          {
            href: "/settings/audit",
            icon: ScrollText,
            title: t("settings.audit"),
            hint: t("settings.auditHint"),
          },
        ].map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="flex items-center gap-3 rounded-xl border bg-card p-3 hover:bg-muted/50"
          >
            <item.icon className="size-5 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{item.title}</span>
              <span className="block text-xs text-muted-foreground">
                {item.hint}
              </span>
            </span>
            <ChevronRight
              className="size-4 text-muted-foreground rtl:rotate-180"
              aria-hidden
            />
          </Link>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("settings.export")}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {online ? t("settings.exportOnlineHint") : t("settings.exportHint")}
          </p>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => void exportAll()}
            disabled={exporting || online}
            data-testid="export-json"
          >
            <Download aria-hidden />
            {exporting ? t("settings.exporting") : t("settings.exportJson")}
          </Button>
          <Button
            variant="outline"
            disabled={online}
            onClick={() =>
              void exportCsv("products", [
                "name",
                "nameBn",
                "sku",
                "barcode",
                "unit",
                "purchasePrice",
                "sellingPrice",
                "stock",
              ])
            }
          >
            <Download aria-hidden />
            {t("settings.exportCsv", { what: t("nav.products") })}
          </Button>
          <Button
            variant="outline"
            disabled={online}
            onClick={() =>
              void exportCsv("customers", [
                "name",
                "phone",
                "address",
                "balance",
              ])
            }
          >
            <Download aria-hidden />
            {t("settings.exportCsv", { what: t("nav.customers") })}
          </Button>
          <Button
            variant="outline"
            disabled={online}
            onClick={() =>
              void exportCsv("sales", [
                "invoiceNo",
                "createdAt",
                "customerName",
                "total",
                "paid",
                "due",
                "status",
              ])
            }
          >
            <Download aria-hidden />
            {t("settings.exportCsv", { what: t("nav.sales") })}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
