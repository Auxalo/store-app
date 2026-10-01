// Fails when en.json and bn.json drift apart (missing keys, or different {placeholders}).
import { readFileSync } from "node:fs";

const load = (name) =>
  JSON.parse(
    readFileSync(
      new URL(`../src/i18n/messages/${name}.json`, import.meta.url),
      "utf8",
    ),
  );
const flatten = (obj, prefix = "") =>
  Object.entries(obj).flatMap(([k, v]) =>
    typeof v === "object" && v !== null
      ? flatten(v, `${prefix}${k}.`)
      : [[`${prefix}${k}`, String(v)]],
  );
// Unique names: English plurals may use {n} in several branches while Bangla has one.
const placeholders = (s) =>
  [...new Set([...s.matchAll(/\{(\w+)/g)].map((m) => m[1]))].sort().join(",");

const en = new Map(flatten(load("en")));
const bn = new Map(flatten(load("bn")));
const problems = [];

for (const key of en.keys())
  if (!bn.has(key)) problems.push(`bn.json is missing "${key}"`);
for (const key of bn.keys())
  if (!en.has(key)) problems.push(`en.json is missing "${key}"`);
for (const [key, value] of en) {
  if (bn.has(key) && placeholders(value) !== placeholders(bn.get(key))) {
    problems.push(`placeholder mismatch in "${key}"`);
  }
}
for (const [key, value] of bn)
  if (value.trim() === "") problems.push(`bn.json "${key}" is empty`);

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`i18n OK — ${en.size} keys in both languages.`);
