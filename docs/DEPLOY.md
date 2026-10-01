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
4. Open the site, create the first store (sign up). The needed indexes are created automatically on first use.
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
