# QA report: baseline, and the money-and-data findings (part 1)

Branch `dev`, starting from commit `2c2a6e0`. Only tests and this report were added: **no product code was changed**.

This is part 1 of the audit in the QA plan: the baseline, and the 11 "P0 money and data" findings (C1–C6, S1, S2, S4, S5, POS-1). The security findings (H1–H5, M1, M2, M10/M11), the sync/mode/restore findings, billing and the screens are **not yet covered** (see the end).

## 1. Baseline (before any new test)

| Check | Result |
|---|---|
| `pnpm lint`, `pnpm typecheck`, `pnpm check:i18n` | clean (979 message keys in both languages) |
| `pnpm test` (Vitest) | 586 passed |
| `pnpm test:perf` | 1 passed |
| Browser suite, offline data mode (default), 100 tests, 10.8 min | 99 passed, **1 failed** (below) |
| Browser suite, `E2E_MODE=online`, 100 tests, 7.9 min | 82 passed, 18 skipped (offline-only by design), 0 failed |

**The one failure** was `mode-switch.spec.ts` "an online device: Work offline downloads the shop…" on the phone project: the test's own `page.goto("/products")` collided with the app redirecting to `/sync` after the switch. It passed on desktop and passed 3 out of 3 when rerun alone, so it is a flaky timing race in the test, not an app bug.

**After adding the new tests:** `pnpm check` is green: 589 passed plus 25 "known bug" tests (see section 2), the performance test passes, lint, types and message check are clean.

## 2. How the new tests work

Each test says what **should** happen. Where the audit proved the app does something else, the test is written as `knownBug(...)` (Vitest, `tests/helpers/qa.ts`) or `pinned(...)` (Playwright). The suite stays green while the bug exists. The day someone fixes a bug, its test starts "passing unexpectedly", which fails the run: that is the signal to change `knownBug(` back to `it(`.

To see how each one really fails (and check it fails for the right reason), run it unpinned:

```bash
QA_UNPIN=1 pnpm exec vitest run src/server/__tests__/qa-money.test.ts src/sync/__tests__/qa-sync.test.ts
QA_UNPIN=1 E2E_MODE=online pnpm exec playwright test tests/e2e/qa-money.spec.ts
```

I ran every pinned test unpinned and read each failure message: all 25 unit tests and all 4 browser runs fail with exactly the symptom named below.

