"use client";

import { type ComponentProps, useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { parseQty, roundToUnit } from "@/lib/qty";
import { type UnitCode, unitDecimals } from "@/lib/units";

interface QtyFieldProps
  extends Omit<ComponentProps<typeof Input>, "value" | "onChange"> {
  /** Milli-units. */
  value: number;
  unit: UnitCode;
  onValue: (milli: number) => void;
  /** Smallest accepted value (0 allows clearing, e.g. a return line). */
  min?: number;
  max?: number;
}

/**
 * A quantity box that respects the unit (pieces take whole numbers, kilograms up to 3 decimals) and
 * accepts Bangla digits. It keeps what you type while editing and shows the stored value otherwise.
 */
export function QtyField({
  value,
  unit,
  onValue,
  min = 1,
  max,
  ...props
}: QtyFieldProps) {
  const decimals = unitDecimals(unit);
  const [text, setText] = useState(String(value / 1000));
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) setText(String(value / 1000));
  }, [value, editing]);

  return (
    <Input
      {...props}
      value={text}
      inputMode="decimal"
      onFocus={(e) => {
        setEditing(true);
        e.target.select();
        props.onFocus?.(e);
      }}
      onBlur={(e) => {
        setEditing(false);
        props.onBlur?.(e);
      }}
      onChange={(e) => {
        setText(e.target.value);
        const qty = e.target.value.trim() === "" ? 0 : parseQty(e.target.value);
        if (qty === null || roundToUnit(qty, decimals) !== qty) return;
        if (qty >= min && (max === undefined || qty <= max)) onValue(qty);
      }}
    />
  );
}
