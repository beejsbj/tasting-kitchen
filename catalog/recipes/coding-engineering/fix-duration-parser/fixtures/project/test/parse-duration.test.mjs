import assert from "node:assert/strict";
import { parseDuration } from "../src/parse-duration.mjs";

assert.equal(parseDuration("45m"), 45);
assert.equal(parseDuration("2h"), 120);
assert.equal(parseDuration("0m"), 0);
assert.throws(() => parseDuration("1.5h"), /whole number/);
assert.throws(() => parseDuration("soon"), /whole number/);
console.log("duration parser tests passed");
