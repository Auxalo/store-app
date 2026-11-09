"use client";

import { PAPER } from "@/lib/print/paper";
import type { ReceiptModel } from "@/lib/print/receipt-layout";
import { cn } from "@/lib/utils";
import { usePreferences } from "@/stores/preferences";

/**
 * A receipt drawn from its rows (a payment slip, the printer test) on screen and in the normal
 * print window, from the same rows as the thermal print so both say exactly the same thing.
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
      <style media="print">{size.pageCss}</style>
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
      {model.items.length > 0 ? (
        <div className="mb-1 space-y-0.5 border-b border-dashed border-black pb-1">
          {model.items.map((item) => (
            <div
              key={`${item.name}|${item.detail}|${item.amount}`}
              className="flex justify-between gap-2"
            >
              <span className="min-w-0">
                <span className="block">{item.name}</span>
                <span className="block opacity-70">{item.detail}</span>
              </span>
              <span className="whitespace-nowrap">{item.amount}</span>
            </div>
          ))}
        </div>
      ) : null}
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
