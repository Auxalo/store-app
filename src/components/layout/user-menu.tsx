"use client";

import { useLiveQuery } from "dexie-react-hooks";
import {
  KeyRound,
  Languages,
  LogOut,
  Monitor,
  Moon,
  Repeat,
  Sun,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { useState } from "react";
import { useProfile } from "@/auth/use-auth";
import { useSignOut } from "@/components/layout/sign-out";
import { PinDialog } from "@/components/lock/pin-dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getLocalDb } from "@/db/local/db";
import { useShopName } from "@/hooks/use-shop-name";
import { useFormat } from "@/i18n/use-format";
import type { NumeralSystem } from "@/lib/format";
import { useActiveUser } from "@/stores/active-user";
import { usePreferences } from "@/stores/preferences";
import { InstallAppMenuItem } from "./install-app";

export function UserMenu() {
  const t = useTranslations();
  const profile = useProfile();
  const shopName = useShopName();
  const { theme = "system", setTheme } = useTheme();
  const numerals = usePreferences((s) => s.numerals);
  const setNumerals = usePreferences((s) => s.setNumerals);

  const _f = useFormat();
  // Sends anything unsent first, then signs out and takes the shop's data off the device.
  const signOutFlow = useSignOut();
  const [settingPin, setSettingPin] = useState(false);
  const lock = useActiveUser((st) => st.lock);
  const pinUsers = useLiveQuery(
    () =>
      getLocalDb()
        .localUsers.filter((u) => u.isActive && (!!u.pinHash || !!u.hasPin))
        .count(),
    [],
    0,
  );

  const initial = profile.name.trim().charAt(0).toUpperCase() || "?";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full"
            aria-label={t("common.account")}
          >
            <Avatar className="size-8">
              <AvatarFallback>{initial}</AvatarFallback>
            </Avatar>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="flex flex-col gap-0.5">
            <span className="truncate text-sm font-medium">{profile.name}</span>
            <span className="truncate text-xs font-normal text-muted-foreground">
              {t(`role.${profile.role}`)}
              {shopName ? ` · ${shopName}` : ""}
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />

          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Sun aria-hidden />
              {t("common.theme")}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
                <DropdownMenuRadioItem value="light">
                  <Sun aria-hidden />
                  {t("common.themeLight")}
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="dark">
                  <Moon aria-hidden />
                  {t("common.themeDark")}
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="system">
                  <Monitor aria-hidden />
                  {t("common.themeSystem")}
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Languages aria-hidden />
              {t("common.numerals")}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup
                value={numerals}
                onValueChange={(v) => setNumerals(v as NumeralSystem)}
              >
                <DropdownMenuRadioItem value="auto">
                  {t("common.numeralsAuto")}
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="latn">
                  {t("common.numeralsLatn")}
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="beng">
                  {t("common.numeralsBeng")}
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          {pinUsers > 0 ? (
            <DropdownMenuItem onSelect={lock} data-testid="switch-user">
              <Repeat aria-hidden />
              {t("lock.switchUser")}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            onSelect={() => setSettingPin(true)}
            data-testid="set-my-pin"
          >
            <KeyRound aria-hidden />
            {t("pin.setMine")}
          </DropdownMenuItem>

          <InstallAppMenuItem />

          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => signOutFlow.request()}
            data-testid="sign-out"
          >
            <LogOut aria-hidden />
            {t("common.logout")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <PinDialog
        userId={profile.userId}
        userName={profile.name}
        role={profile.role}
        self
        open={settingPin}
        onClose={() => setSettingPin(false)}
      />

      {signOutFlow.dialog}
    </>
  );
}
