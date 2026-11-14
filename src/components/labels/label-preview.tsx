"use client";

import { ScanBarcode, TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import type { LabelProblem, LabelSize } from "@/lib/labels/label-layout";
import { renderLabel } from "@/lib/labels/render-label";
import { cn } from "@/lib/utils";

type Shown =
  | { status: "loading" }
  | { status: "ready"; src: string }
  | { status: "problem"; problem: LabelProblem };

/** What a label problem means, as words (the keys are in the "labels" messages). */
export function useProblemText() {
  const t = useTranslations("labels");
  return (problem: LabelProblem, size: LabelSize) => {
    switch (problem) {
      case "EMPTY":
        return t("noBarcodeTitle");
      case "UNSUPPORTED":
        return t("badCode");
      case "TOO_LONG":
        return t("tooLong");
      case "TOO_WIDE":
        return t("tooWide", { w: size.w, h: size.h });
    }
  };
}

/**
 * The sticker as it will print (the very same picture), on a soft mat, in the label's own
 * proportions. A product that cannot get a barcode shows a red dashed sticker saying why instead.
 */
export function LabelPreview({
  name,
  barcode,
  price,
  size,
  className,
}: {
  name: string;
  barcode: string;
  price?: string;
  size: LabelSize;
  className?: string;
}) {
  const t = useTranslations("labels");
  const problemText = useProblemText();
  const [shown, setShown] = useState<Shown>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    renderLabel({ name, barcode, price }, size)
      .then((r) => {
        if (cancelled) return;
        setShown(
          r.ok
            ? { status: "ready", src: r.src }
            : { status: "problem", problem: r.problem },
        );
      })
      .catch(() => {
        if (!cancelled) setShown({ status: "problem", problem: "UNSUPPORTED" });
      });
    return () => {
      cancelled = true;
    };
  }, [name, barcode, price, size]);

  return (
    <div
      className={cn(
        "flex flex-col items-center gap-2 rounded-xl bg-muted/60 p-4",
        className,
      )}
      data-testid="label-preview"
    >
      <div
        className="w-full max-w-[18rem]"
        style={{ aspectRatio: `${size.w} / ${size.h}` }}
      >
        {shown.status === "ready" ? (
          // biome-ignore lint/performance/noImgElement: a picture made on this device
          <img
            src={shown.src}
            alt={t("previewAlt")}
            className="size-full rounded-md bg-white shadow-md ring-1 ring-black/10"
            style={{ imageRendering: "pixelated" }}
            data-testid="label-preview-image"
          />
        ) : shown.status === "problem" ? (
          <div
            className="flex size-full flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-destructive/60 bg-destructive/5 p-2 text-center text-destructive"
            data-testid="label-preview-problem"
          >
            {shown.problem === "EMPTY" ? (
              <ScanBarcode className="size-6" aria-hidden />
            ) : (
              <TriangleAlert className="size-6" aria-hidden />
            )}
            <span className="text-xs font-medium leading-snug">
              {shown.problem === "EMPTY"
                ? t("noCode")
                : problemText(shown.problem, size)}
            </span>
          </div>
        ) : (
          <div className="size-full animate-pulse rounded-md bg-white/70 ring-1 ring-black/5" />
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {t("sizeMm", { w: size.w, h: size.h })}
      </p>
    </div>
  );
}
