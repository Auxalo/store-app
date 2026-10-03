# Store App — Technical Implementation Plan

> Source of truth: *Offline-First Store Management Web App — Product & Technical Specification*.
> This document turns that spec into concrete decisions and a phase-based build order.
> Status: **Draft for review** · 2026-10-01

---

## 0. TL;DR

- **One Next.js 16 app** (App Router, TypeScript strict). APIs are Route Handlers. No separate backend.
- **IndexedDB (Dexie) is the database the UI talks to.** MongoDB Atlas is the cloud copy and merge point. The browser never talks to MongoDB.
- **Every write is a "command".** One Dexie transaction writes the business records, the ledger entries and an **outbox** operation together, so it is all-or-nothing and crash-safe.
- **The sync engine is built in Phase 2, before any business module.** Products, POS, purchases and the rest are then just new command types on a proven pipeline. Retrofitting sync later is the #1 way offline apps fail. This is the main change from the spec's phase order, which builds the sync engine after POS.
- **Inventory and dues are ledgers.** Money is stored as integer **poisha**. Financial records are immutable; corrections are new records.
- **Mobile-first UI** built only from existing parts: shadcn/ui + Tailwind v4, with a bottom nav on phones and a sidebar on desktop. **Bangla is built in from day 1** (next-intl, Noto Sans Bengali, `bn-BD` formatting, Bangla-aware search).
- **PWA via Serwist.** Every app page is statically renderable, so the whole app shell can be precached and opened offline.

---

## 1. Technology Stack (verified current versions, Oct 2026)

