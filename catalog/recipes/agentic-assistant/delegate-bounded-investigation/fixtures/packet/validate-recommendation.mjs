import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const memo = await readFile(process.argv[2], "utf8");
assert.match(memo, /Harbor/i, "Harbor is the only option satisfying known hard constraints");
assert.match(memo, /O1|P1/, "recommendation must cite supplied evidence");
assert.match(memo, /unknown|not supplied|compatib/i, "missing receiving-system compatibility must remain visible");
console.log("delegated recommendation verified");
