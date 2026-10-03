# QA report: baseline, and the money-and-data findings (part 1): found and fixed

Branch `dev`, starting from commit `2c2a6e0`. The audit first added tests that proved each bug (`d53216e`); this change fixes all 11 and turns those tests into ordinary regression tests.

This is part 1 of the audit: the baseline, and the 11 "P0 money and data" findings (C1–C6, S1, S2, S4, S5, POS-1). The security findings (H1–H5, M1, M2, M10/M11), the sync/mode/restore findings, billing and the screens are **not yet covered** (see the end).

## 1. Baseline (before any change)

| Check | Result |
|---|---|
| `pnpm lint`, `pnpm typecheck`, `pnpm check:i18n` | clean (979 message keys) |
| `pnpm test` (Vitest) | 586 passed; `pnpm test:perf` 1 passed |
| Browser suite, offline data mode (100 tests) | 99 passed, 1 flaky (`mode-switch`, a timing race in the test; 3 of 3 on rerun) |
| Browser suite, `E2E_MODE=online` (100 tests) | 82 passed, 18 skipped (offline-only by design), 0 failed |

## 2. After the fixes

| Check | Result |
|---|---|
| `pnpm check` (lint, types, 981 message keys, unit, perf) | clean; **633 unit tests pass**, no known-bug tests left |
| Browser suite, offline mode | 101 passed, 2 skipped (online-only), 1 flaky (`billing` offline-lock on the phone project: the device had not yet saved its billing dates when the test cut the network; 3 of 3 on rerun) |
| Browser suite, online mode | 86 passed, 18 skipped (offline-only by design), 0 failed |

The new tests are in `src/server/__tests__/qa-money.test.ts`, `src/sync/__tests__/qa-sync.test.ts`, `src/sync/__tests__/undo.test.ts`, `src/lib/__tests__/refund.test.ts` and `tests/e2e/qa-money.spec.ts`. `tests/helpers/qa.ts` (`knownBug`, with `QA_UNPIN=1` to run a pinned test as a normal one) is kept for the next parts of the audit.

## 3. The 11 findings

Severity was my estimate for a shop selling every day.

| ID | What was wrong | Severity | Fixed by |
|---|---|---|---|
| C6 | Online mode: a cashier could not ring up any sale (`400 INVALID_INPUT`) | High | The cart no longer sends an undefined cost, and the sale line's cost is optional: the server fills it from its own record |
| C1 | Voiding a sale after a return reversed the returned goods and money twice | High | Cancelling reverses only what is left (server, device and reports) |
| C2 | Returns from a discounted sale refunded more than was paid | High | The refund is the line's real net, worked out from the sale (server, device, return screen) |
| S1 | Queued operations overtook each other after a failed send: dues and stock were lost | High | The queue sends strictly in order |
| S2 | A refused offline sale left its stock, balance, lines and ledger on the device | High | A refused or discarded operation is undone on the device |
| C3 | A cashier's device could sell at any price | Medium | The server takes list price and cost from its own product record |
| C4 | A customer who owed money could be deleted, and then could not pay | Medium | Deleting a customer or supplier with a balance is refused |
| C5 | A sale of a refused duplicate-barcode product was kept with no stock movements | Medium | The server refuses a sale of a product that is not the shop's |
| S4 | A paused shop's devices retried every second, forever | Medium | They wait a minute before asking again |
| S5 | A big batch, one bad operation, or an operation that always fails blocked the queue | Medium | Batches are capped by size; each operation is checked and refused on its own; only database/network errors mean "retry" |
| POS-1 | "Hold" while a sale was saving kept a copy of the sold items | Medium | The cart is locked while a sale saves |

### What changed, and the rules I chose

- **C6.** `src/stores/cart.ts` (`unitCost: product.purchasePrice ?? 0`) and `src/schemas/sale.ts` (`unitCost` defaults to 0). Confirmed in the browser: the online sale answers 200 for a cashier; offline still works.
- **C1.** `src/server/commands/sales.ts` and `src/commands/local/sales.ts` look at the sale's earlier returns (`src/lib/refund.ts`, `returnedOf`): only the goods not already put back return to stock, and only the part of the due not already taken off is reversed. A sale whose goods all came back can still be cancelled (the void payload may now have no lines). Reports no longer subtract the returns of a cancelled sale (`src/reports/compute.ts`).
  - *Rule I chose:* cancelling a sale with returns is allowed and reverses only the remainder. Goods returned as damaged (not put back) are put back when the sale is cancelled, because cancelling undoes the whole sale.
