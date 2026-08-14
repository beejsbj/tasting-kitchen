import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const cwd = new URL(".", import.meta.url);
const unit = spawnSync(process.execPath, ["test/unit.test.mjs"], { cwd, encoding: "utf8" });
const probe = spawnSync(process.execPath, ["tools/probe.mjs"], { cwd, encoding: "utf8" });

assert.equal(unit.status, 0, unit.stderr || "unit test should pass");
assert.equal(probe.status, 1, "documented-path probe should expose the mismatch");
assert.match(probe.stdout, /"status":404/);
console.log("diagnostic fixture verified");
