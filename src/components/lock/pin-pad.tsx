"use client";

import { Delete } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { bnToEn } from "@/lib/numerals";
import { cn } from "@/lib/utils";

const DOTS = ["a", "b", "c", "d", "e", "f"] as const;
const MAX = 6;

interface PinPadProps {
  value: string;
  onChange: (value: string) => void;
  /** Called on Enter / the unlock button, or automatically at 6 digits. */
  onSubmit: () => void;
  disabled?: boolean;
}

/** Big on-screen keypad (also works with a keyboard, Bangla digits included). */
export function PinPad({ value, onChange, onSubmit, disabled }: PinPadProps) {
  const t = useTranslations("lock");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (disabled) return;
      const key = bnToEn(e.key);
      if (/^\d$/.test(key)) {
        if (value.length < MAX) onChange(value + key);
      } else if (e.key === "Backspace") onChange(value.slice(0, -1));
      else if (e.key === "Enter") onSubmit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [value, onChange, onSubmit, disabled]);

  const press = (digit: string) => {
    if (disabled || value.length >= MAX) return;
    onChange(value + digit);
  };

  return (
    <div className="flex w-full max-w-xs flex-col items-center gap-5">
      <div
        className="flex h-6 items-center gap-3"
        role="img"
        aria-label={`${value.length} digits`}
        data-testid="pin-dots"
      >
        {DOTS.map((id, i) => (
          <span
            key={id}
            className={cn(
              "size-3 rounded-full border",
              i < value.length
                ? "border-primary bg-primary"
                : "border-muted-foreground/40",
            )}
          />
        ))}
      </div>

      <div className="grid w-full grid-cols-3 gap-3">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <Button
            key={d}
            type="button"
            variant="outline"
            className="h-16 text-2xl"
            disabled={disabled}
            onClick={() => press(d)}
            data-testid={`pin-${d}`}
          >
            {d}
          </Button>
        ))}
        <Button
          type="button"
          variant="ghost"
          className="h-16"
          disabled={disabled || value.length === 0}
          onClick={() => onChange(value.slice(0, -1))}
          aria-label={t("delete")}
        >
          <Delete className="size-6" aria-hidden />
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-16 text-2xl"
          disabled={disabled}
          onClick={() => press("0")}
          data-testid="pin-0"
        >
          0
        </Button>
        <Button
          type="button"
          className="h-16"
          disabled={disabled || value.length < 4}
          onClick={onSubmit}
          data-testid="pin-submit"
        >
          {t("unlock")}
        </Button>
      </div>
    </div>
  );
}
