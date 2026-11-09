"use client";

import {
  Bluetooth,
  Check,
  Copy,
  Download,
  Loader2,
  type LucideIcon,
  Printer,
  Smartphone,
  SquareMousePointer,
  Usb,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";
import { SlipPaper } from "@/components/pos/slip-paper";
import { BackLink } from "@/components/shared/back-link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useFormat } from "@/i18n/use-format";
import {
  chooseBle,
  chooseSerial,
  chooseUsb,
  PrintError,
  printSupport,
  RAWBT_PLAY_URL,
} from "@/lib/print/transports";
import { usePrintReceipt } from "@/lib/print/use-print-receipt";
import {
  appStartUrl,
  type OneTapPaper,
  SETUP_FILE_NAME,
  setupScript,
  shortcutLine,
} from "@/lib/print/windows-setup";
import { cn } from "@/lib/utils";
import { type ReceiptPaper, usePreferences } from "@/stores/preferences";

const KINDS: ReceiptPaper[] = ["58mm", "80mm", "a4"];

type Way = "windows" | "usb" | "serial" | "ble" | "rawbt";
type Support = ReturnType<typeof printSupport>;

/** The ways this phone or computer can reach a receipt printer, the best one first. */
function waysFor(s: Support): Way[] {
  const has = (on: boolean, way: Way): Way[] => (on ? [way] : []);
  // Windows: a USB printer is a Windows printer (its driver holds it), so it prints through Windows.
  if (s.windows)
    return ["windows", ...has(s.serial, "serial"), ...has(s.ble, "ble")];
  // Android: most receipt printers there are Bluetooth.
  if (s.android)
    return [
      ...has(s.serial, "serial"),
      ...has(s.usb, "usb"),
      ...has(s.ble, "ble"),
      "rawbt",
    ];
  // Mac, Chromebook, Linux: a USB printer can be reached directly.
  return [
    ...has(s.usb, "usb"),
    ...has(s.serial, "serial"),
    ...has(s.ble, "ble"),
  ];
}

/**
 * Settings → Printer, for people who are not technical: pick the paper (small receipt, big receipt,
 * A4), pick how the printer is connected (only the ways this phone or computer can do are shown,
 * the best one first), print a test, done. After that every Print button prints in one tap.
 */
export function PrinterScreen() {
  const t = useTranslations("printer");
  const paper = usePreferences((s) => s.receiptPaper);
  const setPaper = usePreferences((s) => s.setReceiptPaper);
  const printer = usePreferences((s) => s.printer);
  const setPrinter = usePreferences((s) => s.setPrinter);
  const clearPrinter = usePreferences((s) => s.clearPrinter);
  const { test, testModel } = usePrintReceipt();
  const [busy, setBusy] = useState<"serial" | "ble" | "usb" | "test" | null>(
    null,
  );
  const [message, setMessage] = useState<{
    kind: "ok" | "bad";
    text: string;
  } | null>(null);
  // Browser features are read after the page loads (they do not exist on the server).
  const [support, setSupport] = useState<Support | null>(null);
  useEffect(() => setSupport(printSupport()), []);

  const thermal = paper !== "a4";
  const ways = support ? waysFor(support) : [];
  const viaWindow =
    !thermal || printer.via === "system" || printer.via === "windows";

  async function choose(kind: "serial" | "ble" | "usb") {
    setBusy(kind);
    setMessage(null);
    try {
      if (kind === "serial") {
        const { name } = await chooseSerial();
        setPrinter({ via: "serial", name, id: undefined });
      } else if (kind === "ble") {
        const { name, id } = await chooseBle();
        setPrinter({ via: "ble", name, id });
      } else {
        const { name, id } = await chooseUsb();
        setPrinter({ via: "usb", name, id });
      }
      setMessage({ kind: "ok", text: t("chosen") });
    } catch (error) {
      const code = error instanceof PrintError ? error.code : null;
      if (code === "CANCELLED") return;
      setMessage({
        kind: "bad",
        text:
          code === "BLOCKED" || code === "NO_OUTPUT"
            ? t(`fail_${code}`)
            : t("chooseFailed"),
      });
    } finally {
      setBusy(null);
    }
  }

  function pick(via: "rawbt" | "windows" | "system") {
    setPrinter({
      via,
      name: via === "rawbt" ? "RawBT" : undefined,
      id: undefined,
    });
    setMessage({
      kind: "ok",
      text: via === "windows" ? t("chosenWindows") : t("chosen"),
    });
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
          printer.via === "windows" && thermal
            ? t("testWindows")
            : viaWindow
              ? t("testSystem")
              : t("testSent"),
      });
    else
      setMessage({
        kind: "bad",
        text: t(`fail_${result.code}` as never),
      });
  }

  const phone = !!support?.android;
  const way = (w: Way, first: boolean) => {
    const common = {
      badge: first ? t("recommended") : undefined,
      testId: `way-${w}`,
    };
    switch (w) {
      case "windows":
        return (
          <Choice
            key={w}
            {...common}
            icon={Usb}
            title={t("wayWindows")}
            hint={t("wayWindowsHint")}
            selected={printer.via === "windows"}
            onClick={() => pick("windows")}
          />
        );
      case "usb":
        return (
          <Choice
            key={w}
            {...common}
            icon={Usb}
            title={t(phone ? "wayUsbPhone" : "wayUsb")}
            hint={t(phone ? "wayUsbPhoneHint" : "wayUsbHint")}
            selected={printer.via === "usb"}
            busy={busy === "usb"}
            disabled={busy !== null}
            onClick={() => void choose("usb")}
          />
        );
      case "serial":
        return (
          <Choice
            key={w}
            {...common}
            icon={Bluetooth}
            title={t(phone ? "waySerialPhone" : "waySerialPc")}
            hint={t(phone ? "waySerialPhoneHint" : "waySerialPcHint")}
            selected={printer.via === "serial"}
            busy={busy === "serial"}
            disabled={busy !== null}
            onClick={() => void choose("serial")}
          />
        );
      case "ble":
        return (
          <Choice
            key={w}
            {...common}
            icon={Bluetooth}
            title={t("wayBle")}
            hint={t("wayBleHint")}
            selected={printer.via === "ble"}
            busy={busy === "ble"}
            disabled={busy !== null}
            onClick={() => void choose("ble")}
          />
        );
      case "rawbt":
        return (
          <div key={w} className="flex flex-col gap-1">
            <Choice
              {...common}
              icon={Smartphone}
              title={t("wayRawbt")}
              hint={t("wayRawbtHint")}
              selected={printer.via === "rawbt"}
              onClick={() => pick("rawbt")}
            />
            <a
              href={RAWBT_PLAY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="self-start px-3 text-xs font-medium text-primary underline-offset-4 hover:underline"
            >
              {t("rawbtInstall")}
            </a>
          </div>
        );
    }
  };

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
            <Choice
              key={k}
              icon={Printer}
              title={t(`kind_${k}` as never)}
              hint={t(`kindHint_${k}` as never)}
              selected={paper === k}
              onClick={() => {
                setPaper(k);
                // A4 / office printers have a driver: the normal print window is the way.
                if (k === "a4") setPrinter({ via: "system", name: undefined });
                else if (printer.via === "system")
                  setPrinter({ via: null, name: undefined });
              }}
              testId={`kind-${k}`}
            />
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
            {ways.map((w, i) => way(w, i === 0))}
            {support && ways.length === 0 ? (
              <p className="rounded-lg bg-amber-500/10 p-2 text-sm">
                {t("noDirect")}
              </p>
            ) : null}
            <Choice
              icon={SquareMousePointer}
              title={t("waySystem")}
              hint={t("waySystemHint")}
              selected={printer.via === "system"}
              onClick={() => pick("system")}
              testId="way-system"
            />
          </CardContent>
        </Card>
      ) : (
        <p className="rounded-xl border bg-card p-3 text-sm">{t("a4Note")}</p>
      )}

      {thermal && support?.windows && printer.via === "windows" ? (
        <WindowsOneTap paper={paper as OneTapPaper} />
      ) : null}

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

      {/* What the print window prints for Test print (only the receipt is printed, see globals.css). */}
      {viaWindow ? (
        <div className="hidden print:block">
          <SlipPaper model={testModel} />
        </div>
      ) : null}
    </div>
  );
}

