"use client";

import { Loader2 } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { authClient } from "@/auth/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { adminFetch } from "./admin-api";

type State = "checking" | "signedOut" | "denied" | "ok";

/**
 * Lets only an operator in. Whether someone is one is decided by the server (/api/admin/me); this
 * only shows the right screen: a sign-in form, a "not an operator" notice, or the panel.
 */
export function AdminGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>("checking");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const check = useCallback(async () => {
    const result = await adminFetch("/api/admin/me");
    setState(result.ok ? "ok" : result.status === 401 ? "signedOut" : "denied");
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  async function signIn(formData: FormData) {
    setBusy(true);
    setError(null);
    const { error: failed } = await authClient.signIn.username({
      username: String(formData.get("username") ?? "")
        .trim()
        .toLowerCase(),
      password: String(formData.get("password") ?? ""),
    });
    setBusy(false);
    if (failed) {
      setError("Wrong username or password.");
      return;
    }
    await check();
  }

  async function signOut() {
    setError(null);
    try {
      const { error: failed } = await authClient.signOut();
      if (failed?.status) {
        setError("Could not sign out. Try again.");
        return;
      }
    } catch {
      setError("Could not sign out. Check your connection and try again.");
      return;
    }
    setState("signedOut");
  }

  if (state === "checking")
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="animate-spin" aria-hidden />
      </div>
    );
  if (state === "ok")
    return (
      <>
        <div className="mb-4 flex items-center justify-end gap-3">
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            onClick={() => void signOut()}
            data-testid="admin-sign-out"
          >
            Sign out
          </Button>
        </div>
        {children}
      </>
    );
  return (
    <div
      className="mx-auto flex max-w-sm flex-col gap-4 py-10"
      data-testid="admin-gate"
    >
      {state === "denied" ? (
        <>
          <p className="text-sm">This account is not an operator account.</p>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <Button variant="outline" onClick={() => void signOut()}>
            Sign out
          </Button>
        </>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void signIn(new FormData(event.currentTarget));
          }}
        >
          <p className="text-sm text-muted-foreground">Operator sign-in</p>
          <Input
            name="username"
            placeholder="Username"
            autoComplete="username"
            required
          />
          <Input
            name="password"
            type="password"
            placeholder="Password"
            autoComplete="current-password"
            required
          />
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <Button type="submit" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      )}
    </div>
  );
}
