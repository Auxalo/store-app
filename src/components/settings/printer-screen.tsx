"use client";

import {
  Bluetooth,
  Check,
  Loader2,
  Printer,
  Smartphone,
  Usb,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { BackLink } from "@/components/shared/back-link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  chooseBle,
  chooseSerial,
  PrintError,
  printSupport,
  RAWBT_PLAY_URL,
} from "@/lib/print/transports";
import { usePrintReceipt } from "@/lib/print/use-print-receipt";
import { cn } from "@/lib/utils";
import { type ReceiptPaper, usePreferences } from "@/stores/preferences";

const KINDS: ReceiptPaper[] = ["58mm", "80mm", "a4"];

/**
 * Settings → Printer, for people who are not technical: pick the paper (small receipt, big receipt,
 * A4), pick how the printer is connected (the buttons shown are only the ones this phone or
 * computer can do), print a test, done. After that every Print button prints in one tap.
 */
export function PrinterScreen() {
  const t = useTranslations("printer");
  const paper = usePreferences((s) => s.receiptPaper);
  const setPaper = usePreferences((s) => s.setReceiptPaper);
  const printer = usePreferences((s) => s.printer);
  const setPrinter = usePreferences((s) => s.setPrinter);
  const clearPrinter = usePreferences((s) => s.clearPrinter);
  const { test } = usePrintReceipt();
  const [busy, setBusy] = useState<"choose" | "test" | null>(null);
  const [message, setMessage] = useState<{
    kind: "ok" | "bad";
    text: string;
  } | null>(null);
  // Browser features are read after the page loads (they do not exist on the server).
  const [support, setSupport] = useState<ReturnType<
    typeof printSupport
  > | null>(null);
  useEffect(() => setSupport(printSupport()), []);

  const thermal = paper !== "a4";

  async function choose(kind: "serial" | "ble") {
    setBusy("choose");
    setMessage(null);
    try {
      if (kind === "serial") {
        const { name } = await chooseSerial();
        setPrinter({ via: "serial", name, id: undefined });
      } else {
        const { name, id } = await chooseBle();
        setPrinter({ via: "ble", name, id });
      }
      setMessage({ kind: "ok", text: t("chosen") });
    } catch (error) {
      if (!(error instanceof PrintError && error.code === "CANCELLED"))
        setMessage({ kind: "bad", text: t("chooseFailed") });
    } finally {
      setBusy(null);
    }
  }

  async function runTest() {
    setBusy("test");
    setMessage(null);
    const result = await test();
    setBusy(null);
    if (result.ok)
      setMessage({
        kind: "ok",
        text:
          printer.via === "system" || !thermal
            ? t("testSystem")
            : t("testSent"),
      });
    else
      setMessage({
        kind: "bad",
        text: t(`fail_${result.code}` as never),
      });
  }

  const optionClass = (on: boolean) =>
    cn(
      "flex w-full items-center gap-3 rounded-xl border p-3 text-start",
      on ? "border-primary bg-primary/10" : "hover:bg-muted/50",
    );

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
      <BackLink href="/settings" label={t("back")} />
      <p className="text-sm text-muted-foreground">{t("intro")}</p>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. {t("step1")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2" data-testid="printer-kinds">
          {KINDS.map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={paper === k}
              onClick={() => {
                setPaper(k);
                // A4 / office printers have a driver: the normal print window is the way.
                if (k === "a4") setPrinter({ via: "system", name: undefined });
                else if (printer.via === "system")
                  setPrinter({ via: null, name: undefined });
              }}
              className={optionClass(paper === k)}
              data-testid={`kind-${k}`}
            >
              <Printer className="size-5 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">
                  {t(`kind_${k}` as never)}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {t(`kindHint_${k}` as never)}
                </span>
              </span>
              {paper === k ? (
                <Check className="size-5 text-primary" aria-hidden />
              ) : null}
            </button>
          ))}
        </CardContent>
      </Card>

      {thermal ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">2. {t("step2")}</CardTitle>
            <p className="text-sm text-muted-foreground">{t("step2Hint")}</p>
          </CardHeader>
          <CardContent className="grid gap-2" data-testid="printer-ways">
            {support?.serial ? (
              <Button
                variant={printer.via === "serial" ? "default" : "outline"}
                className="h-auto justify-start gap-3 whitespace-normal py-3 text-start"
                onClick={() => void choose("serial")}
                disabled={busy !== null}
                data-testid="way-serial"
              >
                {busy === "choose" ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : support.android ? (
                  <Bluetooth aria-hidden />
                ) : (
                  <Usb aria-hidden />
                )}
                <span>
                  <span className="block font-medium">
                    {t(support.android ? "waySerialPhone" : "waySerialPc")}
                  </span>
                  <span className="block text-xs opacity-80">
                    {t(
                      support.android
                        ? "waySerialPhoneHint"
                        : "waySerialPcHint",
                    )}
                  </span>
                </span>
              </Button>
            ) : null}
            {support?.ble ? (
              <Button
                variant={printer.via === "ble" ? "default" : "outline"}
                className="h-auto justify-start gap-3 whitespace-normal py-3 text-start"
                onClick={() => void choose("ble")}
                disabled={busy !== null}
                data-testid="way-ble"
              >
                <Bluetooth aria-hidden />
                <span>
                  <span className="block font-medium">{t("wayBle")}</span>
                  <span className="block text-xs opacity-80">
                    {t("wayBleHint")}
                  </span>
                </span>
              </Button>
            ) : null}
            {support?.android ? (
              <div
                className={cn(
                  "rounded-xl border p-3",
                  printer.via === "rawbt" && "border-primary bg-primary/10",
                )}
              >
                <Button
                  variant={printer.via === "rawbt" ? "default" : "outline"}
                  className="h-auto w-full justify-start gap-3 whitespace-normal py-3 text-start"
                  onClick={() => {
                    setPrinter({ via: "rawbt", name: "RawBT", id: undefined });
                    setMessage({ kind: "ok", text: t("chosen") });
                  }}
                  data-testid="way-rawbt"
                >
                  <Smartphone aria-hidden />
                  <span>
                    <span className="block font-medium">{t("wayRawbt")}</span>
                    <span className="block text-xs opacity-80">
                      {t("wayRawbtHint")}
                    </span>
                  </span>
                </Button>
                <a
                  href={RAWBT_PLAY_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-block text-xs font-medium text-primary underline-offset-4 hover:underline"
                >
                  {t("rawbtInstall")}
                </a>
              </div>
            ) : null}
            {support && !support.serial && !support.ble && !support.android ? (
              <p className="rounded-lg bg-amber-500/10 p-2 text-sm">
                {t("noDirect")}
              </p>
            ) : null}
            <Button
              variant={printer.via === "system" ? "default" : "ghost"}
              className="justify-start"
              onClick={() => {
                setPrinter({ via: "system", name: undefined, id: undefined });
                setMessage({ kind: "ok", text: t("chosen") });
              }}
              data-testid="way-system"
            >
              {t("waySystem")}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <p className="rounded-xl border bg-card p-3 text-sm">{t("a4Note")}</p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {thermal ? "3." : "2."} {t("step3")}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm" data-testid="printer-status">
            {printer.via
              ? t("current", {
                  paper: t(`kind_${paper}` as never),
                  name:
                    printer.via === "system"
                      ? t("viaSystem")
                      : printer.name || t(`via_${printer.via}` as never),
                })
              : t("notSet")}
          </p>
          <Button
            size="lg"
            onClick={() => void runTest()}
            disabled={busy !== null || !printer.via}
            data-testid="printer-test"
          >
            {busy === "test" ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <Printer aria-hidden />
            )}
            {t("test")}
          </Button>
          {message ? (
            <p
              role="status"
              className={cn(
                "rounded-lg p-2 text-sm",
                message.kind === "ok"
                  ? "bg-emerald-500/10"
                  : "bg-destructive/10 text-destructive",
              )}
              data-testid="printer-message"
            >
              {message.text}
            </p>
          ) : null}
          <div className="flex items-center justify-between gap-3 border-t pt-3">
            <label htmlFor="auto-print" className="min-w-0 text-sm">
              <span className="block font-medium">{t("autoPrint")}</span>
              <span className="block text-xs text-muted-foreground">
                {t("autoPrintHint")}
              </span>
            </label>
            <Switch
              id="auto-print"
              checked={printer.autoPrint}
              onCheckedChange={(v) => setPrinter({ autoPrint: v })}
              data-testid="auto-print"
            />
          </div>
          {printer.via ? (
            <Button
              variant="ghost"
              size="sm"
              className="self-start text-destructive"
              onClick={() => {
                clearPrinter();
                toast.success(t("removed"));
              }}
              data-testid="printer-remove"
            >
              {t("remove")}
            </Button>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
