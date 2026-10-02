import type { WireChange } from "@/schemas/sync";

/**
 * Something went wrong asking the server (online mode). `code` says what, in a form a screen can
 * act on: OFFLINE (no connection), PIN_REQUIRED (someone must enter a PIN), FORBIDDEN, CONFLICT
 * (someone else changed it first; `docs` has their version), NOT_FOUND, or a reason such as
 * RETURN_TOO_MUCH.
 */
export class DataError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly docs?: WireChange[],
    /** Extra facts some answers carry (a wrong PIN says how many tries are left, ...). */
    public readonly detail?: { waitMs?: number; freeLeft?: number },
  ) {
    super(code);
  }
}

export const isOffline = (error: unknown): boolean =>
  error instanceof DataError && error.code === "OFFLINE";
export const errorCode = (error: unknown): string =>
  error instanceof DataError ? error.code : "UNKNOWN";
