"use client";

import { ArrowLeft, Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { lockoutState } from "@/auth/lockout";
import { verifyPin } from "@/auth/pin";
import { signOut } from "@/auth/use-auth";
import { PinPad } from "@/components/lock/pin-pad";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { getLocalDb } from "@/db/local/db";
import type { LocalUser } from "@/db/local/types";
import { useFormat } from "@/i18n/use-format";

interface LockScreenProps {
  users: LocalUser[];
  storeName?: string;
  onUnlock: (userId: string) => void;
}

/** "Who is working?" then a PIN. Checked on this device, so it works with no internet. */
export function LockScreen({ users, storeName, onUnlock }: LockScreenProps) {
  const t = useTranslations();
  const f = useFormat();
  const router = useRouter();
  const [selected, setSelected] = useState<LocalUser | null>(null);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Re-read the chosen person so wrong-PIN counters stay current.
  const current = selected
    ? (users.find((u) => u.userId === selected.userId) ?? selected)
    : null;
  const lock = current
    ? lockoutState(current.failedPins, current.lastFailedAt, now)
    : null;

  useEffect(() => {
    if (!lock || lock.waitMs <= 0) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [lock]);

  async function submit() {
    if (!current?.pinHash || !current.pinSalt || busy || pin.length < 4) return;
    const state = lockoutState(
      current.failedPins,
      current.lastFailedAt,
      Date.now(),
    );
    if (state.waitMs > 0 || state.needsOnlineLogin) return;

    setBusy(true);
    const ok = await verifyPin(pin, {
      salt: current.pinSalt,
      hash: current.pinHash,
    });
    const db = getLocalDb();
    if (ok) {
      await db.localUsers.update(current.userId, {
        failedPins: 0,
        lastFailedAt: 0,
      });
      setPin("");
      setMessage(null);
      setBusy(false);
      onUnlock(current.userId);
      return;
    }
    const failedPins = current.failedPins + 1;
    await db.localUsers.update(current.userId, {
      failedPins,
      lastFailedAt: Date.now(),
    });
    const next = lockoutState(failedPins, Date.now(), Date.now());
    setNow(Date.now());
    setPin("");
    setMessage(
      next.freeLeft > 0
        ? t("lock.wrongPin", {
            left: next.freeLeft,
            n: f.integer(next.freeLeft),
          })
        : null,
    );
    setBusy(false);
  }

  async function signInAgain() {
    await signOut();
    router.replace("/login");
  }

  const waitSeconds =
    lock && lock.waitMs > 0 ? Math.ceil(lock.waitMs / 1000) : 0;

  return (
    <div
      className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-background p-4"
      data-testid="lock-screen"
    >
      <div className="flex flex-col items-center gap-1 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Lock className="size-6" aria-hidden />
        </div>
        {storeName ? (
          <p className="text-sm text-muted-foreground">{storeName}</p>
        ) : null}
        <h1 className="text-xl font-semibold">
          {current
            ? t("lock.enterPin", { name: current.name })
            : t("lock.title")}
        </h1>
      </div>

      {current ? (
        <>
          {lock?.needsOnlineLogin ? (
            <p
              role="alert"
              className="max-w-xs text-center text-sm text-destructive"
            >
              {t("lock.needsOnline")}
            </p>
          ) : (
            <>
              <PinPad
                value={pin}
                onChange={setPin}
                onSubmit={() => void submit()}
                disabled={busy || waitSeconds > 0}
              />
              {waitSeconds > 0 ? (
                <p
                  role="alert"
                  className="text-center text-sm text-destructive"
                  data-testid="lock-wait"
                >
                  {t("lock.wait", { seconds: f.integer(waitSeconds) })}
                </p>
              ) : message ? (
                <p
                  role="alert"
                  className="text-center text-sm text-destructive"
                  data-testid="lock-message"
                >
                  {message}
                </p>
              ) : null}
            </>
          )}
          <Button
            variant="ghost"
            onClick={() => {
              setSelected(null);
              setPin("");
              setMessage(null);
            }}
          >
            <ArrowLeft aria-hidden className="rtl:rotate-180" />
            {t("lock.back")}
          </Button>
        </>
      ) : (
        <ul className="grid w-full max-w-xs gap-2" data-testid="lock-users">
          {users.map((u) => (
            <li key={u.userId}>
              <button
                type="button"
                onClick={() => setSelected(u)}
                className="flex w-full items-center gap-3 rounded-xl border bg-card p-3 text-start hover:bg-muted"
                data-testid="lock-user"
              >
                <Avatar>
                  <AvatarFallback>
                    {u.name.trim().charAt(0).toUpperCase() || "?"}
                  </AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{u.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {t(`role.${u.role}`)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <Button
        variant="link"
        className="text-xs"
        onClick={() => void signInAgain()}
      >
        {t("lock.signInAgain")}
      </Button>
    </div>
  );
}
