"use client";

import { useEffect } from "react";
import { oneTapPaperFromHash } from "@/lib/print/one-tap-link";
import { usePreferences } from "@/stores/preferences";

/**
 * The Windows one-tap desktop icon opens the app at /pos#onetap-80mm, in a browser profile of its
 * own that knows nothing of this device's printer setup (see src/lib/print/windows-setup.ts). This
 * sets it there: that paper, printed through Windows. Runs on whatever page opens first (the
 * sign-in page included), then removes the mark from the address.
 */
export function PrinterLinkSetup() {
  useEffect(() => {
    const paper = oneTapPaperFromHash(window.location.hash);
    if (!paper) return;
    const prefs = usePreferences.getState();
    prefs.setReceiptPaper(paper);
    prefs.setPrinter({ via: "windows", name: undefined, id: undefined });
    window.history.replaceState(
      window.history.state,
      "",
      window.location.pathname + window.location.search,
    );
  }, []);
  return null;
}
