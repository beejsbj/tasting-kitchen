import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const memo = await readFile(process.argv[2], "utf8");
for (const id of ["D1", "C1", "S1", "R1"]) assert.match(memo, new RegExp(`\\[${id}\\]`), `missing citation ${id}`);
assert.match(memo, /not ready|not operational|blocked|missing token|cannot run/i, "verdict must reflect missing authentication and proof");
assert.doesNotMatch(memo, /ready to use today|successfully exported|proven operational/i, "memo must not invent runtime proof");
console.log("support memo verified");
