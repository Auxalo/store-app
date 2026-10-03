// pnpm latency --url https://your-site --user <username> --password <password> [--runs 15] [--write]
//
// Times what the online screens ask of a DEPLOYED site, from wherever you run this (run it from
// Dhaka for the real picture). It signs in like a browser does, registers a throwaway device, and
// measures each question several times. Targets: reading a list or searching under 300 ms, a save
// under 600 ms. --write also saves (and then deletes) one test product to time a save.
//
// Use a shop WITHOUT PINs, or a test shop: a shop that uses PINs needs a PIN unlock first.
import { randomUUID } from "node:crypto";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const next = args[i + 1];
  return next && !next.startsWith("--") ? next : "true";
};
const base = (flag("url") ?? "").replace(/\/$/, "");
const user = flag("user");
const password = flag("password") ?? process.env.LATENCY_PASSWORD;
const runs = Number(flag("runs", "15"));
const write = args.includes("--write");
if (!base || !user || !password) {
  console.error(
    "Usage: pnpm latency --url https://site --user <username> --password <password> [--runs 15] [--write]",
  );
  process.exit(1);
}

const jar = new Map();
const remember = (response) => {
  for (const line of response.headers.getSetCookie?.() ?? []) {
    const [pair] = line.split(";");
    const eq = pair.indexOf("=");
    jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1));
  }
};
const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
const call = async (path, init = {}) => {
  const start = performance.now();
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      origin: base,
      cookie: cookie(),
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const ms = performance.now() - start;
  remember(response);
  return { response, ms, body: await response.json().catch(() => ({})) };
};

// --- sign in, register a device (once, not timed) ---
const signIn = await call("/api/auth/sign-in/username", {
  method: "POST",
  body: JSON.stringify({ username: user.toLowerCase(), password }),
});
if (!signIn.response.ok) {
  console.error(
    `Sign-in failed (${signIn.response.status}). Check the address, username and password.`,
  );
  process.exit(1);
}
const registered = await call("/api/devices/register", {
  method: "POST",
  body: JSON.stringify({ deviceId: randomUUID(), name: "latency-test" }),
});
if (!registered.response.ok) {
  console.error(
    `Could not register a device (${registered.response.status} ${registered.body.code ?? ""}).`,
  );
  process.exit(1);
}

const percentile = (sorted, p) =>
  sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
const jobs = [
  [
    "list products (first page)",
    300,
    () => call("/api/data/products?limit=50"),
  ],
  [
    "search products (word)",
    300,
    () => call("/api/data/products?q=a&limit=50"),
  ],
  ["list sales (first page)", 300, () => call("/api/data/sales?limit=50")],
  ["totals (sales)", 300, () => call("/api/data/sales/totals")],
  ["dashboard (one request)", 300, () => call("/api/dashboard?days=days7")],
  ["head (change counter)", 300, () => call("/api/sync/head")],
];
if (write)
  jobs.push([
    "save a product",
    600,
    async () => {
      const id = randomUUID();
      const result = await call("/api/commands", {
        method: "POST",
        body: JSON.stringify({
          operationId: randomUUID(),
          type: "product.create",
          input: {
            id,
            name: "latency-test",
            purchasePrice: 100,
            sellingPrice: 200,
            openingStock: 0,
            openingMovementId: randomUUID(),
          },
        }),
      });
      if (result.response.ok)
        await call("/api/commands", {
          method: "POST",
          body: JSON.stringify({
            operationId: randomUUID(),
            type: "product.delete",
            input: { id },
            baseVersion: 1,
          }),
        });
      return result;
    },
  ]);

console.log(`\n${base} · ${runs} runs each (ms)\n`);
console.log(
  `${"question".padEnd(30)} ${"p50".padStart(6)} ${"p95".padStart(6)} ${"max".padStart(6)}  target`,
);
let slow = 0;
for (const [label, target, run] of jobs) {
  const first = await run(); // warm up, and see if it works at all
  if (!first.response.ok) {
    console.log(
      `${label.padEnd(30)} failed: ${first.response.status} ${first.body.code ?? ""}`,
    );
    slow++;
    continue;
  }
  const times = [];
  for (let i = 0; i < runs; i++) times.push((await run()).ms);
  times.sort((a, b) => a - b);
  const p95 = percentile(times, 0.95);
  if (p95 > target) slow++;
  console.log(
    `${label.padEnd(30)} ${percentile(times, 0.5).toFixed(0).padStart(6)} ${p95.toFixed(0).padStart(6)} ${times.at(-1).toFixed(0).padStart(6)}  <${target}${p95 > target ? "  OVER" : ""}`,
  );
}
console.log(
  slow === 0
    ? "\nAll within target."
    : `\n${slow} question(s) over target or failing.`,
);
