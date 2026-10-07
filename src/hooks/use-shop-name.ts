"use client";

import { useProfile } from "@/auth/use-auth";
import { useSetting } from "@/hooks/use-setting";

const NO_PROFILE = { name: "", address: "", phone: "" };

/**
 * The shop's name as the owner wrote it in Settings, or the one it was registered with. Receipts
 * already read it this way; the sidebar and menu now do too, so the name is the same everywhere in
 * the shop's own screens.
 */
export function useShopName(): string | undefined {
  const { storeName } = useProfile();
  const written = useSetting("store.profile", NO_PROFILE).value.name?.trim();
  return written || storeName;
}
