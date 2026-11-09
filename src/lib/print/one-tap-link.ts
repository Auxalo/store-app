/**
 * The mark the Windows one-tap desktop icon puts in the address it opens (see windows-setup.ts).
 * Kept apart from the setup file text so every page can read the mark without loading the rest.
 */

export type OneTapPaper = "58mm" | "80mm";

/**
 * The desktop icon's browser profile is new, so it knows nothing of this device's printer setup.
 * The address it opens says it instead: "#onetap-80mm" means "80 mm paper, printed through
 * Windows" (read by src/components/layout/printer-link-setup.tsx, then removed from the address).
 */
export const oneTapHash = (paper: OneTapPaper) => `#onetap-${paper}`;

export function oneTapPaperFromHash(hash: string): OneTapPaper | null {
  const match = /^#onetap-(58mm|80mm)$/.exec(hash);
  return match ? (match[1] as OneTapPaper) : null;
}
