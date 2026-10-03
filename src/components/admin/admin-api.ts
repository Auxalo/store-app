"use client";

export interface AdminResult<T> {
  ok: boolean;
  status: number;
  data: T;
}

/** Talks to the operator endpoints. Never throws: a network failure is `{ ok: false, status: 0 }`. */
export async function adminFetch<T = unknown>(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<AdminResult<T>> {
  try {
    const response = await fetch(path, {
      method: init?.method ?? "GET",
      credentials: "same-origin",
      headers: init?.body ? { "content-type": "application/json" } : undefined,
      body: init?.body ? JSON.stringify(init.body) : undefined,
    });
    const data = (await response.json().catch(() => ({}))) as T;
    return { ok: response.ok, status: response.status, data };
  } catch {
    return { ok: false, status: 0, data: {} as T };
  }
}

/** A readable reason for a failed call. */
export function reasonOf(result: AdminResult<unknown>): string {
  const code = (result.data as { code?: string }).code;
  if (result.status === 0) return "No connection.";
  const known: Record<string, string> = {
    USERNAME_TAKEN: "That username is already used.",
    INVALID_INPUT:
      "Check the details: names 2+ letters, username 3-30 letters/numbers, password 8+ characters.",
    NOT_FOUND: "Not found.",
    FORBIDDEN: "This account is not an operator.",
    UNAUTHORIZED: "Sign in first.",
    RATE_LIMITED: "Too many requests. Wait a moment.",
  };
  return (
    known[code ?? ""] ?? `Something went wrong (${code ?? result.status}).`
  );
}
