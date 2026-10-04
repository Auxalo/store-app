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

---

# Part 2: who may do what (security)

Tests: `src/server/__tests__/qa-security.test.ts` (unit) and `tests/e2e/qa-security.spec.ts` (browser, both modes). The browser tests were first run against the code before the fixes and failed as described below; then the fixes were applied and they pass.

| ID | Finding | Status | Severity |
|---|---|---|---|
| H1 | On a shared counter a cashier could manage staff, devices and the audit log with the owner's sign-in | **Confirmed, fixed** | **Critical** |
| H4 | A device kept working after the person who registered it was deactivated | **Confirmed, fixed** | High |
| M10 | An operator account could use a shop's staff endpoints | **Confirmed, fixed** | Medium |
| M11 | Anyone could rename themselves through the sign-in service | **Confirmed, fixed** | Medium |
| M2 | After sign-out the server still knew who had been working | **Confirmed, fixed** | Medium |
| M1 | After "sign in again" lock, setting a new PIN did not let the person unlock | **Confirmed, fixed** | Medium |
| H5 | PIN guesses made at the same moment could all be checked | Hardened (could not be reproduced in the test) | Medium |
| H2 | A cashier's device can push operations in the owner's name | **Confirmed, NOT fixed (design limit)** | High |
| H3 | Every device can read every person's PIN hash | **Confirmed, NOT fixed (design limit)** | High |

## Fixed

- **H1.** Staff, device and audit endpoints used the signed-in account (the owner's, on a shared counter). They now act as the person at the counter (`requireActor`: the device plus the PIN-unlocked person). Before the fix, in the browser, a cashier's `PATCH /api/staff/<owner>` with a new password answered **200**: the shop could be taken over. Now it answers 403, as do setting the owner's PIN, promoting themselves, reading the audit log and listing devices. A person can still set their own PIN.
  - *Side effect:* in a shop that uses PINs, these screens need the server to know who is working. If the PIN was entered while there was no internet, the screen now asks for the PIN again (`src/components/settings/api.ts`) instead of showing a generic error.
- **H4.** Deactivating a person revokes the devices they registered (`src/server/staff-admin.ts`), and registering a device checks the database, not the 5-minute session copy. *Side effect:* if a cashier's account was the one used to set up the shared counter, deactivating them stops that counter until the owner signs it in again.
- **M10.** `requireUser` refuses an operator account. Before: the operator got 200 from a shop's staff list.
- **M11.** `/update-user`, `/change-email` and `/delete-user` of the sign-in service are switched off. Before: `update-user` answered 200.
- **M2.** Signing out and locking now clear the "who is working" cookie in every mode (`src/auth/use-auth.tsx`, `src/stores/active-user.ts`). Before: after sign-out the shop's data still answered 200.
- **M1.** Setting a new PIN, or a password reset, clears the wrong-PIN counters; a password reset also ends the person's sessions (`src/server/staff.ts`, `staff-admin.ts`).
- **H5.** A PIN try is now claimed before the slow check, so tries made together see each other (`src/server/actor.ts`), and the unlock route is rate-limited. In the in-memory test only 4 of 30 parallel guesses were checked both before and after, so I could not show the race; the change closes the window that exists when the database is slower.

## Not fixed: design limits that need a decision

- **H2.** The server cannot tell who is at the counter when a device syncs later: it believes the person named in each queued operation. A cashier's device can name the owner (confirmed: a `setting.set` in the owner's name was applied). A fix needs per-person proof that does not exist yet (for example each person signing their operations with a secret only they know); a cheap check on the unlock cookie would reject legitimate operations queued by several people. Until then, treat the cashier role as "cannot use the app's screens to do owner things", not as a security boundary against a technical cashier.
- **H3.** Offline PIN unlock needs the PIN hash on every device, so any registered device can read everyone's. A 4–6 digit PIN falls quickly to a guess against it. Options: longer PINs (6+ digits), or give up unlocking offline for owners and managers (their PIN is then checked only by the server).
- **Related, by design:** cost prices and suppliers also reach every device through sync (offline mode needs them), so hiding costs from cashiers only holds in online mode.

## Not covered yet

Sync/mode/restore (S3, S6–S8, S10, D1–D4), billing (B1–B8), the screens, and the untested modules.

