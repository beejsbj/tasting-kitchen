import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const theme = await readFile(new URL("./assets/theme.css", import.meta.url), "utf8");
const note = await readFile(new URL("./notes/idea.md", import.meta.url), "utf8");
assert.equal(theme, ":root {\n  --paper: #f4ead7;\n  --ink: #28231d;\n  --signal: #a3472f;\n}\n");
assert.equal(note, "# Unrelated idea\n\nTry a receipt-like stack for the archive history after this maintenance task.\n");

const test = spawnSync(process.execPath, ["test/summary.test.mjs"], { cwd: new URL(".", import.meta.url), encoding: "utf8" });
assert.equal(test.status, 0, test.stderr || test.stdout);
console.log("behavior and user-owned files verified");
