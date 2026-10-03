/**
 * How far the shop's changes have got, as this browser last heard (one number that goes up with
 * every change anyone saves). It lets the app tell "someone else changed something" from "that was
 * me": a person's own save moves it too, and must not make every screen refetch a second time.
 */
let last: number | null = null;
const listeners = new Set<(head: number) => void>();

export const getLastHead = () => last;

/** What the server just said. Tells listeners when it moved (never on the very first answer). */
export function setHead(head: number): void {
  const moved = last !== null && head !== last;
  last = head;
  if (moved) for (const listener of listeners) listener(head);
}

/**
 * This browser's own save, which allocated `changes` numbers and ended at `head`. If nobody else
 * saved in between (we were exactly `changes` behind), the move was ours alone: it is not news.
 * Otherwise nothing is done, and the next check sees that someone else saved and refreshes.
 */
export function noteOwnWrite(head: number | undefined, changes: number): void {
  if (head === undefined || last === null) return;
  if (last + changes === head) last = head;
}

export function onHeadChange(listener: (head: number) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Forget what was heard (a new session, or a test). The next answer is then "the first one". */
export function forgetHead(): void {
  last = null;
}
