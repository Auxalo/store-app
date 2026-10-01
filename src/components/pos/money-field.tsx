"use client";

import { type ComponentProps, useState } from "react";
import { Input } from "@/components/ui/input";
import { parseMoney } from "@/lib/money";

interface MoneyFieldProps
  extends Omit<ComponentProps<typeof Input>, "value" | "onChange"> {
  /** Poisha, or null when empty. */
  value: number | null;
  /** Called with the parsed amount, or null when the box is empty. Invalid text is ignored. */
  onValue: (poisha: number | null) => void;
}

const show = (poisha: number | null) =>
  poisha === null ? "" : String(poisha / 100);

/**
 * A taka amount box. While you type it keeps exactly what you typed ("12." stays "12."); when you
 * leave it, it shows the stored amount, so it never drifts from the cart (e.g. after a sale clears it).
 * Bangla digits are accepted.
 */
export function MoneyField({ value, onValue, ...props }: MoneyFieldProps) {
  const [text, setText] = useState("");
  const [editing, setEditing] = useState(false);

  return (
    <Input
      {...props}
      value={editing ? text : show(value)}
      inputMode="decimal"
      onFocus={(e) => {
        setText(show(value));
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
        if (e.target.value.trim() === "") return onValue(null);
        const parsed = parseMoney(e.target.value);
        if (parsed !== null && parsed >= 0) onValue(parsed);
      }}
    />
  );
}
