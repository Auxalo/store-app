// Runs a TypeScript script that uses the app's own code (through the "@" alias) against the
// database in .env.local. The script's own top-level code does the work.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

export async function runTs(entry) {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match && !(match[1] in process.env))
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  mkdirSync(".data", { recursive: true });
  writeFileSync(".data/empty.js", "export {};\n");
  const outfile = `.data/${basename(entry, ".ts")}.bundle.mjs`;
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    alias: { "@": "./src", "server-only": "./.data/empty.js" },
    logLevel: "warning",
  });
  await import(pathToFileURL(outfile).href);
}
