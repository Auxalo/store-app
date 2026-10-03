# Deploying and running the store app

A short runbook. The app is one Next.js project (pages plus `/api` routes) and one MongoDB database. There is no other server.

## 1. What you need

| Piece | Recommendation | Notes |
|---|---|---|
| Hosting | Vercel (region `bom1`, Mumbai) or any Node 20+ host | Closest region to Bangladesh. The app is mostly static pages; only `/api/*` runs code. |
| Database | MongoDB Atlas, M10 or larger, region Mumbai (`ap-south-1`) | Must be a **replica set** (Atlas always is). The sync engine uses transactions. |
| Domain | HTTPS only | Service workers, install-to-home-screen and secure cookies all need HTTPS. |

## 2. Environment variables

| Name | Required | Value |
|---|---|---|
| `MONGODB_URI` | yes | Atlas connection string for a user that can read and write the one database. |
| `MONGODB_DB` | no | Database name (default `store_app`). |
| `BETTER_AUTH_SECRET` | yes | 32+ random characters (`openssl rand -base64 32`). Changing it signs everyone out. |
| `BETTER_AUTH_URL` | yes in production | The public origin, e.g. `https://app.example.com`. The server refuses to start answering without it (Vercel preview deployments may leave it out). Requests from the very address they are sent to are always accepted, so opening the app on another address (a preview or alias) still signs out correctly. |
| `SENTRY_DSN` | no | Turns on error reporting to Sentry (see section 15). Nothing is sent without it. |
| `SKIP_RUNTIME_INDEXES` | no | Set to `1` after running `pnpm db:indexes` as part of a deploy: servers then skip the start-up index check. |
| `RATE_LIMIT_READ_PER_MIN`, `RATE_LIMIT_WRITE_PER_MIN` | no | Per-device request limits (default 600 and 180). |
| `NEXT_PUBLIC_SIGNUP_ENABLED` | no | `1` at build time opens shop sign-up (section 13). |

Never set `E2E_DISABLE_RATE_LIMIT` in production: it exists only for the automated browser tests.

## 3. First deploy

1. Create the Atlas cluster and a database user. Allow your host's IPs (Vercel: allow `0.0.0.0/0` and rely on the user password, or use Atlas private networking on a paid plan).
2. Set the variables above on the host.
3. `pnpm install --frozen-lockfile && pnpm build`, then deploy (Vercel does this for you).
4. Open the site, create the first store (sign up). The needed indexes are created automatically on first use (about 40; one for every way a list can be sorted, so any list opens straight from an index even with hundreds of thousands of rows. The first start after an update that adds indexes builds them, which takes a moment on a big shop).
4a. **Existing shop updating from an earlier version:** run `pnpm db:backfill-search` once (it fills the search fields that the new lists use; safe to repeat; devices re-download nothing).
5. On a phone, open the site and use "Install app" (Android/Chrome) or "Add to Home Screen" (iPhone/Safari).

## 4. Backups

- Turn on Atlas **continuous cloud backup** (point-in-time restore). It is the only copy that matters: devices hold only their own recent working data.
- Test a restore once into a scratch cluster before relying on it.
- Devices can also download a JSON backup of their local data (Settings → Backup and export). Treat it as a convenience, not the backup.

## 5. Updating the app

- Deploying a new version is safe at any time. Open apps pick up the new version on their next launch and show an "update available" notice; nothing is lost because unsent work stays in the on-device queue.
- Database changes: the server accepts operations from older app versions (each operation carries a schema version). If you ever need to break compatibility, raise the minimum supported version; older apps then show "please update" and keep their unsent work.
- On-device storage migrations run automatically when the new version opens (they are covered by tests).

## 6. Day-to-day checks

- **A phone says "sync issue":** open Sync status. Rejected items are listed with a plain reason and can be retried or discarded. Unsent work is never deleted automatically.
- **A device is lost or stolen:** Settings → Devices → cut it off, then deactivate any staff who used it (Settings → Staff). The owner's password can be changed at the next sign-in. Anything still unsent on that device stays there.
- **A cashier forgot their PIN:** the owner sets a new one (Settings → Staff → key icon). Needs internet.
- **Too many wrong PINs:** the counter makes the person wait, and after 15 mistakes asks for the password (online).

