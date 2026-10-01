// Demo data: pnpm db:seed [--reset]. Bundles scripts/seed/seed.ts (it uses the app's own code through
// the "@" alias) and runs it against the database in .env.local. The database must be running
// (pnpm db:dev for the local one).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (match && !(match[1] in process.env))
    process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
}

mkdirSync(".data", { recursive: true });
writeFileSync(".data/empty.js", "export {};\n");
await build({
  entryPoints: ["scripts/seed/seed.ts"],
  outfile: ".data/seed.bundle.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  alias: { "@": "./src", "server-only": "./.data/empty.js" },
  logLevel: "warning",
});
await import(pathToFileURL(".data/seed.bundle.mjs").href);