---

# Part 3: sync, restore, mode switching and billing

Tests: `src/server/__tests__/qa-sync-server.test.ts`, `src/sync/__tests__/qa-sync2.test.ts`, `src/server/__tests__/qa-billing.test.ts`, `tests/e2e/qa-sync.spec.ts`, `tests/e2e/qa-billing.spec.ts`, and tests for modules that had none: `src/sync/__tests__/{transport,manager}.test.ts`, `src/stores/__tests__/cart.test.ts`. Each unit test failed before its fix (the failures are listed below); the two-shops browser test hung for 4 minutes on the old code.

Not part of this round, by your choice: the screens and forms findings (barcode Enter, Bangla idle-lock minutes, `/reports` by URL, exports, 360 px layout).

## Sync, restore and mode switching

| ID | Finding | Status |
|---|---|---|
| S6 / M9 | A deactivated person's earlier offline sales were rejected at sync (the goods had left and the cash was taken) | **Fixed** |
| S7 | A second shop signing in on the same browser could not sync (the device stayed tied to the first shop) and could reuse its invoice numbers | **Fixed** |
| S8 | A device with a clock a day ahead moved records into the future, so its edits beat everybody else's | **Fixed** |
| S10 | After a restore, devices that were up to date never received the restored records, and the shop's change counter went backwards | **Fixed** |
| M8 | A restore of an older backup brought back revoked devices and deactivated people | **Fixed** |
| S3 | After a lost answer to a sale, a download counted the sale twice on screen (stock 96 instead of 98) | **Fixed** |
| D1 | "Remove offline data" could lose work saved in another tab, and left the sales' and purchases' lines (the biggest part) | **Fixed** |
| D2 | Switching to online mode was refused for up to 5 minutes while an operation waited out a retry delay | **Fixed** |
| D3 | The "no internet" message appears when the real cause is a paused shop or an update | Not fixed (message only) |
| D4 | A save that changed nothing, plus exactly one change by someone else, is taken as the browser's own, so screens do not refresh until the next check | Not fixed (rare; screens refresh within a minute) |
| S4 | The paused-shop retry loop, at manager level | **Confirmed in a test of the real manager: 4 requests in under 4 seconds before the fix, 1 after** |

- **S6.** The time of deactivation is kept (`deactivatedAt`). Work dated before it is accepted when sent within 14 days; work dated after is refused. *Trade-off:* a technical person with a still-trusted device could date work before their deactivation; the window is 14 days and the device must belong to the shop.
- **S8.** An operation dated more than 5 minutes ahead of the server is treated as made now.
- **S10.** Every restored record gets a new, higher change number (`src/server/shop-export.ts`). Records created after the backup stay on devices that already had them (they are not in the backup and nothing removes them): after a restore, ask each device to "remove offline data" and download again if exact agreement matters.
- **S3.** A cycle that ends with operations still waiting no longer downloads (`src/sync/engine.ts`).
- **S7.** `resetForNewStore` now also drops the device identity (`src/sync/manager.ts`), so the new shop registers a new device with a new short code. The browser test showed a second part in online mode: the new shop's first request still carried the old shop's device cookie and was refused (`403 WRONG_STORE`), which left the setup screen stuck. The online request path now registers the device, with a new identity if needed, and asks again (`src/data/online.ts`). Online browser suite: 100 passed, 0 failed.

## Billing

| ID | Finding | Status |
|---|---|---|
| B2 | A shop that paid in its last grace days locked while the payment waited; payments sent together passed the limit of 3 waiting (8 got in) | **Fixed** |
| B3 | Extra days for a shop let in while a payment waits started from the past, so it could lock again at once | **Fixed** |
| B4 | A paying shop could be left with no end date (locked at once); turning billing on over an old end date locked the shop with no trial | **Fixed** |
| B5 | An older answer arriving late could lock a shop again after its payment was approved | **Fixed** |
| B6 | `2026-13-45` and month `2026-13` were accepted | **Fixed** |
| B1 | A locked shop's ways into the data | **Checked, no bug:** the dashboard, reports, audit log and saving all answer 402, while the staff list and the billing page stay open |
| B7 | A cashier's view of billing | **Checked, no bug:** only where the shop stands; sending a payment is refused (403) |
| B8 | The service worker's page list | **Checked, no bug in this build:** `/pos`, `/billing`, `/login` and others are in the list. It is read from `src/app` when the app is built; if the build runs from a different folder the list is empty and the app will not open offline, so check `/serwist/sw.js` on the first deploy |
| B4(c) | Approving a payment for a shop the operator had set to "billing off" turns billing on | Left as designed (a payment means the shop pays) |

