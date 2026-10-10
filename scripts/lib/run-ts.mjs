// Runs a TypeScript script that uses the app's own code (through the "@" alias) against the
// database in .env.local. The script's own top-level code does the work.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

export async function runTs(entry) {
  // .env.local is optional: on a build machine or CI the settings are real environment variables.
  const envFile = existsSync(".env.local")
    ? readFileSync(".env.local", "utf8")
    : "";
  for (const line of envFile.split(/\r?\n/)) {
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
