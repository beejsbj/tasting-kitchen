import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const table = await readFile(process.argv[2], "utf8");
for (const row of ["A", "B", "C"]) assert.match(table, new RegExp(`(?:^|\\|)\\s*${row}\\s*\\|`, "m"), `missing row ${row}`);
for (const source of ["A1", "B1", "C1"]) assert.match(table, new RegExp(source), `missing source ${source}`);
assert.match(table, /B[^\n]*(unknown|not supplied|missing)/i, "B setup must remain unknown");
assert.doesNotMatch(table, /B[^\n]*\|\s*[0-9]+ steps?\s*\|/i, "B setup must not be invented");
console.log("orchestration table verified");