- **B2.** A payment sent in the grace days opens the shop too, and the checking time (48 hours) counts from the lock date at the earliest. The limit of 3 waiting is checked again after saving.

## Modules that had no tests

- `transport.ts`: how each kind of answer is understood (paused shop, refused device, old app, busy, bad gateway, no connection). No bugs.
- `cart.ts`: merging, repricing, holding and resuming, totals, and the lock while saving. No bugs beyond the ones already fixed.
- `manager.ts`: the paused-shop loop is now tested with the real manager. Other manager behavior (store mismatch, multi-tab lock) is still not covered.

## Observed, not fixed

- After signing out, the page re-saves the name-and-role copy of the old session (used to open the app offline). The server session is gone at once (checked), but the next visit can flash "signed in" and bounce to the sign-in page. Cosmetic.

## Not done

- The screens and forms findings were done in part 4 below.
- The four product decisions and the two security design limits (H2, H3) are unchanged.

# Part 4: phone and usability pass (no business logic changed)

Checked every screen at 360 px and desktop, in light mode, against a demo shop in Bangla: sideways scrolling, text cut off, small tap targets, console errors, failed requests. No page scrolled sideways and there were no console errors or failed requests. What was found and fixed:

| Area | Problem | Fix |
|---|---|---|
| List toolbars | Search box, filters and sort squeezed into one row at 360 px | Search gets its own row on a phone |
| Header | The language button took the room of the page title | Icon only on a phone (name kept for screen readers) |
| Customers, suppliers | Long names cut to one line; chevron wasted room | Two lines, chevron hidden on a phone |
| Reports | The data-source switch ran off the screen | It wraps |
| Tabs and chips | 25 px high on a touch screen | 40 px on touch screens |
| POS barcode box | Enter added the previous search's result when the code was unknown; Bangla digits not understood; Esc did not clear | Looks the code up (also in Latin digits), says "no product with this code", Esc clears |
| Settings | Idle-lock minutes typed in Bangla saved as 0 (lock off); failed saves showed nothing | Bangla digits are read, bad numbers are refused, failures show an error |
| Typed addresses | A cashier opening /dashboard, /reports or /returns saw the screen | "You do not have permission" (the server already refused the data) |
| Receipt after a sale | Blank if the sale could not be loaded | Says the sale is saved and offers "new sale" |
| First offline start | Spinner forever with no internet | After 20 s: "taking long, check the internet" and a retry button |
| CSV exports | Sales by day and the settings CSVs were in poisha and thousandths, the report CSVs in taka | All in taka and units |
| Backup in online mode | Downloaded an empty file (the device holds no data) | Buttons off, with an explanation |
| Quantity "−" | A 0.5 kg line went to 0.001 kg | Steps a whole unit and stops |
| Customer and supplier page | "This product was not found" | "This person was not found" |
| Devices | Revoking this very device gave no warning | An extra line says it will stop syncing too |

Also added: the GitHub Actions workflow (see DEPLOY.md section 8).

Seen and left alone: the customer picker in the POS lists the first 30 (search finds the rest); the sync pill and the small switches are 28 px / 18 px high.

## Product decision 1 changed: stale prices

A cashier's offline sale made at the price an item had until the owner changed it is now kept, at the price the customer paid, and flagged "Sold at the old price" in the audit log (when it is on). Before, it was refused and undone on the device although the goods had left.

How it is kept safe: the server records each selling-price change (the old price and when it changed). A pushed sale is honoured only when the line's price equals that previous price and the sale was rung up before the change. Any other price below the list price, or the old price claimed after the change, is still refused (tests in `qa-money.test.ts`). Limit: only the latest previous price is remembered, so after two changes while a device was offline, a sale at the oldest price is still refused.
