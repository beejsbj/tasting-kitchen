import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const memo = await readFile(process.argv[2], "utf8");
assert.match(memo, /retention|guide|link|404/i, "notice must identify the live broken link");
assert.doesNotMatch(memo, /finish moving|migration is in progress|resume the migration/i, "notice must not resurrect canceled migration work");
assert.ok(memo.trim().length <= 700, "notice should remain concise");
console.log("notice contract verified");