/** One big choice: icon, name, a line of help, a tick when chosen. Grows with its text. */
function Choice({
  icon: Icon,
  title,
  hint,
  badge,
  selected,
  busy = false,
  disabled = false,
  onClick,
  testId,
}: {
  icon: LucideIcon;
  title: string;
  hint: string;
  badge?: string;
  selected: boolean;
  busy?: boolean;
  disabled?: boolean;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex w-full items-start gap-3 rounded-xl border p-3 text-start transition-colors disabled:cursor-not-allowed disabled:opacity-60",
        selected
          ? "border-primary bg-primary/10"
          : "hover:bg-muted/50 focus-visible:bg-muted/50",
      )}
      data-testid={testId}
    >
      <span
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-lg",
          selected ? "bg-primary text-primary-foreground" : "bg-muted",
        )}
      >
        {busy ? (
          <Loader2 className="size-5 animate-spin" aria-hidden />
        ) : (
          <Icon className="size-5" aria-hidden />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium leading-snug">
          {title}
          {badge ? (
            <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-primary">
              {badge}
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 block text-xs text-muted-foreground">
          {hint}
        </span>
      </span>
      {selected ? (
        <Check className="mt-2 size-5 shrink-0 text-primary" aria-hidden />
      ) : null}
    </button>
  );
}

/**
 * A USB receipt printer on Windows prints through Windows. This makes that one tap, once: a setup
 * file (or the same by hand) sets the receipt printer as the main printer and puts a desktop icon
 * that opens the app with printing that skips the print window. See src/lib/print/windows-setup.ts.
 */
function WindowsOneTap({ paper }: { paper: OneTapPaper }) {
  const t = useTranslations("printer");
  const [copied, setCopied] = useState(false);
  const url = appStartUrl(window.location.origin, paper);
  let line = "";
  try {
    line = shortcutLine(url);
  } catch {
    /* an unusual address: only the setup file's own check would refuse it too */
  }

  function download() {
    let text: string;
    try {
      text = setupScript(url);
    } catch {
      toast.error(t("oneTapFailed"));
      return;
    }
    const href = URL.createObjectURL(
      new Blob([text], { type: "application/octet-stream" }),
    );
    const a = document.createElement("a");
    a.href = href;
    a.download = SETUP_FILE_NAME;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 10_000);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(line);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t("copyFailed"));
    }
  }

  return (
    <Card className="border-primary/40" data-testid="windows-onetap">
      <CardHeader>
        <CardTitle className="text-base">{t("oneTapTitle")}</CardTitle>
        <p className="text-sm text-muted-foreground">{t("oneTapIntro")}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ol className="flex flex-col gap-3">
          <Step n={1}>
            <p>{t("oneTapStep1")}</p>
            <Button
              className="mt-2 h-auto min-h-10 w-full whitespace-normal py-2 md:h-auto sm:w-auto"
              onClick={download}
              data-testid="onetap-download"
            >
              <Download aria-hidden />
              {t("oneTapDownload")}
            </Button>
            <p className="mt-2 text-xs text-muted-foreground">
              {t("oneTapWarn")}
            </p>
          </Step>
          <Step n={2}>{t("oneTapStep2")}</Step>
          <Step n={3}>{t("oneTapStep3")}</Step>
          <Step n={4}>{t("oneTapStep4")}</Step>
        </ol>
        <p className="rounded-lg bg-muted p-2 text-xs">
          {t("oneTapNoPrinter")}
        </p>
        <details className="rounded-lg border p-3 text-sm">
          <summary className="cursor-pointer font-medium">
            {t("oneTapManual")}
          </summary>
          <ol className="mt-3 list-decimal space-y-3 ps-5">
            <li>{t("oneTapManual1")}</li>
            <li>
              {t("oneTapManual2")}
              <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-start">
                <code
                  className="min-w-0 flex-1 rounded-md bg-muted p-2 font-mono text-[11px] break-all"
                  data-testid="onetap-line"
                >
                  {line}
                </code>
                <Button
                  size="sm"
                  variant="outline"
                  className="self-start"
                  onClick={() => void copy()}
                >
                  {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                  {copied ? t("copied") : t("copy")}
                </Button>
              </div>
            </li>
            <li>{t("oneTapManual3")}</li>
          </ol>
        </details>
      </CardContent>
    </Card>
  );
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  const f = useFormat();
  return (
    <li className="flex gap-3">
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
        {f.integer(n)}
      </span>
      <div className="min-w-0 flex-1 pt-0.5 text-sm">{children}</div>
    </li>
  );
}
