/**
 * The shop's people list is read again only when the server says it changed: every sync answer
 * carries a number that moves whenever a person or a PIN changes (see bumpStaffVersion on the
 * server). Remembered here, in memory, for the life of the page.
 */
let heard: number | null = null;
let read: number | null = null;

/** What the server just said (ignored when an older server sent nothing). */
export function noteStaffVersion(version: number | undefined): void {
  if (typeof version === "number") heard = version;
}

/** Someone's details changed since this device last read the list. */
export function staffVersionMoved(): boolean {
  return heard !== null && heard !== read;
}

/** Call with the version that was current when the list was fetched. */
export function currentStaffVersion(): number | null {
  return heard;
}

export function markStaffRead(version: number | null): void {
  if (version !== null) read = version;
}
