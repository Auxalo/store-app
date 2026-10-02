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
| `BETTER_AUTH_URL` | yes in production | The public origin, e.g. `https://app.example.com`. |

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
