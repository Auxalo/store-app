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
| H2 | A cashier's device can push operations in the owner's name | **Confirmed, fixed in part 5** | High |
| H3 | Every device can read every person's PIN hash | **Confirmed, fixed in part 5** | High |

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
- Product decisions 2, 3 and 4 are unchanged. Decision 1 (stale prices) and the two security design limits (H2, H3) were changed afterwards (see below and part 5).

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

# Part 5: H2 and H3 fixed (who an offline action belongs to, and who can read PIN hashes)

## H2: an owner's or manager's offline action must be signed

**Problem.** A device syncs later, and the server believed the person named in each queued action. A cashier's device could send "cancel this sale" or "change a setting" in the owner's name (confirmed before the fix: a `setting.set` in the owner's name was applied).

**Fix.** When someone types their PIN, the app makes a signing key from it (a second PBKDF2 value from the same PIN, with a different salt, so it cannot be made from the hash other devices hold). The key lives in memory only (a lock or reload forgets it). Every action queued while that person is unlocked is signed with it (HMAC over the action's id, type, person, device, time and data). The server stores the same key per person and, for any action by an owner or manager in a shop that uses PINs, checks the signature before applying it. An unsigned, wrongly signed, changed or re-dated action is refused with `PROOF_REQUIRED`.

- A cashier's actions need no signature: a cashier can only sell, and a forged sale only misnames who sold.
- Changing a PIN keeps the previous key valid for 14 days, so work queued before the change still goes through.
- Settling a conflict ("keep mine") changes only `baseVersion`, which is not covered by the signature.
- A person with no PIN cannot sign. Their actions are accepted only from a device they set up or entered their PIN on (a shop with no PINs at all works as before: one account).
- If the server does not yet have a person's signing key (a PIN set before this change), it learns it the first time they enter the PIN online.
- Online mode is unchanged: the server already knows who is working from its own cookie.

**Tests.** `qa-security.test.ts` (device of a cashier naming the owner, a cashier's own key, changed and re-dated actions, conflict re-basing, PIN change grace, a person with no PIN), `src/sync/__tests__/proof.test.ts` (the real device queue against the real server), `src/auth/__tests__/op-proof.test.ts`, and in the browser `staff.spec.ts` (the owner's signed offline work is accepted; the same action sent by hand without a signature is refused).

## H3: PIN hashes no longer go to every device

**Problem.** Offline PIN checks need the PIN's hash on the device, so every device downloaded everyone's, the owner's too. A 4-digit PIN falls in about 15 minutes of guessing on one computer (measured: 92 ms per guess).

**Fix.**
- An **owner's or manager's** hash goes only to a device that person has signed in on (set it up, signed in there with the password, or entered their PIN there online). Other devices see only that the person has a PIN (and the salt, which is not secret).
- A **cashier's** hash still goes to every device (a cashier's PIN opens nothing beyond what the cashier can do).
- An owner's or manager's **PIN must be 6 digits** (over a day of guessing on one computer instead of 15 minutes); cashiers keep 4 to 6.
- The signing key is stored only on the server and is never listed.

**What changes for people.**
- A manager (or owner) using a device for the first time needs the internet once to enter their PIN; after that it works offline there. Without internet the lock screen says so.
- Setting a PIN for an owner or manager needs 6 digits.

**Limit that remains.** On a shared counter where the owner has signed in, the owner's hash is on that device. A cashier who is technical and has hours could try to guess a 6-digit PIN from it. The 6-digit rule and the signature make that slow and unrewarding rather than impossible; a fully offline PIN cannot be made stronger than that.

**Tests.** `qa-security.test.ts` (who receives whose hash, wrong PIN gives nothing, the key is never listed), `staff.test.ts`, `pin.test.ts`, and in the browser `staff.spec.ts` (a manager's first sign-in on a device needs the internet, then works offline).

# Part 6: "Store worth" on the dashboard

A grouped section under today's numbers, for owners and managers (anyone who may see cost prices):

- **Store worth (excluding cash)** = stock at cost + what customers owe - what the shop owes suppliers. Advances count: a customer who paid ahead lowers it, a supplier paid ahead raises it (so the figure can differ from the two "owe" cards, which show only what is owed; each card says how much was paid ahead).
- Four cards beside it: stock at cost, stock at selling price (with the expected margin), customers owe you, you owe suppliers. The last two moved here from the daily grid.
- An eye button hides every amount until tapped; the choice is kept on that device.
- The formula is one function (`src/reports/worth.ts`, tested). Online mode gets everything in the existing single dashboard request; offline mode adds up the device's data.
- What it leaves out: cash and bank balances (the app does not track them), and stock is valued at the latest purchase price, not a running average. Bad debts and dead stock make it look higher than it is.
- Tests: `worth.test.ts`; the browser setup test checks stock at cost, at selling price, the margin, the worth and the hide/show in both modes.

# Part 7: cancelling a payment

**Gap.** A payment taken from a customer, or paid to a supplier, by mistake could not be undone (sales, returns and expenses could).

**Now.** "Cancel payment" on the payment line of a customer's or supplier's statement, and on each row of the Payments list. A reason is asked for. Owner and manager only (the `sale.void` permission); a cashier who may collect payments cannot cancel them.

- The payment is never deleted: it stays on record, marked cancelled, and a reversing line is added to the statement (refType `payment_void`), so the balance goes back to what it was before, an advance included.
- It works for both directions: cancelling a customer's payment makes them owe again; cancelling a supplier payment makes the shop owe again.
- The Payments list totals leave cancelled payments out; the statement shows both lines, the original struck through with a "Cancelled" mark.
- Works offline (the balance changes at once on the device, then syncs; it is signed like other owner actions), and online. Cancelling twice, or a retry, changes nothing. The server takes the amount and the person from its own record, never from the device. If the server refuses it, the device goes back to the payment being active. The audit log records who cancelled it.
- A payment cannot be edited; to fix a wrong amount, cancel it and enter the right one.

Tests: `purchasing.test.ts` on the server (both directions, advance, once only, device cannot choose the amount or person, cashier refused, other shop's payment, audit), `src/sync/__tests__/purchasing.test.ts` on the device queue (immediate balance, convergence across devices, unsent cancellation surviving a pull, undo on refusal), and the browser test "collect a customer's due" in both modes.

# Part 8: bugs from the Notion bug tracker (the 12 that mattered)

From the tracker's 41 bugs, these were judged "must fix" or "fix soon" and are fixed. The rest are low (labels, small UI, confirmations) and stay on the list. Each has a test.

| Bug | What was wrong | What it does now |
|---|---|---|
| BUG-31 (critical) | An owner with no PIN was locked out once a staff member got a PIN: the server wanted a PIN unlock, the owner has none, signing in again did not help, and the PIN screen blamed "internet". | Typing the password makes that person the one working on the device (`/api/actor/password`, also when a new device registers), but only for a sign-in from the last 5 minutes, so a shared counter's old session still cannot skip the PIN. The PIN screen says what really went wrong. |
| BUG-32 (high) | A purchase cost of 0 or a negative one was accepted and overwrote the product's purchase price with ৳0. | A purchased item's cost must be more than ৳0 in the form, on the device and on the server, and a purchase never sets a product's cost to nothing. (Free stock is added by adjusting stock.) |
| BUG-20 (high) | A fully returned sale could still be cancelled, which made its refunds vanish from Reports while /returns still listed them. | A sale that has come back in full cannot be cancelled (UI hidden, device and server refuse), and shows "Fully returned" (also BUG-4). A partly returned sale can still be cancelled and reverses only what is left, as before. |
| BUG-1 (high) | On a short phone the Sell button of the cart sheet was cut off below the screen. The drawer's own 80vh limit beat the sheet's height, so the bottom of the cart was clipped. Reproduced at 360×640 (button ends at 662) and 320×568. | The sheet is sized to fit (up to 94% of the screen) and scrolls if still too small. Test at three phone sizes. |
| BUG-22 | "How people paid" counted the whole sale (৳400 under bKash for ৳150 paid). | It sums the money received per method; what is owed shows as credit. |
| BUG-3 (high) | "You need to be online to sign in" shown to people who were online: sign-in first checked the browser's online flag, which is wrong on some phones. | No pre-check: it tries, and shows the real error (network, server, or wrong password), logging the status to the console. |
| BUG-35, BUG-25 | Reports > Profit showed "unpaid to suppliers" as of the day of each purchase; sale and purchase lists showed the due at that time, which looked stale after a payment. | The Profit tab shows what is owed to suppliers now (same as Dues). The lists and the sale page say "due at sale" / "owed at purchase"; payments are per customer, so the sale's own figure is a snapshot, and the page says so. |
| BUG-5, BUG-23 | Sales list total (before returns) disagreed with Dashboard and Reports (after returns); the average bill used the total before returns. | The list says "Total before returns"; the average bill uses net sales. |
| BUG-21 | A sale could need more than is in stock with no hint. | The cart line warns ("only X in stock"); selling is still allowed (stock may go below zero, as decided). |
| BUG-15 | Stock could be adjusted below zero with no warning. | Removing more than is on hand is refused with a message; adding stock to fix a negative is fine. |
| BUG-9 | The shop name differed between Settings and receipts (the name written in Settings) and the sidebar (the name used at sign-up). | The sidebar and account menu show the name written in Settings too. |
| BUG-2 | A product picked in the cart "does not show" and a sold product "disappears" on some phones. | Could not be reproduced (the test picks, sells and checks the list on a 360 px phone). The cut-off cart sheet of BUG-1 is the likely cause of what was seen. If it still happens on a real phone, send the model and screen size. |

Not changed on purpose: weighted-average cost (BUG-41, a design question), purchases and sales payments in the payment log (BUG-33/34), the 401 right after login (BUG-7, harmless).

# Part 9: returns, dues and store credit: one money model

QA found that a return left the numbers inconsistent: Reports' "left unpaid" never went down when a return came off a due, a partly returned sale could still be cancelled (and reversed twice), the return screen defaulted to cash even when the customer still owed, store credit was never used at the counter, and Dashboard and Reports disagreed. All fixed together, for customers and suppliers, with this model.

## The model

- A customer's balance (positive owes, negative is store credit) moves only through the ledger: a sale's due, a payment, the credited part of a return, a cancellation.
- **A refund has two parts:** what comes off the balance (`credited`) and what is handed over in cash (`cashBack`); together they are the whole refund. The screen offers: the store credit the sale used goes back as credit, then what the customer still owes is cleared, and only the rest is cash. "Keep the cash part as store credit" is a tick box. A walk-in sale (nobody to credit) is always cash. Suppliers mirror it ("off what we owe" and "cash from the supplier").
- **A sale** is `total = paid + store credit used + due`. The POS shows a customer's store credit, uses it first (the cashier can untick it) and asks only for the rest; the receipt says "Paid from store credit". A cancelled sale gives the credit back.
- **Cancelling:** once anything has come back, a sale cannot be cancelled (the rest is returned with "Return the rest"; the sale shows Partly or Fully returned). Cancelling would reverse the same stock and money twice.
- **Reports always add up:** net sales = received (money in, less cash handed back) + paid from store credit + left unpaid (the due less what returns took off it). If returns made more credit than was owed, it shows as "Store credit given by returns" rather than a negative. "How people paid" shows money in by method and a "Cash given back" row. Purchases are net of goods sent back.
- Older returns (which said only "cash" or "credit") and old devices keep working: a return without a `cashBack` means all one way or the other. The server keeps the split the device made, since the cash really changed hands, only keeping it within the refund.

## Each QA point

1. Reports "left unpaid" now goes down with returns (`unpaid = due - credited`); tested against the QA scenario on the device, on the server and in the browser.
2. A partly returned sale shows "Partly returned", has no Cancel, and offers "Return the rest"; the server and device refuse the cancel (`HAS_RETURNS`).
3. The return screen shows the customer's balance and the split; cash is never the default when something is still owed.
4. The POS shows and uses store credit.
5. Dashboard vs Reports for today: no code path made two numbers for the same day, so the cause was how the screens were read. Reports opened on the **last 7 days** while the dashboard shows **today**; the last week's sales were compared with today's. Reports now opens on Today. The server report also used its own default time zone; it now uses the shop's, as the dashboard does. A browser test checks the dashboard and Reports agree for today after sales, returns and a payment.

## Not done

- A purchase does not use supplier credit explicitly (the supplier's balance already nets it, so what is owed is right; only the suggested "paid now" does not take it into account).
- "Left unpaid" in Reports is what was unpaid when the sale was made, after returns; money collected later is a payment (Payments and the customer's page), because payments are per customer and not tied to a sale. The label now says so.

# Part 10: signing out, switching shops, two tabs and reconnecting

| QA finding | Cause | Fix |
|---|---|---|
| Another shop signing in on the same device saw the first shop's sales, customers and dashboard | When the first shop still had unsent work, the device kept its data (correct) but the app showed it to the next shop while waiting | The app shows nothing until the data on the device belongs to the shop that is signed in. If another shop's unsent work is there, a screen says whose account must sign in to send it (sign out keeps that work) |
| The first shop's sale then failed with PROOF_REQUIRED and was lost | An owner or manager with a PIN who signed in with the password had no signing key, so their work was unsigned and refused | The server gives the person who just proved who they are (password, or PIN checked online) a signing key for this device; every tab can ask for it. Work queued unsigned is signed and sent again as soon as that person is known, so refused sales come back |
| Two tabs: PIN in one tab, sale in the other, lost | Same cause: the key was only in the tab where the PIN was typed | Same fix: the other tab asks the server for the key |
| "Offline" for 15–30 s after the internet came back | Sync waited for the browser's "online" event (late or missing on many phones) or for the retry delay | While the server cannot be reached, the app checks every 4 seconds and sends at once when it is back; a hanging request gives up after 20 seconds |
| Signing out with unsent work could leave it stuck | Sign-out kept the shop's data on the device | Sign-out asks to send first ("Send now, then sign out"); without internet it explains, and deleting unsent work needs a second, explicit yes. After sign-out the shop's data is removed from the device (only its own identity stays), so the next person sees nothing |

Tests: `tests/e2e/sync-session.spec.ts` (each finding, as QA described it), and the device key in `qa-security.test.ts`.
