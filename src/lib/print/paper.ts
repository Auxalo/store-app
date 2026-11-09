import type { ReceiptPaper } from "@/stores/preferences";

/**
 * How a receipt looks on screen and in the normal print window, per paper.
 *
 * Thermal rolls print with no page margins: the printer's own paper size is used, and with no
 * margin Chrome and Edge print no date / web address header or footer (there is no room), which
 * matters when printing with no print window (Windows one-tap printing). A little padding keeps the
 * text off the edge of the roll.
 */
export const PAPER: Record<
  ReceiptPaper,
  { pageCss: string; width: string; text: string }
> = {
  "58mm": {
    pageCss: "@page { margin: 0; }",
    width: "max-w-[58mm]",
    text: "text-[11px]",
  },
  "80mm": {
    pageCss: "@page { margin: 0; }",
    width: "max-w-[80mm]",
    text: "text-xs",
  },
  a4: {
    pageCss: "@page { size: A4; margin: 10mm; }",
    width: "max-w-[190mm]",
    text: "text-sm",
  },
};