- **C2.** `src/lib/refund.ts`: each line's net is its price × quantity less its discount less its share of the bill discount (shared by value so the lines add up to the sale total exactly). The refund for part of a line is proportional and uses the running total, so several partial returns add up to exactly what was paid and never more. The server and the device both compute it (the server ignores the amount the device sends); the return screen shows and sends the same amount. A return line may now carry an optional `amount`.
- **S1.** `src/sync/engine.ts` stops at the first operation that is still waiting.
  - *Trade-off:* an operation waiting out a retry delay (5 s, 15 s, 1 min, up to 5 min) now holds back the ones behind it. Opening the app or coming back online clears the delays.
- **S2.** New `src/sync/undo.ts`, called when the server refuses an operation and when it is discarded. It finds what the operation wrote (named after its own id) and moves stock and balances back by exactly what the removed records had moved them. Covers sales, cancellations, returns, purchases, payments and opening balances. Safe to run twice.
- **C3 / C5.** `src/server/commands/sales.ts`.
  - *Trade-off to decide:* a cashier's offline sale at an old price is now refused if the owner changed the price while the device was offline, as the online path already did. The device then shows the sale as failed and undoes it (S2), although the goods have left. I judged wrongly accepting cheaper prices worse, but this is worth a product decision (see section 4).
- **C4.** `src/server/commands/master-data.ts`, the device commands, and a message on the customers and suppliers screens (Bangla and English): "still has a balance, settle it first".
- **S4.** `src/sync/engine.ts`: "shop paused", "update the app" and a refused device wait 60 seconds; a not-yet-registered device (401) backs off like any failure and is retried at once after it registers (`src/sync/manager.ts`). Opening the app resets delays.
- **S5.** `src/sync/engine.ts` closes a batch at 700 KB (the server refuses over 1 MB). `src/schemas/sync.ts` and `src/server/sync/push.ts` check each operation on its own (a malformed one is refused as `INVALID_OP`); an operation that throws something other than a database/network error is refused as `INTERNAL_ERROR` and the ones behind it still run.
- **POS-1.** `src/stores/cart.ts` has a `saving` flag; hold, clear, remove, edit and customer changes do nothing while it is set, and the buttons are disabled. The check is made in the store, so a double tap or a held-down shortcut cannot start two sales.

## 4. Needs a product decision

- **Stale prices (C3).** Should a cashier's offline sale at an outdated price be refused (now), or accepted and flagged for the owner? A real sale being refused after the goods left is the downside of strictness.
- **Queue delay (S1).** Strict order means one failed send can delay everything behind it by up to 5 minutes (until the app is reopened or the connection returns). The alternative is to let independent operations through, which needs a map of which depend on which.
- **Cancel with returns (C1).** I allowed it and reverse the remainder; the alternative is to forbid cancelling a sale that has returns.

## 5. Browser suite, online mode

86 passed, 18 skipped (offline-only by design), 0 failed. This includes the cashier sale (C6, the server now answers 200) and hold-while-saving (POS-1) tests, which failed before the fixes.

## 6. Not covered yet

- **From the plan, still to do:** P0 security (H1–H5, M1, M2, M10/M11), P1 sync, modes and restore (S3, S6–S8, S10, D1–D4), billing (B1–B8), screens and forms, and the modules without tests (`manager.ts`, `transport.ts`, `cart.ts`).
- **Within part 1:** the manager-level behaviour of S4, double-press and edit-while-saving cases of POS-1, return prices on the offline path beyond the refund fix, and whether other operation types (stock adjustments) need an undo.

## 7. Notes on running the browser tests

- A server left running on port 3100 is silently reused by the next run, so the tests then check an old build. Make sure nothing listens on 3100 first.
- Do not run `pnpm test` while a Playwright build or run is going: the in-memory databases then fail to start (false failures).