New files:
- `src/server/__tests__/qa-money.test.ts` (server: C1–C5, S5)
- `src/sync/__tests__/qa-sync.test.ts` (the device's queue: S1, S2, S4, S5, and C1/C2 on the device)
- `tests/e2e/qa-money.spec.ts` (screens: C6, POS-1)
- `tests/helpers/qa.ts` (the `knownBug` helper)

## 3. Findings

Severity is my estimate for a shop selling every day: **High** = wrong money or lost sales, **Medium** = wrong in some situations or needs a technical user, **Low** = noise.

| ID | What is wrong | Status | Severity |
|---|---|---|---|
| C6 | Online mode: a cashier cannot ring up any sale | **Confirmed** | **High** |
| C1 | Voiding a sale after a return reverses the returned goods twice | **Confirmed** | **High** |
| C2 | Returns from a discounted sale refund more than was paid | **Confirmed** | **High** |
| S1 | Queued operations are sent out of order after a failed send: dues and stock are lost | **Confirmed** | **High** |
| S2 | A refused offline sale leaves its stock, balance and lines on the device | **Confirmed** | High |
| C3 | A cashier's device can sell at any price (the server trusts the list price it is given) | **Confirmed** | Medium |
| C4 | A customer who owes money can be deleted, and then cannot pay | **Confirmed** | Medium |
| C5 | A sale of a product refused as a duplicate barcode is kept without stock movements | **Confirmed** | Medium |
| S4 | A device of a paused shop retries every second, forever | **Confirmed** (engine level) | Medium |
| S5 | A batch over 1 MB, a bad operation, or an operation that always fails, blocks the queue | **Confirmed** | Medium |
| POS-1 | "Hold" pressed while a sale is saving keeps a copy of the sold items | **Confirmed** (the rest of the finding is not tested, see below) | Medium |

### C6: a cashier cannot sell in online mode (High)

- **Evidence:** the browser test signs up an owner, adds a product and a cashier with a PIN, unlocks as the cashier and completes a sale. In online mode the sale request `POST /api/commands` is answered **`400 {"code":"INVALID_INPUT"}`** and no receipt appears (phone and desktop). In offline mode the same test passes.
- **Why:** the server hides purchase prices from cashiers, so the cart line has no `unitCost` (`src/stores/cart.ts:136`); the sale input requires one (`src/schemas/sale.ts:35`), and the check runs before the server fills the cost in from its own records.
- **Who is hit:** shops whose devices run in online mode. New devices start offline by default, so shops that never switched are not affected.
- **By hand:** online-mode device; owner adds a product and a cashier with a PIN; switch user to the cashier; sell one item. The sale fails with "something went wrong".
- **Tests:** `tests/e2e/qa-money.spec.ts` "QA C6".

### C1: voiding a sale after a return (High)

- **Evidence (server and device give the same result):** 4 units sold on credit, 3 returned with the goods put back and the money taken off the due, then the sale voided. Stock ends at **103** instead of 100 (the 3 returned units are put back a second time), and the customer is left at **−৳50.00** (the shop now owes a customer who bought on credit). Reports also still subtract the return of a voided sale (from reading `src/reports/compute.ts`; not tested).
- **Why:** neither the server (`src/server/commands/sales.ts:349`) nor the device (`src/commands/local/sales.ts:243`) looks at returns already made; the Void button shows for any active sale (`src/components/sales/sale-view-screen.tsx:80`).
- **By hand:** make a credit sale of 4; open it and return 3 (put back into stock, take off the due); open it again and tap Void. Stock goes up by 4 instead of 1.
- **Tests:** `qa-money.test.ts` (3 tests), `qa-sync.test.ts` (2 tests: device, and the same wrong result reaching the server).

### C2: returns ignore discounts (High)

- **Evidence (server and device):** a ৳50.00 item sold with a ৳10.00 bill discount (paid ৳40.00): returning it refunds **৳50.00**. A line discount of ৳20.00 on ৳100.00: refunds ৳100.00 instead of ৳80.00. Returning every unit of a ৳120.00 sale refunds **৳150.00**.
- **Why:** the return is priced at the line's unit price (`src/components/returns/return-dialog.tsx:84`, and the server rebuilds it from the stored unit price in `src/server/commands/prepare.ts:77`), before any discount.
- **By hand:** sell one item with a discount in the cart; return it. The refund is the full price.
- **Tests:** `qa-money.test.ts` (3 tests), `qa-sync.test.ts` (1).

### S1: operations sent out of order (High)

- **Evidence:** a customer is created while the connection is bad (the send fails and waits ~5 s), then a ৳100.00 credit sale is made to that customer. The sale is sent first. After everything is delivered, the server says the customer owes **৳0.00** instead of ৳100.00. The same for a product created offline and then sold: stock is 10 instead of 9. A direct check shows the queue sends the later operation while the earlier one is still waiting.
- **Why:** `src/sync/engine.ts:153-158` sends every operation that is due and skips those still backing off, so a later operation can overtake an earlier one it depends on.
- **When it happens:** any time a send fails (weak mobile data) and the shop keeps selling before the retry. The loss is silent.
- **Tests:** `qa-sync.test.ts` (3 tests).

### S2: a refused sale leaves traces on the device (High)

- **Evidence:** a cashier's credit sale at a changed price is refused by the server (FORBIDDEN) and the device says so. But the device still has the sale's **line**, stock **2 units lower**, the customer's balance **৳20.00 higher**, and the sale's ledger entry and stock movements. Only the sale record itself is removed.
- **Why:** `src/sync/engine.ts:127-137` and `src/sync/resolve.ts:64-77` undo only the operation's own record.
- **Same cause for** (from reading the code, not tested): any other refusal (a deactivated cashier, a changed role, a duplicate), and "discard" in the sync screen.
- **Tests:** `qa-sync.test.ts` (5 tests: the refusal is reported; lines, stock, balance, ledger and movements).

### C3: the offline path trusts the device's prices (Medium)

- **Evidence:** a cashier's device sold a ৳50.00 product at ৳10.00 while claiming the list price was ৳10.00; the server accepted the sale (total ৳10.00). The permission to change prices is meant to stop this.
- **Why:** the offline path takes `listPrice` and `unitCost` from the device (`src/server/commands/sales.ts:202-206`); the online path replaces them from the server's product (`prepare.ts:188`).
- **Needs:** someone who edits the app's data in the browser. A normal cashier screen cannot do it. Return prices have the same shape of problem (not tested).
- **Tests:** `qa-money.test.ts` "QA C3".

### C4: deleting a customer who owes money (Medium)

- **Evidence:** a customer with ৳100.00 due is deleted without any warning (the command succeeds). After that, collecting a payment from them fails (not found), so the shop cannot record the money it is owed, and the due drops out of the dues report.
- **Where:** `src/server/commands/master-data.ts:158-188`, `src/components/parties/parties-screen.tsx:283`.
- **Tests:** `qa-money.test.ts` (2 tests). The same applies to suppliers (not separately tested).

### C5: the same barcode created on two offline devices (Medium)

- **Evidence:** the second device's product is refused (DUPLICATE_BARCODE) and the device reports it: that part works (a normal passing test). But a sale of that product made on the second device before it synced is **kept by the server with no stock movements** (an orphaned sale of a product that does not exist in the shop).
- **Tests:** `qa-money.test.ts` (2 tests).

### S4: a paused shop's devices retry every second (Medium)

- **Evidence:** after a "shop paused" answer the operation is due again at once: 5 attempts in the same instant send 5 requests, and the operation's next attempt time stays in the past. `src/sync/manager.ts:215-222` then wakes again after `max(next attempt − now, 1 s)`, so each open device calls the server about once a second until the shop is resumed. An ordinary network failure does back off.
- **Note:** the server refuses a paused shop before its rate limit, so nothing stops it. No data is lost. By reading the code the same applies to "sign in again" and "update the app" answers (not tested).
- **Not tested:** the manager itself (it needs a browser-like environment; `manager.ts` has no tests at all).
- **Tests:** `qa-sync.test.ts` (2 tests, plus one passing test showing the normal back-off).

### S5: what can block a device's queue (Medium)

- **Evidence (three separate causes):**
  1. **Size:** ten sales of 200 lines with long Bangla names make one request of **1,676,500 bytes**; the server refuses more than 1,000,000 (413). The engine never splits a batch, so the same batch fails forever. (Ordinary sales are far smaller: this needs very large sales, or a long stuck queue.)
  2. **One bad operation:** a single malformed operation makes the whole request schema invalid (the route answers 400), so the good operations wait behind it. (Tested at the schema level; the route is `src/app/api/sync/push/route.ts`.)
  3. **An operation that always fails on the server** (tested with an old sale record that has no lines, then voided) is answered "retry", and so is every operation behind it; the device sends it again for ever.
- **Tests:** `qa-sync.test.ts` (1), `qa-money.test.ts` (2).

### POS-1: "Hold" while a sale is saving (Medium)

- **Evidence:** online with a slow server (4 s): tap Complete, then tap Hold while it says "Saving…". The sale goes through **and a copy of the same items stays on hold** (phone: the cart bar stays enabled; desktop: "On hold (1)" is shown). Resuming it would sell the same goods again.
- **Why:** nothing in the cart panel is disabled while saving (`src/components/pos/use-complete-sale.ts`, `cart-panel.tsx`).
- **Not tested yet:** editing the cart while saving, a double F9 / Ctrl+Enter offline, and an online retry with an edited cart making two sales.
- **Tests:** `tests/e2e/qa-money.spec.ts` "QA POS-1" (online only: offline a sale saves instantly).

## 4. Needs a product decision

- **C1:** may a sale that already has returns be voided at all, or only its remaining part?
- **C2:** how should a discount be shared out over the returned lines (a bill discount spread by line value is the usual answer).
- **C3:** the offline path cannot ask the server what the list price is at the moment of sale, but the server could compare with its own product record afterwards.
- **C4:** forbid deleting a customer or supplier with a balance, or allow it with a clear warning that the money owed is lost?
- **S2:** a sale the server refuses has really happened at the counter (goods left, cash taken). Should it be deleted from the device, or kept on screen as "needs attention" so the owner can decide?
- **S1:** should the app stop sending later operations until an earlier one it depends on is delivered (simplest: send strictly in order and wait)?

## 5. Not covered yet

- **From the plan, still to do:** P0 security (H1–H5, M1, M2, M10/M11), P1 sync, modes and restore (S3, S6–S8, S10, D1–D4), billing (B1–B8), screens and forms, and the modules without tests (`manager.ts`, `resolve.ts`, `transport.ts`, `cart.ts`).
- **Within this part:** the manager-level behaviour of S4, the rest of POS-1 (above), return prices on the offline path (C3), the supplier version of C4, and what the owner sees after S2 on the sync screen.

## 6. Notes on running the browser tests

- A server left running on port 3100 is silently reused by the next run, so the tests then check an old build. Make sure nothing listens on 3100 first.
- Do not run `pnpm test` while a Playwright build or run is going: the in-memory databases then fail to start (false failures).