## 7. Security notes

- Responses carry a Content Security Policy, `X-Frame-Options: DENY`, `nosniff`, a strict referrer policy, a permissions policy and (in production) HSTS. A browser test checks the headers and that the app runs under them.
- Every server action is checked against the signed-in person's role, read fresh from the database; every query is scoped to the person's store.
- Passwords are handled by Better Auth. PINs are hashed on the device (PBKDF2, 310k rounds) and only the hash is stored on the server. A PIN is a counter convenience, not a replacement for the password (see `docs/PLAN.md`, Phase 6 notes).
- Run `pnpm audit --prod` before each release; it is clean as of 2026-10-02.
- **Offline mode trusts the device.** Offline, a PIN is checked on the device and the server cannot tell who actually pressed the buttons (it re-checks the role of the person named on each change, but not that they were the one holding the phone). Online mode does not have this gap: the server checks the PIN and signs who is working. For a shop where this matters (a cashier with access to the owner's phone), prefer online mode, or keep the phone's screen lock on.
- The online endpoints limit each device to 600 reads and 180 writes a minute (`RATE_LIMIT_READ_PER_MIN`, `RATE_LIMIT_WRITE_PER_MIN`) so a stuck client cannot flood the database. The count is kept in each server process, so it is a safety net, not a security boundary: put rate limiting in the proxy in front for that.
- **Audit log.** Off by default (it can take a lot of space). When an owner turns it on, entries are kept for 7 days and MongoDB deletes older ones on its own (a TTL index, within about a minute of expiry).

## 8. Quality gates (run before every release)

```bash
pnpm check                 # lint, types, translations, unit + integration + performance tests
npx playwright test        # browser tests: offline, sync, POS, staff, reports, security, size budgets
```

`pnpm check` includes a simulated shop day (3 devices, 200 random actions, flapping network) that must end with no duplicates and books that balance. Set `SEED=<number>` to replay a particular day.

## 9. Not included (ideas for later)

- Error monitoring (e.g. Sentry) and uptime alerts.
- Lighthouse/INP runs on a throttled low-end phone profile in CI.
- Pre-aggregated daily summaries for very large histories.
- VAT/tax on receipts, thermal printer drivers beyond the browser's print dialog.

## 10. Demo data (development only)

`pnpm db:seed` builds a demo shop ("রহিম জেনারেল স্টোর") with a month of history: 33 products in Bangla and English, 8 customers, 4 suppliers, about 700 sales, purchases on credit, expenses, returns, cancellations and a monthly stock count (a few items are low or out of stock). It runs the app's own commands and sync code, so everything is exactly what the app would have produced. Sign in as `demo`, `manager` or `cashier` (password `demo1234`). `pnpm db:seed --reset` deletes and rebuilds it. It needs the database from `pnpm db:dev` (or whatever `MONGODB_URI` points to): never run it against a real shop's database.

## 11. Online and offline mode (which to recommend)

Every device chooses for itself with the **Work offline** switch (Sync screen and sidebar; owner and managers can change it).

- **Online** is best for a shop with steady internet and a large catalogue: nothing to download, search and totals come from the database, and every screen is always current. It needs internet to save. With no connection the app says saving is paused and keeps the cart.
- **Offline (the default for a new device)** is for a shop whose internet drops: the device downloads the whole shop once (with a progress bar; it needs internet that first time and some free space, roughly 2 KB per change in the shop's history) and then works with no internet at all, sending changes when the connection returns. Install the app to the home screen on phones, especially iPhone, so the browser does not clear the data.
- In a shop where staff use PINs, online mode asks the server to check the PIN. **Set a PIN for the owner too**, or the owner cannot act online once PINs exist.
- Updating the app is safe for existing devices: a device that already downloaded the shop (or has changes waiting) stays offline.

## 12. How big a shop it handles

`pnpm db:loadtest` (with `MONGODB_DB` set to a scratch database whose name contains "load") builds a shop of 50,000 products and 200,000 sales over 90 days and times what the online screens ask. On a developer laptop (MongoDB on the same machine), 95th percentile:

| Question | Time |
| --- | --- |
| Any product, customer or sale list page, with search by word, number, barcode, phone or Bangla; any sort | under 100 ms (a sale found by buyer name and number: about 235 ms) |
| Header totals for a list (whole filtered set) | under 100 ms |
| Stock value and low/out counts | about 170 ms |
| Report for today | about 60 ms |
| Report for 7 days (about 15,000 sales) | about 400 ms |
| Report for 30 days (about 66,000 sales) | about 1.3 s |

The long reports are worked out from every sale in the range, so they grow with how many sales there are: a shop that makes 300 sales a day sees a 30-day report in roughly 0.2 s. The server keeps each report until something changes in the shop, so opening it again costs one tiny read. In offline mode reports are computed on the device and need no server.

## 13. Opening and closing shop creation

For now new shops cannot sign themselves up. The create-shop page is there, but pressing "Create shop" shows who to contact (the developer's name, website and WhatsApp, from `src/config/developer.ts`), and the server refuses `POST /api/stores` with 403 `SIGNUP_CLOSED`. To open it again, set `NEXT_PUBLIC_SIGNUP_ENABLED=1` **at build time** (pages are built ahead, so the page must be rebuilt) and redeploy. The test server and `pnpm db:seed` are not affected by the closed state (the tests build with it open; the seed does not use the endpoint).

To create a shop yourself while sign-up is closed, run `pnpm shop:create` on a computer that has the project and the database settings in `.env.local`. It asks for the shop name, the owner's name, the username to sign in with and a password (typed without showing), shows which database it will write to, and asks you to type "yes". The owner then signs in with that username and password and is guided through first-time setup. A username that is already used is refused without leaving anything half-made.

## 14. Backup and restore of one shop

Atlas keeps the whole cluster safe (continuous backup on M10 and up; daily snapshots on the smaller tiers). To get **one shop** back without touching the other 299, use the shop backup:

- **Make a backup:** `pnpm shop:export --store <shop id or the owner's username> [--out file]`, or "Download backup" on the shop's page in the operator panel (`/admin`). It is one text file with that shop's records and its people, a checksum, and nothing of any other shop. It includes password hashes so people can sign in after a restore: keep it as private as a password file. Every download from the panel is logged.
- **Check a file:** `pnpm shop:restore <file> --dry-run` reads the whole file and says what it holds. It checks the shape, the checksum, the counts, and that every record belongs to the one shop the file names. A changed, cut-off or foreign file is refused before anything is written.
- **Restore:** `pnpm shop:restore <file>` (the shop must not exist) or `pnpm shop:restore <file> --replace` (deletes that shop's current records first, only that shop's, then restores). It asks you to type "yes". A restore that stops half way leaves no shop record; run it again with `--replace`.
- **"Put this shop back as it was yesterday":** restore Atlas's snapshot into a temporary cluster, point `.env.local` at it, run `pnpm shop:export --store ...`, point `.env.local` back at production, run `pnpm shop:restore <file> --replace`. Do this once a month on a test shop so the first time is not during an emergency.
- Usernames are unique across all shops: a restore is refused if a person's username now belongs to someone else.

## 15. Keeping the shops separate, and knowing when something breaks

- **Shops cannot see each other.** Every query names the shop. An automated test (`src/server/__tests__/tenant-isolation.test.ts`) records every database command made for one shop while another shop has data, fails if one is not tied to the shop, and tries to reach the other shop's records with their real ids through every kind of save. Run it before every release; it found two gaps while it was being written (both fixed).
- **SKUs and barcodes** belong to one live product per shop, enforced by the database (a unique index per shop), not only by the form. Before the first deploy of this version on an existing database, run `pnpm db:check-duplicates`; fix any it lists; then `pnpm db:indexes`.
- **Pausing a shop.** In the operator panel, "Pause shop" refuses that shop's devices and sign-ins (403 SHOP_SUSPENDED) and its screens show who to contact; nothing is deleted and it all returns on "Resume". The server you pause on obeys at once; others within about 10 seconds.
- **Operator accounts.** `pnpm admin:create` makes one (it belongs to no shop; no shop's data is reachable with it). Sign in at `/admin`. The panel lists shops, creates a shop, pauses or resumes one, resets an owner's password, downloads a backup, and shows what operators did (kept forever). The operator flag is read from the database on every request and can be set only by the command above.
- **Errors.** Set `SENTRY_DSN` to get an alert when something breaks. Errors only: no performance traces, no request bodies, cookies or headers, and long numbers (phones, amounts) are blanked. Each report is tagged with the route, shop id, device id, app version and a request id, which also appears in the server's one-line JSON log of the failure. Browser crashes are sent through the server (`/api/client-error`) so the page does not carry Sentry's large browser library. `/api/health` shows the app version, the database round-trip time and whether error reporting is on.
- **Region.** `vercel.json` pins the functions to `bom1` (Mumbai), next to an Atlas cluster in `ap-south-1`. After changing region, check Vercel → Settings → Functions. `pnpm latency --url https://your-site --user <username> --password <password> [--write]` times the main online calls from wherever you run it (run it from Dhaka). Targets: reads under 300 ms, a save under 600 ms.
- **Storage.** Applied-operation records now live 45 days (they were 180 and held a full copy of every changed record); the audit log keeps 7 days when switched on; Better Auth's sessions expire on their own.

## 16. Billing (bKash / Nagad, checked by hand)

There is no payment gateway. A shop sends money with bKash or Nagad **Send Money** to the number in the operator settings (01772998823 by default), types the transaction id (TrxID) on its Billing page, and the operator checks it arrived and approves it.

- **Modes per shop.** *Off*: no billing anywhere (every shop created before billing existed). *Free*: the shop never pays; its sidebar says "Free plan". *Paid*: trial (14 days by default for new shops) or a paid period, then **ending soon** (yellow banner, 7 days before), **overdue** (red banner with the lock date, 3 grace days by default), then **locked**.
- **Locked.** People can still sign in, unlock with their PIN and sync (nothing typed on a device is lost), but every screen goes to the Billing page, and the server refuses the shop's data and saves (402 BILLING_DUE). An owner or manager can pay from there; a cashier is told to ask the owner. A device that is offline locks itself on the right day too (it remembers the dates from its last contact and the server's clock).
- **Sending a payment** opens a locked shop for 48 hours (once per period) while the operator checks it. A transaction id is accepted once, by any shop. At most 3 payments wait at a time.
- **Operator panel** (`/admin`): *Overview* (payments to check, money collected this and last month, expected monthly income, shops by state, and lists of shops locked, overdue, ending soon or quiet for 14 days); *Shops* (filter by state or paused, search by name, owner or phone, sort by end date); *Payments* (the queue to approve or reject, with a reason the shop sees; history by month; CSV for your accounts); *Activity*; *Settings* (plans and prices, payment numbers, how new shops start, trial, grace and reminder days, hours a locked shop opens after paying).
- **One shop** (`/admin/shop`): *Billing* tab to switch off / free / paid, choose its plan, give it an agreed price or its own grace days, set the end date, give extra days, record a cash payment, and approve or reject its payments. Every change is in the activity log.
- **Renewals** continue from the old end date if the shop pays before it locks, and start on the approval day if it was locked. A month keeps the day of the month (Jan 31 -> Feb 28 -> Mar 31). Days end at midnight, Dhaka time.
- **The example plan prices** (৳500 / ৳2,700 / ৳5,000) are placeholders: set yours in *Settings* before turning billing on for anyone.
- **Turning billing on for an existing shop**: its Billing tab -> *Paid* gives it the trial first; or set an end date.
- Billing lives on the shop's own record, which only the operator changes (never in the shop's settings, which the shop can write). Restoring a shop from a backup keeps its current billing and pause.
