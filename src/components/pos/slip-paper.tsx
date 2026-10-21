"use client";

import type { ReceiptModel } from "@/lib/print/receipt-layout";
import { cn } from "@/lib/utils";
import { type ReceiptPaper, usePreferences } from "@/stores/preferences";

const PAPER: Record<
  ReceiptPaper,
  { page: string; width: string; text: string }
> = {
  "58mm": { page: "58mm auto", width: "max-w-[58mm]", text: "text-[11px]" },
  "80mm": { page: "80mm auto", width: "max-w-[80mm]", text: "text-xs" },
  a4: { page: "A4", width: "max-w-[190mm]", text: "text-sm" },
};

/**
 * A short slip (payment receipt) on screen and in the normal print window, drawn from the same
 * rows as the thermal print so both say exactly the same thing.
 */
export function SlipPaper({ model }: { model: ReceiptModel }) {
  const paper = usePreferences((s) => s.receiptPaper);
  const size = PAPER[paper];
  return (
    <div
      id="print-receipt"
      data-testid="slip-paper"
      className={cn(
        "mx-auto w-full bg-white p-3 font-mono text-black",
        size.width,
        size.text,
      )}
    >
      <style media="print">{`@page { size: ${size.page}; margin: 3mm; }`}</style>
      <div className="text-center">
        {model.header.map((line, i) => (
          <p key={line} className={i === 0 ? "text-base font-bold" : ""}>
            {line}
          </p>
        ))}
        {model.title ? (
          <p className="mt-1 text-sm font-bold">{model.title}</p>
        ) : null}
      </div>
      <div className="my-2 border-y border-dashed border-black py-1">
        {model.meta.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
      <div className="space-y-0.5">
        {model.totals.map((row) => (
          <Row key={row.label} {...row} />
        ))}
      </div>
      {model.standing.length > 0 ? (
        <div
          className="mt-1 space-y-0.5 border-t border-dashed border-black pt-1"
          data-testid="slip-standing"
        >
          {model.standing.map((row) => (
            <Row key={row.label} {...row} />
          ))}
        </div>
      ) : null}
      <p className="mt-3 text-center">{model.footer}</p>
    </div>
  );
}

function Row({
  label,
  value,
  bold,
}: {
  label: string;
  value: string;
  bold?: boolean;
}) {
  return (
    <div
      className={cn("flex justify-between gap-2", bold && "text-sm font-bold")}
    >
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