| Concern | Choice | Version | Why this one |
|---|---|---|---|
| Framework | **Next.js** (App Router, Turbopack) | 16.3 | Required by spec; Route Handlers replace a backend |
| UI runtime | React | 19.3 | Ships with Next 16 |
| Language | TypeScript (strict) | 5.x | — |
| Styling | **Tailwind CSS** | 4.3 | Zero-runtime CSS, mobile-first utilities |
| Components | **shadcn/ui** (Radix primitives) | CLI 4.x | Accessible, copy-in components, no design work to invent |
| Icons | lucide-react | latest | shadcn default |
| Mobile sheets | vaul (shadcn `Drawer`) | 1.1 | Native-feeling bottom sheets for phone POS/forms |
| Command/search UI | cmdk (shadcn `Command`) | 1.1 | Keyboard-first product picker and command palette |
| Toasts | sonner (shadcn `Sonner`) | 2.0 | Lightweight, non-blocking |
| Tables | **TanStack Table** + **TanStack Virtual** | 9.x / 3.14 | Headless; virtualization for 10k+ rows |
| Forms | react-hook-form + `@hookform/resolvers` + shadcn `Field` | 7.89 | Uncontrolled inputs mean fewer re-renders on low-end phones |
| Validation | **Zod** | 4.6 | Same schemas on client, API and sync engine |
| Local DB | **Dexie** + `dexie-react-hooks` (`useLiveQuery`) | 4.4 | Best IndexedDB wrapper; live queries sync across tabs |
| UI state | **Zustand** | 5.0 | Cart, filters, UI toggles only. Never business data |
| Cloud DB | **MongoDB Atlas** + official `mongodb` driver | 7.7 | Multi-document transactions; Zod already validates, so no Mongoose |
| Auth | **Better Auth** (MongoDB adapter, `username` plugin; `storeId` + `role` as user fields) | 1.7 | Self-hosted, secure cookies. The organization plugin is skipped: one store per user and the owner creates staff directly, so invitations/teams would be dead weight |
| i18n | **next-intl** (client provider, no locale routing) | 4.14 | Typed message keys; ICU plurals; works in static pages |
| Dates | date-fns + `@date-fns/tz` | 4.4 / 1.5 | Asia/Dhaka business-day boundaries; UTC storage |
| IDs | `uuid` **v7** | 14.x | Time-sortable, RFC 9562, generated offline |
| PWA / Service Worker | **Serwist** (`@serwist/turbopack`) | 9.5 | Workbox successor with official Next.js + Turbopack support |
| Barcode (camera) | Native `BarcodeDetector` + `barcode-detector` ponyfill | 3.2 | Native on Android Chrome, WASM fallback elsewhere |
| Keyboard shortcuts | react-hotkeys-hook | 5.3 | POS shortcuts |
| Generic hooks | usehooks-ts | latest | `useMediaQuery`, `useEventListener`, … No custom hooks where these exist |
| Charts | shadcn `Chart` (Recharts) | 3.10 | Reports and dashboard only, lazy-loaded |
| Lint/format | **Biome** | 2.5 | Much faster than ESLint+Prettier; offered by create-next-app |
| Unit/integration tests | Vitest + `fake-indexeddb` + `mongodb-memory-server` (replica set) | 5.0 / 6.2 / 11.3 | Tests the sync engine without a browser; replica set gives real transactions |
| E2E / offline tests | **Playwright** | 1.63 | `context.setOffline()`, multiple contexts act as multiple devices |
| Package manager | pnpm | latest | Fast, strict |
| UI helper | `cn` (shadcn's own class-merge package) | 0.4 | Pulled in by shadcn's current preset, replaces clsx + tailwind-merge |
| Hosting (proposed) | Vercel (`bom1` Mumbai) + Atlas (Mumbai `ap-south-1`) | — | Lowest latency to Bangladesh; app and DB in the same region |

**Not used, on purpose:** Mongoose (duplicates Zod), Redux (overkill), TanStack Query for business data (Dexie live queries already handle it), `localStorage` for data (spec rule), a custom design system (spec rule).

---

## 2. Architecture

```text
┌───────────────────────────── Browser / PWA ─────────────────────────────┐
│                                                                          │
│  React UI (static, precached pages)                                      │
│     │ reads: useLiveQuery()                │ writes: runCommand()        │
│     ▼                                      ▼                             │
│  ┌──────────────────────── Dexie / IndexedDB ────────────────────────┐   │
│  │ products  categories  customers  suppliers  sales  saleItems      │   │
│  │ purchases purchaseItems payments expenses returns stockMovements  │   │
│  │ ledgerEntries  settings  localUsers  drafts  auditLogs            │   │
│  │ outbox (syncQueue)   syncMeta (cursor, deviceId, clock offset)    │   │
│  └───────────────────────────────▲───────────────────────────────────┘   │
│                                  │                                        │
│  Sync Manager (one leader tab via Web Locks)                             │
│     push: outbox → POST /api/sync/push   (batched, idempotent)           │
│     pull: GET /api/sync/pull?cursor=N     (incremental)                  │
│                                                                          │
│  Service Worker (Serwist): app shell, JS/CSS, fonts, icons ONLY          │
└──────────────────────────────────┬───────────────────────────────────────┘
                                   │ HTTPS (cookie auth)
┌──────────────────────────────────▼───────────────────────────────────────┐
│ Next.js Route Handlers  (/api/auth, /api/sync/*, /api/devices, /api/reports)│
│   Zod validation → auth/permission → command handlers → Mongo transaction │
└──────────────────────────────────┬───────────────────────────────────────┘
                                   ▼
                         MongoDB Atlas (replica set)
```

**The local-first rule (spec §23) as code:**

```text
UI action → runCommand('sale.create', input)
          → Zod validate
          → ONE Dexie rw-transaction:
               write sale + items + stockMovements + payment + ledgerEntries
               update cached product stock / customer balance
               append outbox op { operationId, type, payload, ... }
          → UI updates instantly (useLiveQuery)
          → syncManager.nudge()   (no await, no spinner)
```

---

## 3. Core Design Decisions

Each decision covers: **What / Why / Online / Offline / Sync / Failure cases → Handling.**

### 3.1 Every page is statically renderable (offline routing)

- **What:** All app routes are client components that read from Dexie. They never call `cookies()`, `headers()` or fetch server data while rendering. Detail pages use **search params** (`/products/view?id=…`) instead of dynamic segments (`/products/[id]`).
- **Why:** The service worker can only precache HTML that exists at build time. A dynamic `/products/[id]` page would 404 offline for any product created after the build. A static page that reads `?id=` from Dexie works for every ID.
- **Online / Offline:** Same behaviour. HTML comes from the precache, data from IndexedDB.
- **Failure cases:** A developer adds a server-only data fetch to a page → that page breaks offline. **Handling:** a CI check fails the build if any app route under `(app)/` is reported as dynamic (`ƒ`) by `next build`. The Playwright offline test visits every route.

### 3.2 IndexedDB reliability

- **What:** Dexie 4. The schema is versioned, and all tables are declared in v1 even if their feature comes later.
- **Why:** Dexie handles transactions, migrations, multi-tab change propagation and Safari quirks.
- **Measures:**
  - On first run, call `navigator.storage.persist()` so the browser doesn't evict data under storage pressure. The result is shown in Sync Status. If the browser refuses, show a gentle "Install the app to protect offline data" hint. Installed PWAs are exempt from Safari's 7-day eviction.
  - `navigator.storage.estimate()` is shown in Sync Status, with a warning above 80% usage.
  - **Data window:** master data (products, customers, suppliers, categories) is always kept in full. Transactions are kept for a configurable window (default **120 days**). Older history comes from the online report APIs. Synced outbox rows are pruned after 7 days.
  - Migrations only add data. A Dexie `upgrade()` never drops unsynced data. If a migration ever needs a reset, the app first pushes the outbox.
- **Failure cases:**
  - Quota exceeded → the write transaction aborts and **nothing is half-written**. The user sees "Storage full", and the app offers to prune old synced history.
  - The user clears site data → unsynced operations are lost. **Handling:** Sync Status always shows the pending count, and the app warns before logout if pending > 0.
  - A Dexie open fails because another tab holds an old version → the `versionchange` handler closes the old connection and prompts that tab to reload.

### 3.3 Commands + Outbox (spec §24 `syncQueue`)

- **What:** A single function `runCommand(type, input)`. Each command type has (a) a Zod input schema, (b) a **local apply** function (Dexie) and (c) a **server apply** function (Mongo). Both apply functions live in `src/commands/<type>.ts` so they cannot drift apart.
- **Outbox row:**
  ```ts
  { operationId: uuidv7, type: 'sale.create', schemaVersion: 1,
    payload, actorUserId, deviceId, createdAt (client UTC),
    status: 'pending'|'syncing'|'synced'|'failed'|'conflict',
    attempts, lastError?, nextAttemptAt }
  ```
- **One operation per business action, not per row.** A sale is one operation that carries the sale, items, movements and payment, so the server applies it atomically too.
- **Failure cases:**
  - The tab crashes mid-sale → the Dexie transaction never committed, so there is no sale and no outbox row (consistent). The cart is kept (see 3.14), so the cashier just taps Complete again.
  - The device crashes after commit but before sync → the outbox row is in IndexedDB and syncs on next open.

### 3.4 IDs and invoice numbers

- **IDs:** `uuidv7()` is generated on the client for every entity and operation. MongoDB `_id` = that same string.
- **Invoice numbers:** two offline devices must never both create `INV-0001`. Each device gets a short **device code** when it is registered (A, B, C…, unique per store). The format is `{deviceCode}-{YYMM}-{seq}`, for example `A-2610-0042`. The per-device counter lives in `syncMeta` and increments inside the sale transaction. It is human-readable, unique without coordination, and resets monthly. The same scheme is used for purchase and return numbers.

### 3.5 Money and quantity

- **Money:** integers in **poisha** (৳1 = 100). There is no floating-point arithmetic on money anywhere. Values are formatted only at display time.
- **Quantity:** stored as an integer in **milli-units** (1.5 kg = 1500). Each unit has a `decimals` setting: pcs = 0, kg = 3. Prices are per unit. Line total = `round(qty_milli × unitPrice / 1000)`.
- **Bangla digit input:** users may type `১২৫০` on a Bangla keyboard. Every numeric input normalizes `০-৯` → `0-9` before parsing, using one shared `parseNumber()` util.

### 3.6 Inventory: ledger + safe cached stock (spec §8)

- **What:** `stockMovements` is append-only: `{id, productId, qtyDelta, type, refType, refId, createdAt, deviceId}`. Types: `opening | purchase | sale | sale_return | purchase_return | damage | adjustment | correction`.
- **Server:** applying an operation inserts the movements and runs `$inc` on `products.stock` **in the same Mongo transaction**. The server stock is always exactly the sum of the movements the server has received.
- **Client:** each local product holds
  - `serverStock`: the last value received from the server, plus `stockSeq` (the server sequence of that value)
  - `pendingDelta`: the sum of local movements that haven't been acknowledged yet
  - **Displayed stock = `serverStock + pendingDelta`**
- **Sync:**
  - Push response → for each acknowledged operation, the server returns the authoritative `{productId, stock, stockSeq}`. One Dexie transaction then marks the operation `synced`, subtracts its movements from `pendingDelta`, and sets `serverStock` (only if the incoming `stockSeq` is newer). The number never flickers or double-counts.
  - Pull → updated products from other devices bring a new `serverStock` (applied only if `stockSeq` is newer). `pendingDelta` is untouched, so local unsynced sales are still counted.
- **Two devices selling the last item offline:** both sales succeed and stock becomes −1 after sync. **Sales are never blocked by stock.** Negative stock is highlighted in Inventory and the low-stock report, and fixed with a `correction` movement. This matches how real shops operate.
- **Never** `stock = newValue`. A "set stock to 50" action in the UI creates an `adjustment` movement of `50 − currentStock`.

### 3.7 Dues: ledger (spec §12)

- `ledgerEntries {id, partyType: 'customer'|'supplier', partyId, amountDelta, refType, refId, createdAt}`
  - Sale with a due amount → `+due` on the customer. Due collection → `−amount`. Sale return credited → `−amount`.
  - Purchase with a due amount → `+due` on the supplier. Supplier payment → `−amount`.
- Party balances use the same `serverBalance + pendingDelta` pattern as stock, so they converge across devices for the same reason.

### 3.8 Sync protocol

#### Push — `POST /api/sync/push`
- Body: `{ deviceId, appVersion, ops: Op[] }`. At most 50 operations or about 512 KB, sent oldest first.
- The server processes operations **in order, one Mongo transaction per operation**:
  1. `insertOne` into `appliedOps { _id: operationId, result, appliedAt }`. If that hits a **duplicate key error**, the operation was already applied: return the stored `result` and **do nothing else**. *(This is the idempotency guarantee. Retrying 5 times creates one sale.)*
  2. Zod-validate the payload, check the actor's permission, and run the command's server apply function. Every entity insert uses the client `_id`, so the unique `_id` is a second safety net against duplicates.
  3. `$inc` the store's `syncSeq` counter and stamp the new value on every touched document.
- Per-operation result: `applied | duplicate (treated as applied) | conflict | rejected (validation/permission, permanent) | retry (transient)`.
- The response also contains `serverTime`, which the client uses for **clock-offset detection**.

#### Pull — `GET /api/sync/pull?cursor=N`
- Each store has a `syncSeq` counter document. It is incremented inside every write transaction, so writes for one store are serialized and **sequence order = commit order**. The cursor never skips a late-committing write, which `updatedAt`-based cursors would.
- The server queries each syncable collection for `{storeId, syncSeq > N}` (indexed), merges the results, and returns docs up to a safe upper bound, plus `{nextCursor, hasMore}`. The client loops until `hasMore = false`.
- Docs include tombstones (`deletedAt`). The client applies each page in one Dexie transaction and saves the cursor in that same transaction, so a crash mid-pull just repeats that page.
- Transactions older than the local data window are skipped.

#### Bootstrap — `GET /api/sync/bootstrap`
- Used on first device setup. It sends a paginated snapshot of master data plus recent transactions, then a starting cursor. A progress bar is shown during setup only. This is the one place a spinner is allowed.

#### Tombstones (spec §29)
- Master data is soft-deleted with `deletedAt`. Local queries filter it out. Products referenced by sales are never hard-deleted; they are deactivated instead.

### 3.9 Conflict strategy

| Data | Strategy | What the user sees |
|---|---|---|
| Sales, purchases, payments, expenses, returns | **Immutable, create-only.** No conflicts possible | Nothing |
| Cancel/void a transaction | A status transition `active → voided`, applied once, idempotent. The reversal movements/ledger entries are created by that operation | Nothing |
| Stock | Ledger. Movements from all devices add up. Never last-write-wins | Negative-stock badge if oversold |
| Party balances | Ledger | Nothing |
| Product / customer / supplier / category fields | Operation carries **only changed fields + `baseVersion`**. If server `version == baseVersion`, apply. If not: **auto-merge** when the changed fields don't overlap with fields changed on the server since `baseVersion` (server keeps per-field `fieldVersions`). Overlapping low-risk fields (name, description, phone) use latest `updatedAt`. Overlapping **prices** become a **conflict** | Conflicts listed in Sync Status → "Keep mine / Keep server" (the resolution is audited) |
| Settings | Per-key last write wins with version | Nothing |

### 3.10 Sync manager

- **Triggers (spec §32):** app open, `online` event, `visibilitychange` → visible, after each command (debounced 1 s), every 60 s while online, manual **Sync Now**.
- **Single leader:** `navigator.locks.request('store-sync')` makes sure only one tab syncs. Other tabs still see changes immediately through Dexie live queries.
- **Backoff:** exponential with jitter, 5 s → 15 s → 1 m → 5 m (cap). It resets when connectivity returns or a push succeeds. `rejected` operations become `failed` and stop retrying; the owner can review and discard them. A `failed` operation never blocks later ones.
- **Connectivity:** `navigator.onLine` is only a hint. "Online" is confirmed by a successful sync request.
- **Global indicator (spec §31)** in the header: `● Offline`, `↑ 3 pending`, `⟳ Syncing`, `✓ Synced`, `⚠ Sync issue`. It is a small badge and never a modal. Tapping it opens `/sync`.
- **Clock skew:** if `|deviceTime − serverTime| > 5 min`, show "Device clock is wrong" in Sync Status and store `clientCreatedAt` + `serverReceivedAt` on records. Reports use the client time, because that is when the sale actually happened.
- **Version gate:** if the server returns `426 Upgrade Required` because the app is too old for the operation schema, the outbox is **kept**, the app asks the user to update, and it pushes after the update.

### 3.11 Authentication, devices, offline unlock, permissions

- **Online login:** Better Auth with **username/phone + password**. Many BD shop staff have no email; SMS OTP costs money, so it is a later option. The session is an httpOnly + Secure + SameSite=Lax cookie. Each store is a Better Auth **organization**, and roles are `owner | manager | cashier`, with permissions defined through the access-control plugin (spec §45 list).
- **Owner signup** creates the store and owner (`POST /api/stores`). The default settings, "Walk-in Customer", expense categories and units are seeded as synced records in Phase 2/3.
- **Trusted device:** after the first login on a device, `POST /api/devices/register` creates `{deviceId, code: 'A', storeId}` and sets a long-lived httpOnly **device cookie**. The token is stored only as a hash on the server. **Sync endpoints authenticate with the device token.** Each operation carries `actorUserId`, and the server checks that the actor is an active member with permission for that command. This lets several cashiers share one terminal offline. The owner can revoke a device from Settings.
- **Offline unlock (spec §46):** after an online login, each user sets a **4–6 digit PIN**. Dexie `localUsers` stores `{userId, name, role, permissions, pinSalt, pinHash}`, with the hash computed by **PBKDF2-SHA256 at 310k iterations via WebCrypto**. The PIN itself is never stored. The app shows a "Who's working?" user picker → PIN pad. 5 wrong attempts → increasing lockout; repeated lockouts require an online login. The app auto-locks when idle (configurable).
- **When back online:** if the server says the session or device was revoked, the app locks and requires a fresh login. **The outbox is preserved** and pushed after re-login.
- **Honest trade-off:** offline permission checks run on the client, so a user with dev tools could bypass the UI. **The server re-checks every operation on push**, rejected operations are visible to the owner, and sensitive actions are audited. The PIN protects against casual access, not a stolen unlocked device. IndexedDB data is not encrypted at rest, because the key would have to live on the same device and it would slow down every query.

### 3.12 PWA & service worker (spec §20–21)

- **Serwist** via `@serwist/turbopack`. A `manifest.webmanifest` with standalone display, bn/en name, theme colour and maskable icons.
- **Precache:** every static app route's HTML, all JS/CSS chunks, self-hosted fonts and icons.
- **Runtime:** page navigations → precached HTML (cache-first; the new service worker updates the cache). `/api/*` → **network-only** (never cached; data lives in IndexedDB). Fonts and icons → cache-first.
- **Offline fallback:** any unknown route → the precached app shell.
- **Update flow:** when a new service worker is waiting → toast "Update available". It is applied (`skipWaiting` + reload) **only when the cart is empty**, and never mid-sale.
- **Install prompt:** a custom "Install app" button using `beforeinstallprompt` on Android, and an instruction sheet for iOS.

### 3.13 Bangla / i18n (spec §35–39)

- **Messages:** `src/i18n/messages/en.json` and `bn.json`, namespaced (`pos.completeSale`). next-intl `NextIntlClientProvider` runs at the client root. There is **no locale prefix in URLs**, so the precache isn't doubled and switching language is instant. The locale is stored in Dexie settings and mirrored to `localStorage` for a flash-free first paint (a tiny preference, allowed by spec §17). `<html lang>` is updated on switch.
- **Typed keys:** next-intl's `AppConfig` augmentation from `en.json`, so a missing key is a TypeScript error. A CI script fails the build if `bn.json` and `en.json` keys differ.
- **Biome lint rule plus review rule:** no visible string literals in JSX.
- **Formatting (`src/lib/format.ts`, the only place that formats):**
  - Locale `bn-BD` / `en-BD`. Numerals preference is applied through the Unicode extension `-u-nu-beng` / `-u-nu-latn`, so Bangla text can be shown with English digits and vice versa.
  - Currency: `Intl.NumberFormat(locale, {style:'currency', currency:'BDT', currencyDisplay:'narrowSymbol'})` → `৳১,২৫০.০০` / `৳1,250.00`. Lakh grouping (`১,২৫,০০০`) is verified in unit tests.
  - Dates use `Intl.DateTimeFormat` with `timeZone` from settings (default `Asia/Dhaka`). Storage is always UTC ISO. "Today" boundaries are computed in the store timezone (`@date-fns/tz`).
- **Fonts:** `next/font/google` loads **Noto Sans Bengali** (variable, `bengali` subset) plus **Inter** (`latin`), self-hosted at build and therefore precached. The CSS stack is `Inter, "Noto Sans Bengali", system-ui`, so the browser picks per glyph. Line height is ≥ 1.5 for Bangla matras, and fixed-height truncation that clips conjuncts is avoided.
- **Data:** products and categories have `name` + `nameBn`. Customers and suppliers have a single `name`, which can be in either script.
- **Search normalization (`normalizeSearch()`):** Unicode NFC → lowercase → strip ZWJ/ZWNJ (U+200C/U+200D) → Bangla digits → ASCII → collapse whitespace. Tokens from `name`, `nameBn`, `sku` and `barcode` go into a Dexie **multi-entry index `*searchWords`**. A query uses `startsWith` on the first token via the index, then filters the remaining tokens in memory. Barcode and SKU get exact-match indexes that are checked first. Target: **< 30 ms for 20k products**.

### 3.14 Responsive, mobile-first UX (spec §40–42)

- **One nav config** drives both layouts:
  - **Phone (< 768 px):** a top bar (store name, sync badge, language) plus a **bottom nav**: Home · POS · Products · Sales · More. "More" opens a shadcn `Sheet` with the full menu.
  - **Tablet/desktop:** the shadcn `Sidebar` (collapsible to icons).
- **POS on phone:** a full-screen search bar (auto-focus) + category chips + a virtualized product list with large tap rows. A **sticky bottom bar** ("3 items · ৳1,250 → Checkout") opens a `Drawer` with the cart, qty steppers, discount, customer and payment. Cash sale = **tap product(s) → Checkout → Complete** (3 taps).
- **POS on desktop:** the split layout from spec §42. Shortcuts: `/` or `F2` focus search, `↑↓` + `Enter` add, `+`/`-` qty, `Del` remove, `F9` / `Ctrl+Enter` complete, `Esc` clear search, `F4` customer.
- **Barcode:** USB/Bluetooth scanners type into the search box and end with `Enter`, which triggers an exact barcode lookup and adds the product. Camera scanning uses `BarcodeDetector` with the ponyfill as fallback.
- **Cart persistence:** a Zustand store with `persist` writing to the Dexie `drafts` table, so a reload or crash never loses a cart. There is also a "Hold sale" option for a second customer.
- **Forms:** the shadcn **responsive dialog pattern**: `Dialog` on desktop, `Drawer` on phone, switched with `useMediaQuery`.
- **Lists:** card rows on phone, TanStack Table on desktop, both virtualized.
- **Phone details:** `inputmode="decimal"`/`numeric`; inputs ≥ 16 px (no iOS zoom); touch targets ≥ 44 px; `100dvh`; `env(safe-area-inset-*)` for standalone mode.
- **Visual style:** plain and dense, with no gradients, glass effects or heavy animation (spec §16). Light and dark themes come from shadcn tokens via `next-themes`.

### 3.15 Performance (spec §50–51)

- **Budgets:** POS route JS ≤ 200 KB gzipped; local actions < 100 ms; INP < 200 ms on a mid-range Android device with 4× CPU throttle; cached start ≤ 2 s.
- **How we meet them:**
  - Use live queries with narrow selectors (no "load all products into state").
  - Virtualize every list over 100 rows.
  - Lazy-load charts, the barcode camera and the report pages.
  - Keep React Compiler on (Next 16) to avoid manual memoization.
  - Search runs on indexes, not scans.
  - The cart is a Zustand store with selectors, so adding an item re-renders only the cart.

### 3.16 Security (spec §48)

- MongoDB URI exists only in server env, validated with Zod at boot. The `server-only` import guard is used on the db module.
- Every Route Handler: Zod-parse input → authenticate (session or device token) → authorize (permission) → scope every query by `storeId` from the auth context, **never from the request body**.
- CSP with nonces is set via `next.config` headers; HSTS; `X-Content-Type-Options`; frame-ancestors none.
- React escapes output by default. There is no `dangerouslySetInnerHTML`.
- Login is rate-limited (Better Auth built-in).
- **Audit log (spec §49):** sensitive commands (price change, stock adjust, void, user/permission changes, conflict resolution) write an `auditLogs` record **inside the same command**, so the audit record syncs exactly like data.

---

## 4. Data Model

### 4.1 Common fields

```ts
// every syncable record
id: string            // uuidv7 (Mongo _id)
storeId: string
createdAt: string     // UTC ISO, client time
updatedAt: string
createdBy: string     // userId
deviceId: string
version: number       // master data only
deletedAt?: string    // tombstone (master data)
syncSeq?: number      // server-assigned; absent locally until synced
```

### 4.2 MongoDB collections (key indexes)

| Collection | Notes | Indexes |
|---|---|---|
| `stores` | name, address, phone, settings, **`syncSeq` counter** | — |
| `devices` | code (A/B/C), tokenHash, lastSeenAt, revokedAt | `{storeId, code}` unique |
| Better Auth: `user`, `session`, `account`, `organization`, `member` | managed by Better Auth | — |
| `categories`, `products`, `customers`, `suppliers`, `units`, `expenseCategories` | master data, `version`, `fieldVersions` | `{storeId, syncSeq}`; products also `{storeId, barcode}`, `{storeId, sku}` |
| `sales` (items **embedded**) | immutable; `status: active\|voided`; `invoiceNo` | `{storeId, syncSeq}`, `{storeId, createdAt}`, `{storeId, invoiceNo}` unique, `{storeId, customerId}` |
| `purchases` (items embedded) | immutable | same pattern |
| `returns` | `kind: sale\|purchase`, refs original | same pattern |
| `payments` | due collection / supplier payment / sale payment | `{storeId, partyId}` |
| `expenses` | immutable + void | `{storeId, createdAt}` |
| `stockMovements` | append-only | `{storeId, productId, createdAt}`, `{storeId, syncSeq}` |
| `ledgerEntries` | append-only | `{storeId, partyId, createdAt}` |
| `appliedOps` | `_id = operationId`, stored result | TTL 180 days |
| `auditLogs` | append-only | `{storeId, createdAt}` |
| `dailySummaries` | server-side aggregates for fast online reports | `{storeId, date}` unique |

> Sale and purchase items are **embedded** in MongoDB (always read and written together, immutable). The spec allows this ("embedded structures can be used where appropriate"). Locally they are a separate `saleItems` table, which makes product-wise reports fast to index.

### 4.3 Dexie schema v1

```ts
db.version(1).stores({
  products:       'id, sku, barcode, categoryId, *searchWords, isActive, updatedAt',
  categories:     'id, updatedAt',
  units:          'id',
  customers:      'id, phone, *searchWords, updatedAt',
  suppliers:      'id, phone, *searchWords, updatedAt',
  sales:          'id, invoiceNo, createdAt, customerId, status, [status+createdAt]',
  saleItems:      'id, saleId, productId, createdAt',
  purchases:      'id, invoiceNo, createdAt, supplierId',
  purchaseItems:  'id, purchaseId, productId, createdAt',
  returns:        'id, kind, refId, createdAt',
  payments:       'id, partyId, createdAt',
  expenses:       'id, categoryId, createdAt',
  expenseCategories: 'id',
  stockMovements: 'id, productId, createdAt, [productId+createdAt], synced',
  ledgerEntries:  'id, partyId, createdAt, [partyId+createdAt], synced',
  auditLogs:      'id, createdAt, entity',
  settings:       'key',
  localUsers:     'userId',
  drafts:         'key',               // persisted cart(s)
  outbox:         'operationId, status, [status+createdAt], nextAttemptAt',
  syncMeta:       'key',               // cursor, deviceId, deviceCode, invoice counters, clockOffset
});
```

---

## 5. API Routes (Route Handlers)

| Route | Purpose | Auth |
|---|---|---|
| `/api/auth/[...all]` | Better Auth (login, logout, session, org/members) | — |
| `POST /api/stores` | Owner onboarding (create store + defaults) | session |
| `POST /api/devices/register` · `GET /api/devices` · `DELETE /api/devices/:id` | Trusted-device lifecycle | session (owner for list/revoke) |
| `GET /api/sync/bootstrap?page=` | Initial snapshot | device |
| `POST /api/sync/push` | Batched idempotent operations | device + per-op actor |
| `GET /api/sync/pull?cursor=` | Incremental changes | device |
| `GET /api/reports/:name?from&to` | Heavy historical reports (Mongo aggregation) — online only | session + `view_reports` |
| `GET /api/sales/lookup?invoiceNo=` | Find old sale outside local window (for returns) | session |

There are **no per-entity CRUD APIs.** All business writes go through `/api/sync/push`, which gives one code path, one validation path and one idempotency path.

---

## 6. Folder Structure

```text
src/
├── app/
│   ├── (auth)/login/  (auth)/signup/  (auth)/unlock/
│   ├── (app)/                    # static, client pages; AppShell layout
│   │   ├── dashboard/ pos/
│   │   ├── products/ (list) products/view/ products/new/
│   │   ├── categories/ inventory/ inventory/movements/ inventory/adjust/
│   │   ├── sales/ sales/view/ purchases/ purchases/view/ returns/
│   │   ├── customers/ customers/view/ suppliers/ suppliers/view/
│   │   ├── expenses/ payments/ reports/ sync/ settings/
│   ├── api/ (auth, stores, devices, sync, reports, sales)
│   ├── sw.ts                     # Serwist service worker
│   └── manifest.ts
├── commands/                     # one file per command: schema + applyLocal + applyServer
│   ├── registry.ts  sale.create.ts  sale.void.ts  product.upsert.ts  stock.adjust.ts …
├── db/
│   ├── local/   (dexie.ts, schema.ts, queries/*.ts)
│   └── server/  (mongo.ts, collections.ts, indexes.ts, seq.ts)
├── sync/        (outbox.ts, push.ts, pull.ts, bootstrap.ts, conflict.ts, manager.ts, leader.ts)
├── schemas/     (zod: common.ts, product.ts, sale.ts, purchase.ts, …)
├── auth/        (better-auth.ts, permissions.ts, pin.ts, device.ts)
├── components/
│   ├── ui/      # shadcn (generated, untouched)
│   ├── layout/  (app-sidebar, bottom-nav, sync-badge, language-switch)
│   ├── pos/ products/ inventory/ sales/ parties/ reports/ shared/
├── stores/      # zustand: cart.ts, ui.ts, session.ts
├── i18n/        (config.ts, messages/en.json, messages/bn.json)
├── lib/         (format.ts, money.ts, qty.ts, search.ts, ids.ts, time.ts, env.ts)
└── tests/       (unit, integration, e2e)
```

---

## 7. Phase Plan

Each phase ends in a **working, deployable increment** with explicit exit criteria. Sizes are relative (S / M / L).

### Phase 1 — Foundation & App Shell · **M**
- `create-next-app` (TS, Tailwind v4, App Router, `src/`, Turbopack, Biome), pnpm, strict TS, env validation.
- `shadcn init` + the base components (button, input, field, select, sidebar, sheet, drawer, dialog, command, dropdown-menu, popover, tabs, table, badge, card, skeleton, tooltip, sonner, calendar).
- **AppShell:** sidebar (desktop) + bottom nav + "More" sheet (phone), driven by one nav config. Placeholder pages for every route, all translated.
- **i18n:** next-intl provider, `en.json`/`bn.json`, typed keys, key-parity CI check, language switcher, numerals preference, `format.ts` (money/number/date) with unit tests.
- Fonts: Noto Sans Bengali + Inter via `next/font`.
- MongoDB client singleton + index bootstrap script; `money.ts`, `qty.ts`, `ids.ts` utilities with tests.
- **Better Auth:** owner signup (creates store/org + defaults), login/logout, session.
- **Serwist:** manifest, icons, precached shell, offline fallback, install button.
- CI: typecheck, Biome, Vitest, i18n parity, "no dynamic app routes" check.
- **Exit:** the app installs on an Android phone; bn ⇄ en switches instantly, including Bangla digits and ৳; **airplane mode + reload → shell opens**.

### Phase 2 — Local Database & Sync Engine (the core) · **L**
- Dexie schema v1 (all tables), `storage.persist()`, storage-estimate display.
- Device registration (code A/B/C, device cookie), `deviceId` in `syncMeta`.
- `runCommand()` + command registry + outbox. Server: `syncSeq` counter, `appliedOps`, push handler with per-operation transactions.
- `/api/sync/push`, `/pull`, `/bootstrap`; the client sync manager (triggers, Web Locks leader, backoff, statuses, clock offset, 426 gate).
- **Sync badge** + `/sync` page (pending, failed, conflicts, last sync/attempt, device ID, storage, Sync Now, retry/discard failed).
- Cached session so the app opens offline after login (PIN comes in Phase 6).
- Proved end-to-end with the first entities: **categories + settings**.
- **Exit (automated):** a category created offline on device A appears on device B after reconnect. The network is cut **after server commit but before the response** → retry produces **exactly one** record. Flapping-network test passes. Restarting the browser keeps pending operations.

### Phase 3 — Products, Categories & Inventory Ledger · **M**
- Category CRUD; product CRUD (name/nameBn, SKU, barcode, category, unit, purchase/selling price, low-stock threshold, description, active).
- Master-data conflict handling (changed fields + `baseVersion`, field-level merge, price conflicts in `/sync`).
- **Search** (`normalizeSearch`, `*searchWords`, exact barcode/SKU); virtualized product list (cards on phone, table on desktop).
- Stock movements: opening stock (on product create), adjustment ("set to" → delta), damage, correction; inventory page, movement history per product, low-stock and negative-stock views.
- `serverStock + pendingDelta` model; audit entries for price change and stock adjustment.
- Dev seed script: 20k products with mixed Bangla/English names.
- **Exit:** search < 50 ms on a mid-range phone with 20k products; two devices adjusting the same product's stock offline converge to the correct sum; a price edited on both devices produces a resolvable conflict.

### Phase 4 — POS & Sales · **L**
- Cart store (Zustand, persisted to Dexie `drafts`), hold/resume sale.
- POS UI: phone (list + sticky checkout bar + drawer) and desktop (split + shortcuts); category chips; scanner-wedge barcode; camera barcode scanning.
- Line and cart discount (flat/%), custom price (permission-gated), qty steppers with unit decimals.
- Customer: default Walk-in, search, quick-add inline.
- Payment: cash with change calculation, partial, full due (customer required), methods Cash / bKash / Nagad / Rocket / Card / Bank (labels only, no gateway).
- **`sale.create`** command: sale + items + movements + payment + ledger + per-device invoice number, local and server sides.
- **Receipt:** print CSS for 58 mm / 80 mm thermal and A4, Bangla content, auto-print option; reprint from sale detail.
- Sales history (filters, virtualized) + sale detail; **`sale.void`** (reversal movements and ledger entries, permission-gated, audited).
- **Exit:** spec acceptance **Tests 1–4** pass for sales. A cash sale takes ≤ 3 taps on phone and is keyboard-only on desktop. Completing a sale shows no spinner, online or offline.

### Phase 5 — Customers, Suppliers, Purchases, Dues, Payments, Expenses, Returns · **L**
- Customers & suppliers CRUD + **statement view** (ledger with running balance, total purchases/paid/due).
- **Purchases:** supplier, invoice no., date, items, cost price (optionally updates product purchase price), discount, paid/due, method → stock-in movements + supplier ledger.
- **Payments:** due collection from customer, payment to supplier, history.
- **Expenses:** categories (Rent, Electricity, Salary, Transport, Internet, Maintenance, Food, Other), amount, method, date, notes; void.
- **Returns:** sale return (pick original sale locally or by online lookup, pick items/qty, restock toggle, cash refund or due credit); purchase return (stock-out + supplier ledger). Original invoices are never modified.
- **Exit:** for every party, `balance == Σ ledgerEntries` on both client and server (property-based test); the cross-device due-collection test passes.

### Phase 6 — Staff, Roles, Offline Unlock, Settings, Audit · **M**
- Owner creates staff (username + password), assigns role; permission matrix (spec §45), enforced in UI **and** on push.
- **PIN setup + "Who's working?" offline unlock**, user switching on a shared terminal, idle auto-lock, lockout policy.
- Device management (list, rename, revoke).
- Settings: store info, receipt (header/footer, paper size, show/hide fields), VAT (off / inclusive / exclusive %), low-stock default, language, numerals, timezone.
- Audit log viewer (filter by user/action/date).
- **Exit:** a cashier cannot see purchase price or profit; a full restart while offline → PIN unlock → can sell; a revoked device is locked out on next sync and its pending operations are preserved; a forged permission is rejected by the server.

### Phase 7 — Dashboard & Reports · **M**
- **Dashboard (local):** today's sales/profit/expenses, total due, purchases, low stock, recent transactions, 7/30-day sales chart, big POS button.
- **Reports (local, within data window):** daily/weekly/monthly/date-range sales, product-wise, category-wise, profit estimate (sale price − purchase cost at time of sale), expenses, purchases, customer due, supplier due, stock, low stock, stock movements, best sellers, sales by payment method.
- **Online historical reports** for ranges beyond the local window, using Mongo aggregation plus `dailySummaries`.
- Export CSV/JSON (generated in the browser as a download; no uploads).
- **Exit:** for the same date range, local and server report totals match (automated); reports render in Bangla without layout breaks.

### Phase 8 — Hardening & Launch · **M**
- Playwright suite automating **spec acceptance Tests 1–7** + chaos (dropped acks, flapping network, 3 devices, clock skew, storage-full simulation).
- Data retention and pruning (synced outbox, transactions outside window); Dexie migration tests v1→v2.
- Service worker update flow under real usage; install UX on Android/iOS/desktop.
- Performance pass: bundle budgets in CI, Lighthouse PWA, INP on a throttled low-end Android profile.
- Security pass: CSP, headers, rate limits, `storeId` scoping review, dependency audit.
- Deploy: Vercel (`bom1`) + Atlas Mumbai, backups, error monitoring (Sentry, optional), runbook.
- **Exit:** all acceptance tests green in CI; a full simulated "business day offline" (200 sales, 3 devices) syncs with zero duplicates and correct stock.

### Later (post-MVP backlog)
Bluetooth thermal printing from phones (ESC/POS with a canvas-rasterized Bangla receipt), SMS due reminders, product images, product variants and multi-unit (box ↔ pcs), multiple stores, Banglish/phonetic search (`dudh` → দুধ), customer loyalty, backup restore.

---

## 8. Testing Strategy

| Layer | Tool | What |
|---|---|---|
| Unit | Vitest | money/qty math, formatters (bn/en, lakh grouping, digits), `normalizeSearch`, Bangla digit parsing, invoice numbering, conflict merge |
| Command contract | Vitest + fake-indexeddb + mongodb-memory-server (replica set) | For each command: `applyLocal` and `applyServer` produce equivalent state; replay twice → identical (idempotency) |
| Sync engine | Vitest | Push/pull loop with injected faults: drop request, drop response after commit, 500s, partial batches, out-of-order pulls, crash between pages |
| Properties | fast-check | Random op sequences across N simulated devices → final stock = Σ movements, balances = Σ ledger, no duplicate IDs |
| E2E | Playwright | Spec Tests 1–7; `setOffline`; two/three browser contexts as devices; mobile viewport (Pixel/iPhone) and desktop runs |
| i18n | script + Playwright | Key parity; visual check of POS, receipt and reports in Bangla |
| Performance | Playwright + Lighthouse CI | Search latency with 20k products, INP on POS, bundle budget |

---

## 9. Assumptions & Open Questions

Defaults I'll use unless you say otherwise:

1. **Hosting:** Vercel + MongoDB Atlas, both in Mumbai. *(Alternative: a VPS with Docker if you prefer fixed cost.)*
2. **Login:** username/phone + password, no SMS OTP in the MVP.
3. **VAT:** included as an optional setting (off by default).
4. **Printers:** browser printing (USB/desktop thermal + A4) in the MVP; Bluetooth printing from phones in the post-MVP backlog.
5. **Loose items (kg/litre):** supported from the start via milli-unit quantities.
6. **Local history window:** 120 days of transactions per device (configurable).
7. **Single store** in the MVP, but `storeId` is on every record, so multi-store needs no schema change.

---

## 10. Implementation Notes (learned while building)

- **Precache URLs:** `@serwist/turbopack` globs `.next/server/app/*.html`, but Next serves those pages at `/login`, not `/login.html`. Precaching the `.html` URLs 404s and the whole service worker fails to install. `src/app/serwist/[path]/route.ts` rewrites them with a `manifestTransforms` entry. The Playwright offline test guards this.
- **English number grouping:** `en-BD` groups as `125,000`; shops in Bangladesh write `1,25,000`. English uses `en-IN` grouping with a leading ৳; Bangla uses `bn-BD`. Covered by unit tests in `src/lib/__tests__/format.test.ts`.
- **Local dev DB:** `pnpm db:dev` starts a persistent single-node MongoDB replica set (transactions need one). No MongoDB install needed.
- **Offline testing:** `pnpm exec playwright test` builds, starts the production server and drives the system Chrome (override with `PW_CHANNEL=msedge`). The Claude desktop browser pane does not support service workers, so it can't be used for offline checks.

### Phase 2 notes

- **Deviations from the plan:**
  - No separate `/api/sync/bootstrap`. A new device pulls from cursor 0 in pages, which is the same thing with one code path less. A transaction-history window parameter will be added in Phase 4 when sales exist.
  - Dexie schema v1 declares only the tables used so far (`categories`, `settings`, `outbox`, `syncMeta`). Later phases add tables with `db.version(n)`, which is non-destructive and avoids guessing indexes.
  - The categories screen was pulled forward from Phase 3 to serve as the proof vehicle for sync.
  - Operations are ordered by an auto-increment `seq` (not timestamps) so two operations created in the same millisecond can never swap.
- **Sync design as built:**
  - Each command has a shared definition (`src/commands/definitions.ts`: schemas and permission), a local handler (Dexie) and a server handler (Mongo). The compiler enforces that every command has both.
  - Idempotency record (`appliedOps`) is written in the same Mongo transaction as the change; a retry returns `duplicate`.
  - Every write bumps the store's `syncSeq` counter, so writers serialize and pull cursors never skip a write. Pull reads the counter first as a stable upper bound.
  - A batch halts at the first transient failure so a dependent edit can never run ahead of its create.
  - Server data arriving while the cashier has unsynced edits is merged with those edits replayed on top (`applyServerDocs`), so nothing vanishes.
  - The sync indicator never says "synced" until a sync has actually completed, and treats "server unreachable" as offline whatever `navigator.onLine` says.
- **Traps found by testing (all guarded by tests):**
  - `SerwistProvider` defaults `reloadOnOnline` to `true`, which reloads the page every time Wi-Fi reconnects, mid-sale in a shop. It is disabled; the sync engine handles reconnects without a reload. This caused 25% failures in a 40-run offline-navigation stress test and 0% after the fix.
  - ICU plurals need a number: passing a pre-formatted `"১"` printed "NaN". Plural messages take `count` (number) and `n` (formatted display value).
  - Better Auth's login rate limit (brute-force protection) is on in production builds and stores counters in the database. Only the e2e run turns it off, with an explicit `E2E_DISABLE_RATE_LIMIT=1`.

### Phase 3 notes

- **Deviations:** no separate `units` collection; the unit is a fixed list in `src/lib/units.ts` (each with how many decimals a quantity may have). Barcode/SKU uniqueness is checked on the device before saving (offline-safe); two devices can still create the same code at the same time, which is flagged to the user rather than rejected.
- **Stock model as built:** the displayed stock is the server's number with this device's unsynced movements replayed on top, derived from the outbox (`applyServerDocs`), so no separate `pendingDelta` field exists. The server changes stock only with `$inc` in the same transaction that writes the movement.
- **Search:** typed words are split exactly like indexed words; the index is queried for ids only, the id sets of all words are intersected, and records are read only for the survivors. 20,000 products stay under the test budget even in the slow fake-IndexedDB environment.
- **Traps found by testing (all guarded by tests):**
  - Zod `.partial()` keeps `.default()` values, so a one-field product edit would have been padded with defaults (prices 0, names empty) and wiped the record. Edit schemas are now built from validators without defaults.
  - The precache matched exact URLs, so `/products/view?id=…` was not available offline. The service worker now ignores query strings when matching precached pages.
  - A one-word search like "suga" loaded 2,000 full records just to sort them (2 s in the test environment); fixed by the id-intersection approach above.

### Phase 4 notes

- **Scope pulled in:** customers (list, add, edit, delete, due balance) and the money ledger were built here because a credit sale needs them; Phase 5 adds statements, collections and suppliers on top.
- **A sale is one operation touching many records** (the sale and its lines, one stock movement per line, each product's stock, the customer's balance and a ledger entry), applied in one Mongo transaction and in one Dexie transaction. Outbox entries index every record they touch (`entityIds`), so unsynced sales are replayed onto server data correctly.
- **Totals are never trusted from a device:** one shared function (`src/lib/sale-math.ts`) computes them on the screen, on the device database and on the server. A sale priced differently from the list price needs the `sale.priceOverride` permission, checked on the server.
- **Ids of everything a sale creates are derived from the sale id** (`<saleId>:m0`, `:l`, …) so the device and server agree and a retry can never create a second copy.
- **Invoice numbers** are `<device code>-<YYMM>-<4-digit counter>` using a counter only that device touches; two devices can never issue the same number without talking to each other.
- **Cancelling a sale** adds reversing movements and ledger entries and marks the sale cancelled; history is never edited or deleted.
- **Cart** lives in the device database (`drafts` table) via Zustand's async persist, so a reload or crash keeps it; held carts are persisted too.
- **Receipt** prints on 58 mm, 80 mm or A4 (print CSS hides everything else), in the current language, fully offline.
- **Traps found by testing:** `useMemo`-free money inputs lose a typed decimal point if controlled directly from the store (fixed with `MoneyField`); one-word searches can match thousands of products (id-set intersection, see Phase 3).

### Phase 5 notes

- **One ledger pattern for every kind of money owed.** Customers (what they owe us) and suppliers (what we owe them) keep a `balance` that only ever changes by `$inc` in the same transaction as a ledger entry, written by sales, purchases, payments and returns. `balance == Σ ledger entries` is checked in the server and cross-device tests.
- **New commands:** `supplier.*`, `purchase.create`, `payment.collect` / `payment.pay`, `expense.create` / `expense.void`, `saleReturn.create`, `purchaseReturn.create`. All are idempotent by operation id, and every record they create has an id derived from the document id (`<id>:m0`, `:l`, …).
- **Returns never touch the original invoice.** A return is its own document. The server checks what is still returnable against all earlier returns inside the transaction, so two devices returning the same goods at once leave exactly one accepted (tested with a race); the loser is marked failed on its device and its screen is restored.
- **Purchases** can update each product's purchase price (audited as a price change) and number themselves per device and month like invoices (`P-A-2610-0001`).
- **Refunds use the price the customer paid per unit** (line discounts and the cart-level discount are not apportioned across returned units); noted as a known simplification.
- **Customers and suppliers share one screen component** (`PartiesScreen`) and one detail component with a statement showing the running balance after every entry.
- **Timing tests now run on their own** (`pnpm test:perf`, part of `pnpm check`): run in parallel with database-heavy suites the numbers were noise.

### Phase 6 notes

- **Offline unlock.** PINs (4–6 digits) are hashed on the device (PBKDF2-SHA256, 310k rounds); the server stores only the hash and sends it to the store's devices via `GET /api/staff` (device cookie or session). A device can therefore check a PIN with no internet. Trade-off: anyone who can read a device's IndexedDB could brute-force a 4–6 digit PIN offline. The PIN is a counter convenience, not a vault: the account password still guards the server, and a revoked device or deactivated person is cut off on the next sync.
- **Lockout.** 4 free mistakes, then 30 s doubling (cap 15 min); from the 15th the PIN stops working until an online password sign-in. Counters live in `localUsers` and survive reloads.
- **Gate behaviour.** With no PINs in the store nothing changes. Once anyone has a PIN the counter asks "who is working?" on start and after `security.idleLockMinutes` (default 10). If the owner adds the first PIN mid-session they are not locked out (`asAccount`); a password sign-in also counts as unlocking. The staff screen warns when others have PINs and the owner does not.
- **Roles.** The active person's role drives nav, screens and what the receipt/forms show; the server still checks permission per operation from the actor id, reading role and active flag fresh from the database. Deactivating someone deletes their sessions and blocks new ones (`session.create.before` hook).
- **Staff, devices, audit** are online-only owner screens (a clear "needs internet" message offline). The owner can never be demoted or deactivated. Revoking a device refuses its pushes; its queued work stays on the device.
- **Settings** (`store.profile`, `receipt.footer`, `security.idleLockMinutes`) are synced settings; paper size is per device. JSON backup and CSV exports are generated in the browser (no uploads).
- **Deferred:** VAT/tax on receipts, per-staff sales targets.

### Phase 7 notes

- **One engine for both sides.** `src/reports/compute.ts` is plain functions over plain records. The device feeds it from IndexedDB (`src/reports/local.ts`), the server from MongoDB (`src/server/reports.ts`, `GET /api/reports/summary`). An automated test makes two devices and the server report identical totals for the same range, and checks the numbers by hand (sales, discount, return, cancelled sale ignored, expenses, purchases).
- **Definitions.** Sales count on the day made; cancelled sales are ignored; a sale return takes back its refund and its cost on the day of the return. Profit = net sales − cost of goods sold (cost is copied onto each sale line at sale time). Net profit = profit − expenses. Purchases are shown but not deducted again (their cost is already in profit once sold). A sale-level discount is spread over its lines so product profit adds up to sale profit.
- **Days are store days** (Asia/Dhaka), converted to UTC instants for queries. A bug here (an offset string compared against `Z` timestamps) hid behind a generous test range; there is now a tight-range test.
- **Dashboard** is live (Dexie live queries): today's sales, profit, expenses, purchases, customer and supplier dues, low/out of stock, recent sales, 7/30-day chart (plain CSS bars, no chart library). Profit is hidden without `profit.view`.
- **Reports**: sales, products (best sellers, by category), profit (expenses by type, purchases), stock (value at cost and retail, low only), dues, stock log; any range, CSV download for each. A source switch recomputes the summary tabs from the server (needs internet; falls back to the device if unreachable).
- **Not done:** pre-aggregated `dailySummaries` (the server recomputes from documents; the range is capped at 366 days). Worth adding if a store's history grows large.

### Phase 8 notes

- **Acceptance tests (spec §60).** Test 1 `offline-shell.spec.ts`, Test 2 `pos.spec.ts`, Tests 3–5 and 6–7 in `acceptance.spec.ts` (10 offline sales survive a "restart", then sync exactly once through a flapping connection; two devices selling while one is offline; Bangla names, search, receipt, reports and no sideways scrolling).
- **Simulated shop day** (`src/sync/__tests__/business-day.test.ts`): 3 devices, 200 seeded-random actions (sales, credit sales, cancellations, returns, adjustments, expenses, payments), phones dropping off, flaky network, dropped acknowledgements. Afterwards: no duplicate sales/invoices/movements, stock = Σ movements, balance = Σ ledger, identical data on every device. It found a real bug: a device that sold before the server gave it a short code numbered invoices from the *start* of its time-ordered id, so devices created together shared a prefix. The fallback now uses the random end of the id.
- **Storage.** Accepted operations older than 7 days are pruned (at most daily, after a sync); unsent, failed and conflicting work is never touched. Business records are not pruned: a store's whole history stays on the device until storage becomes a measured problem. Migration tests open a v1 database with the current code.
- **Security.** CSP (inline scripts allowed because pages are static and cached; no other origin may be loaded or contacted; no framing), permissions policy, HSTS in production; browser test checks headers, no violations on the main screens, and that private endpoints refuse anonymous callers. `pnpm audit --prod` clean (a transitive `browserslist` advisory fixed with an override).
- **Size budgets** (`budget.spec.ts`): first-load JS, compressed, measured at 340 KB (login) to 515 KB (desktop app pages); budgets sit a few percent above. Trimming is the next performance step if cheap phones feel slow.
- **Deploy**: `docs/DEPLOY.md`.
- **Not done:** Lighthouse/INP on a throttled device profile, error monitoring, real-device install checks on iOS/Android.

## Sprint 2

Plan: see the sprint plan (S1–S8). Notes per phase below.

### S1 notes — quick wins

- **Audit log is opt-in.** Store setting `audit.enabled` (default off). `writeAudit` checks it with one primary-key read inside the command's transaction, so no caller changed. Rows carry `recordedAt`; a TTL index (`auditLogs.recordedAt`, 7 days) deletes them automatically. The Settings card asks for confirmation before turning it on and explains the storage cost; the audit screen says when it is off. Server tests enable the flag explicitly; the seed turns it on.
- **Product rules.** A new product needs a name, a purchase price and a selling price, both above zero. The form (and `productCreateInput` / `productUpdateInput`) enforce it, but `productCreatePayload` stays lenient so operations queued by older app versions, and old products with a zero price, still sync. Selling below cost is warned about, not blocked. People who cannot see cost are not asked for it.
- **SKU.** Blank SKU → the device's next short number (`A0042`, per-device counter `skuSeq`, skipping numbers already used), created in the same transaction and queued in the payload so the server stores the same value. A SKU typed by hand is kept. The form shows what the next one will be.
- **Phone numbers** are optional but validated (6–15 digits, Bangla digits allowed) and stored as plain digits (`src/lib/phone.ts`).
- **Sidebar footer:** sync status link and the developer credit (name, website, WhatsApp), reachable on phones through "More".
- **Tests now run on their own server and database** (`playwright.config.ts`: port 3100, local MongoDB, database `store_app_e2e`), never the database in `.env.local` and never an open dev server.
- Lesson: a required-field star must not change the label text, or tests that find fields by exact label break; it is drawn with CSS.

### S2 notes — first-time setup and opening balances

- **Why a new command.** A due could only come from a sale, so a shop with existing customer dues could not start. `party.openingBalance` (owner and manager only, new permission `opening.manage`) writes a ledger entry (`refType: "opening"`, id `<id>:l`) and moves the party's balance, exactly like a payment in the other direction. Positive means a customer owes us / we owe a supplier; negative is an advance. It is idempotent on the ledger id (a retry under a new operation id changes nothing), has an overlay in `applyServerDocs` so a pull cannot hide it before it syncs, and is never read by `summarize()`: it appears in dues but never in sales, profit or purchases (tested on devices and server).
- **Setup wizard** at `/settings/setup` (owner): shop details, then products, customers, suppliers. Rows are typed or pasted from Excel / Google Sheets (`src/lib/paste-table.ts`; a copied header row is detected and dropped; no file is picked or uploaded). Each row is checked as it is typed (`src/setup/rows.ts`): required fields, positive prices, units (code or Bangla name), decimals allowed for the unit, phone format, and duplicates both inside the list and against what the shop already has, so the same list can be pasted twice safely. Saving uses the normal commands in order (category.create for new category names, product.create with opening stock and an automatic SKU, customer/supplier create then `party.openingBalance`), with a progress bar, and works in either data mode. If saving stops midway, the unsaved rows stay in the list.
- **Entry points.** New owners are sent to the wizard after sign-up (the sign-up page and the auth layout now agree on this; before, two redirects raced). The dashboard reminds owners until they finish or skip (`setup.completedAt`). Settings has "Import existing data". Adding one customer or supplier also offers an optional "previous due / payable" field.
- **Seed:** the demo shop now has previous balances and is marked as set up.

### S3 notes — the foundation for online mode

- **One definition of "what a search matches"** (`src/lib/search-fields.ts`): products by name, Bangla name, SKU, barcode; customers/suppliers by name and phone; sales by invoice number (whole, in parts, and without leading zeros: "A-2610-0042" is found by "42"), buyer name and buyer phone; purchases by our number, the supplier's invoice and the supplier. Device and server both store the result with each record (`searchWords`, plus `nameKey` for a stable A-Z order) and never send it over the wire (`toWire` strips it; devices recompute).
- **Device:** Dexie v6 adds the indexes and an upgrade that fills the fields for what is already stored (tested from a real v5 database). Sales now remember the buyer's phone (`customerPhone`), copied from the customer when the sale is made.
- **Server:** master data (`derive` hook), products, sales and purchases write the fields; indexes `{storeId, searchWords}`, `{storeId, nameKey, _id}`, `{storeId, invoiceNo}`, `{storeId, status, createdAt}`, `{storeId, sku|barcode}`. `pnpm db:backfill-search` fills them for records saved before this (idempotent, does not touch `syncSeq`, so devices re-download nothing). **Run it once after deploying.**
- **Shared list rules** (`src/data/spec.ts`): zod params per list (search, filters, sort) plus reference `matches` / `compare` / `referenceList`. Sorting breaks ties by id so pages and devices agree. S4 and S5 implement these on MongoDB and Dexie and are tested against this reference.
- **Data mode** (`src/data/mode.ts`): per device, kept in `syncMeta` and mirrored to localStorage for the first paint. A device that already downloaded data or has queued changes stays offline (nothing stranded by an update); only a new device starts online. Behaviour does not change until S5/S6 use it.
- **Server-verified actor** (`src/server/actor.ts`, `POST /api/actor/unlock`, `/lock`): online, the server checks the PIN (same wrong-PIN waiting rules, kept on the server per device and person) and issues a signed, device-bound `sa_actor` cookie. `requireActor` (used by the S4 endpoints) takes the actor only from it; in a shop with PINs, no unlock means no action; in a shop without, the signed-in account acts. Offline PIN checking stays on the device (documented limitation).

### S4 notes — the server side of online mode

- **Reading.** `GET /api/data/<list>` (search, filters, sort, keyset paging with a cursor that is refused if it belongs to a different search), `/api/data/<list>/<id>` (a sale with its lines and returns, a person with their statement, a product with its stock history), `/api/data/<list>/totals` (header numbers over everything that matches, not one page), `/api/data/products/lookup?code=` (barcode/SKU), `/api/reports/stock`, `/api/sync/head` (one number: cheap change detection), plus categories and settings in full. `src/server/data/query.ts` writes the list rules of `src/data/spec.ts` as MongoDB queries; a test runs 70 different questions through it and through the plain reference rules, page by page and with different page sizes, and requires the same records in the same order (English, Bangla, Bangla digits, ties, deleted and inactive records, dates around midnight in Dhaka, another shop's data, stock levels). A record added mid-scroll never repeats or skips what the person already passed.
- **What a person may see.** Same rules as the menu (suppliers and purchases need `purchase.manage`, expenses `expense.manage`, returns `sale.void`; products, customers and sales are open). Purchase prices and the cost of sold goods are removed on the server for anyone without `purchasePrice.view`, so a cashier's browser never receives them online. (Offline mode still downloads whole records; documented.)
- **Who is acting** is decided by `requireActor`: the device cookie names the shop; in a shop that uses PINs the person must have unlocked (signed `sa_actor` cookie) or gets `PIN_REQUIRED`; in a shop without PINs the signed-in account acts. An owner without a PIN in a shop that uses PINs cannot act online until they set one (the staff screen already warns about this).
- **Writing.** `POST /api/commands {operationId, type, input, baseVersion?}`. The browser sends only what the person did; the server builds the payload inside the same transaction as the change (`preparePayload`): document numbers from per-shop counters (`2610-00042`, `P-…`, `R-…`, `PR-…`, SKU `00042`; a different shape from device numbers such as `A-2610-0042`, so the two can never collide), the cost and the listed price of each item from the shop's own product record (so a cashier cannot hide a price change by claiming the listed price was what they charged, nor see cost), the buyer's name and phone, what a cancelled sale touched, and a return's refund from the original invoice (not from the browser). Edits need `baseVersion`; a price changed meanwhile by someone else is reported as a conflict. Retrying with the same `operationId` returns the same answer and the same number. A refused action (return too large, no permission) does not use up a number: the transaction is aborted but the reason is still reported.
- **Not yet used by the screens:** S5 rewires the screens to these endpoints; until then the app behaves as before.
- Flaky test fixed: the "return goods" e2e navigated away the instant it clicked confirm, which could cut off the save; it now waits for the dialog to close.

### S5 notes — the screens use the data layer

- **One way to read and write.** Screens no longer touch the device database or the sync queue. They use `src/data/hooks.ts`: `useList` (search, filters, sort, "load more"), `useTotals` (header numbers over everything that matches), `useRecord`, `useProductLookup`, `useCategories` and `useCommand`. In offline mode these read the device (`src/data/local.ts`, the same rules as the server, checked against the same fixture in `src/data/__tests__/local.test.ts`); in online mode they ask the server through TanStack Query (`src/data/online.ts`, `provider.tsx`). A Biome rule (`noRestrictedImports`) stops `src/components` and `src/app` importing `dexie-react-hooks` or `@/db/local/db`; the lock, sync, settings, staff PIN list, setup grid and SKU preview are exempt on purpose.
- **Lists.** Every list screen (products, inventory, customers, suppliers, sales, purchases, expenses, payments, returns, categories) uses the same `ListToolbar` (search box, filters, sort, active-filter chips, clear) and `LoadMore`/virtual list. Sales search by invoice number, buyer name or phone. Header totals come from `useTotals`, so they cover the whole filtered set, not one page.
- **Online writes** go to `POST /api/commands` and reject with a `DataError` (`OFFLINE`, `FORBIDDEN`, `CONFLICT`, `PIN_REQUIRED`, ...). Edits and deletes send the `baseVersion` of what the person was looking at. After a write, the lists refresh.
- **POS (online safety).** The cart remembers the ids of a sale being sent. A retry of the same cart (after a timeout or lost connection) reuses the sale and operation ids, so the server answers with the same sale and number; a changed cart gets new ids. With no connection, nothing is saved, the cart is kept and the message suggests Work offline.
- **Reports and dashboard** work in both modes: online they ask the server for the summary, the stock header, the dues lists (customers and suppliers owing, biggest first, with totals over everyone) and the movements; the "this device / the server" picker is shown only offline, where the device has all the data. Stock movements carry the product name from both the device and the server.
- **Settings** are read from the device in both modes (online mode refreshes them every sync cycle) and saved on the server when online.
- **Online PIN flow.** Online, the lock screen asks the server to check the PIN (the server then knows who is working). If the server answers "PIN required" (for example an owner who just signed in with the password in a shop that uses PINs), the counter locks and asks for a PIN. Without a connection, the device checks the PIN as before.
- **First request before registration.** A brand-new device could ask the server before it had been registered (`DEVICE_UNKNOWN`); online requests now register the device and ask again. (The sync manager and screens share one registration, `src/sync/register-device.ts`.)
- **Tests.** The Playwright suite runs in either mode (`E2E_MODE=online`); specs about the offline queue are skipped online, and two assert the mode's own behaviour (no SKU preview, no report-source picker online). New: sales search / filter / sort e2e.

### S6 notes — Work offline

- **The switch** (sidebar footer and Sync screen; `src/components/sync/work-offline.tsx`, `mode-card.tsx`). New devices first started online; after the pilot decision of 2026-10-02 they start **offline** (`DEFAULT_FOR_NEW_DEVICES`). Off: screens ask the server, always up to date, needs internet. On: the device downloads the whole shop first and then works with no internet. The owner and managers (`mode.switch`) can change it; a cashier sees it disabled. A device that already downloaded data or has queued changes stays offline after the update (nothing stranded).
- **Turning on** needs internet. It asks how much there is (`/api/sync/head` minus this device's position), checks free space, then downloads in pages of 1000 with a progress bar. Each page is saved together with the position reached, so a stopped download carries on where it stopped. The mode only flips when the download is complete and the app's own files are saved by the service worker (`navigator.serviceWorker.ready`); then the browser is asked to keep the data (`storage.persist()`) and the page reloads.
- **Turning off** first sends everything waiting on the device. If something is still unsent, or needs a decision (refused or conflicting), it does not switch and points to the Sync screen, so nothing is left behind on a device that no longer syncs it. The shop's copy stays on the device so switching back is fast; "Remove offline data" (online mode, nothing unsent) frees the space, and the next "Work offline" downloads again.
- **Readiness** (Sync screen, offline mode): data on the device, app files saved, data protected from clearing, plus an iPhone "Add to Home Screen" hint. In offline mode the app shows a "Preparing offline mode" screen with progress until the first download is done, so no screen says "nothing here" for something that is only not yet downloaded (`OfflineGate`).
- **Tabs.** A mode change is announced on a `BroadcastChannel`; the device's other tabs reload into it.
- **Online with no internet.** A banner says saving is paused and the cart is safe (and links to Work offline for those who can use it). Nothing is saved; a sale in progress keeps its cart and its ids, so when the connection returns the same sale goes through once (tested).
- **Order.** In online mode, anything still queued from before is sent before a new change, so changes reach the shop in the order they happened; if the queue cannot be sent, nothing new is saved either.
- **Tests.** The app's default for a new device is online; the Playwright suite starts devices offline by default (the way most specs are written) and online with `E2E_MODE=online`. `mode-switch.spec.ts` starts from the app's own default: new device online → Work offline downloads → no internet but the shop is all there → back online → remove offline data; a second tab follows; a cashier cannot change it; online with no internet keeps the cart and rings the sale up once.

### S7 notes — reports and dashboard cards

- **Headline cards** (`src/components/reports/kpi-card.tsx`, `overview.tsx`): net sales, profit with its margin, sales made with the average bill, expenses, profit after expenses, credit given (with what was received). Each shows how it moved against the same number of days just before (`src/reports/compare.ts`: zero before reads "New", a smaller loss reads as up, rounding to nothing reads "no change"; green means good news, so more expenses is red) and, where it makes sense, a day-by-day trend line in plain SVG. Below: how people paid (a split bar) and the top five products. The dashboard uses the same cards against yesterday. All earlier test ids are kept. No chart library was added.

### S8 notes — hardening

- **Load test** (`pnpm db:loadtest`, see `docs/DEPLOY.md` section 12). It found real problems the unit tests could not: sorting 200,000 sales for "newest first" took 4 s (no index could serve the sort, because ties were broken by id ascending while the date went descending); the low-stock filter scanned every product (0.7 s); searching sales by buyer name was slow because of how MongoDB planned two prefix conditions (0.4 s); the stock value report pulled every product into the server (0.45 s); the 30-day report took 7 s.
- **Fixes.** Ties between equal rows now break by id *in the direction of the sort* (device and server, one shared rule, tested), so one index per sort order serves it both ways; there is now an index for every sort of every list. "Low stock" is bounded by the shop's largest threshold (one index lookup) so an index can narrow it. Search words are written as one `$elemMatch` condition each, with the most selective (a number) first, and a sales or purchases search with a number starts from the search-word index (a hint; on products it made things slower, so only sales and purchases use it). The stock value is added up inside the database. The sales report reads only the fields it needs and is kept in memory until the shop's change counter moves. After: every list, total and search is under 100 ms (a sale found by buyer name and number: about 235 ms), except the 7-day and 30-day reports of a shop with 2,200 sales a day (about 0.4 s and 1.3 s).
- **Reports use the person who unlocked the device** (`requireActor`) like every other online read; before, the summary route trusted the signed-in account's role, so a cashier using the owner's signed-in phone could have fetched profit by calling it directly.
- **Rate limit** per device on the online endpoints (`src/server/rate-limit.ts`).
- **Bundle budgets** re-measured: login 349 KB, app pages 494-531 KB; each budget is the largest plus about 20 KB.
- **Online shop-day test** (`tests/e2e/online-day.spec.ts`): from the app's own default (online), buy stock, pay the supplier, sell for cash and on credit, collect a due, add an expense, take a return, and check stock, invoice numbers and the reports.
- **Known limits** (also in DEPLOY): offline PIN checking trusts the device; the rate limit is per server process; the longest reports of very large shops take over a second.

## Sprint 3 (branch `dev`)

Goal: make online mode fast, keep shops strictly apart, make backup simple, and be ready to run for 100-300 shops.

### A. Server speed
- **The cause.** `ensureSyncIndexes` kept "done" in a `WeakSet<Db>`, but the driver builds a new `Db` on every `client.db()`, so about 57 index commands ran on every request, up to three times (`requireActor`, the route, `viewerFor`) through a pool of 10. The Db handle and the deps are now built once per process (`src/db/server/mongo.ts`, `src/server/deps.ts`); `pnpm db:indexes` and `SKIP_RUNTIME_INDEXES=1` move index creation to deploy time. Pool 20, `maxIdleTimeMS`, `attachDatabasePool` on Vercel; `vercel.json` pins `bom1` (the function was running in `iad1`, an ocean away from the database).
- **Caches** (`src/server/cache.ts`, 10-30 s, per process, cleared by this server's own staff, device and shop changes): the device record, PIN use, a person's role, the time zone, the shop's status. `lastSeenAt` is written at most every 5 minutes.
- **Fewer round trips.** A list asks its exact-code query beside the page; a record asks its related rows beside it; a lookup is one query. A sale reuses what prepare read (`ctx.scratch`), and several stock updates are one bulk write: about 15 commands down to 11, and no longer growing with the cart. A budget test (`request-budget.test.ts`, driver command monitoring) fails if a request costs more.
- Save responses no longer carry purchase prices or line costs to people who may not see them (`hideCostInChanges`), and return the shop's `head`.

### B. A browser that does less
- After a save the returned records go into the query cache and only the lists, totals and reports they belong to are marked out of date, without waiting (`src/data/cache-sync.ts`). Before, every write waited for every active query to refetch (every loaded page, one after another), and the minute poll then refetched everything again because the device's own save had moved the change counter (`src/data/head.ts` now tells a person's own save from someone else's).
- One head poll feeds the rest: settings are fetched only when the shop changed, staff every 5 minutes (a minute-long cycle used to download every PIN hash); no refetch on tab focus; searches are cancelled when superseded; POS search is debounced and Enter reuses the exact match already in the list; the dashboard is one request instead of seven (`/api/dashboard`); the stock header loads only on its tab; rows prefetch their record on hover. A false OFFLINE error when a sync was already running is fixed.
- A used SKU or barcode is refused inside the save itself (`DUPLICATE_SKU`, `DUPLICATE_BARCODE`), so the product form no longer asks twice first.

### C. Isolation and safety
- The tenant isolation test (see DEPLOY section 15). It found: a stock-adjust retry could return another shop's movement record if the ids matched; an online sale could carry another shop's product or customer id as a reference. Both closed. A product deleted a moment ago still sells; one that is not in the shop at all does not.
- Unique partial indexes for SKU and barcode (live products only); a clash from an offline device is a clear "failed" item on the Sync screen, never an endless retry. `pnpm db:check-duplicates`. (Invoice and purchase numbers are not made unique in the database: a clash there would reject a real sale; online numbers come from per-shop counters inside the transaction.)
- Shop suspension (`stores.status`), enforced for devices, sign-ins and sessions; the app shows who to contact. A per-device rate limit on the sync, settings and device routes. `BETTER_AUTH_URL` required in production. Better Auth's session collection gets its indexes and a TTL.

### D. Backup and restore of one shop
`src/server/shop-export.ts`, `pnpm shop:export` / `shop:restore`: streamed, checksummed, refuses any file that holds another shop's record, never writes before the whole file verifies, round-trip and refusal cases tested. Applied-operation records now expire after 45 days (changed in place with `collMod`).

### E. Errors and logs
Sentry on the server only (errors only, scrubbed), browser crashes reported through `/api/client-error` so the page stays light and the security policy unchanged; `error.tsx` and `global-error.tsx`; one structured JSON log line per server error with a request id; `/api/health` shows version, database ping and whether reporting is on.

### F. Operator panel
`/admin` (own sign-in, English only): shops list with search, create a shop, pause or resume, reset an owner's password, download a backup, activity log (`platformAudit`, kept). `pnpm admin:create` is the only way to make an operator. Tested end to end (`tests/e2e/admin.spec.ts`).

### G. Verify on the real deployment
`pnpm latency` (deployed URL, from Dhaka). Not yet measured against the deployed preview: that needs the `dev` branch deployed with the `bom1` setting.
