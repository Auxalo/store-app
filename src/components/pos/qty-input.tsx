"use client";

import { Minus, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { parseQty, roundToUnit } from "@/lib/qty";
import { unitDecimals } from "@/lib/units";
import { type CartLine, useCart } from "@/stores/cart";

/** Quantity with − / + buttons and direct typing (kilograms accept decimals, pieces do not). */
export function QtyInput({ line }: { line: CartLine }) {
  const t = useTranslations("pos");
  const setQty = useCart((s) => s.setQty);
  const decimals = unitDecimals(line.unit);
  const smallest = 10 ** (3 - decimals);
  const [text, setText] = useState(String(line.qty / 1000));
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) setText(String(line.qty / 1000));
  }, [line.qty, editing]);

  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        aria-label={t("decrease")}
        disabled={line.qty <= smallest}
        onClick={() => setQty(line.key, Math.max(smallest, line.qty - 1000))}
      >
        <Minus aria-hidden />
      </Button>
      <Input
        value={text}
        inputMode="decimal"
        aria-label={t("qty")}
        className="h-9 w-14 px-1 text-center md:h-8"
        onFocus={(e) => {
          setEditing(true);
          e.target.select();
        }}
        onBlur={() => setEditing(false)}
        onChange={(e) => {
          setText(e.target.value);
          const qty = parseQty(e.target.value);
          if (qty !== null && qty > 0 && roundToUnit(qty, decimals) === qty)
            setQty(line.key, qty);
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        aria-label={t("increase")}
        onClick={() => setQty(line.key, line.qty + 1000)}
      >
        <Plus aria-hidden />
      </Button>
    </div>
  );
}
