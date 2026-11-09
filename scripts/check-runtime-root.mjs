#!/usr/bin/env node
// Run a command (the test suite) and fail if the real runtime root gained an
// entry while it ran. Tests cook in a throwaway TASTE_RUNTIME_ROOT
// (tests/support/runtime-root.mjs) and the runtime refuses the real root under
// the test runner; this is the backstop that proves a full run left
// /var/tmp/tk-<uid> (and any root exported in the shell) as it found it.
// A real Cook running at the same moment would trip it too; say so and rerun.
//
// Usage: node scripts/check-runtime-root.mjs -- <command> [args...]
import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";

import { RUNTIME_ROOT_ENV, defaultRuntimeRoot } from "../lib/taste/runtime-root.mjs";

const separator = process.argv.indexOf("--");
const [command, ...args] = separator >= 0 ? process.argv.slice(separator + 1) : [];
if (!command) {
  process.stderr.write("usage: check-runtime-root.mjs -- <command> [args...]\n");
  process.exit(2);
}

const roots = [...new Set([defaultRuntimeRoot(), process.env[RUNTIME_ROOT_ENV]].filter((root) => root && path.isAbsolute(root)))];

async function entries(root) {
  const names = await readdir(root).catch(() => null);
  if (names === null) return new Set();
  const owners = await readdir(path.join(root, ".owners")).catch(() => []);
  return new Set([...names, ...owners.map((name) => `.owners/${name}`)].map((name) => path.join(root, name)));
}

const before = new Map(await Promise.all(roots.map(async (root) => [root, await entries(root)])));
const child = spawn(command, args, { stdio: "inherit" });
const code = await new Promise((resolve) => {
  child.on("error", (error) => { process.stderr.write(`${error.message}\n`); resolve(1); });
  child.on("close", (exitCode, signal) => resolve(exitCode ?? (signal ? 1 : 0)));
});
const added = [];
for (const root of roots) for (const entry of await entries(root)) if (!before.get(root).has(entry)) added.push(entry);
if (added.length) {
  process.stderr.write(`\nThe test run wrote to the real runtime root (a Cook running at the same time would too):\n${added.map((entry) => `  ${entry}`).join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`Real runtime root untouched: ${roots.join(", ")}\n`);
process.exit(code);
