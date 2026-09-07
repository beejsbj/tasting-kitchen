import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { ESLint } from "eslint";

const projectRoot = path.resolve(import.meta.dirname, "..");

test("lint ignores generated runtime and Dish artifacts but includes project source", async () => {
  const eslint = new ESLint({ cwd: projectRoot });
  assert.equal(await eslint.isPathIgnored(path.join(projectRoot, "private/runtime/generated.js")), true);
  assert.equal(await eslint.isPathIgnored(path.join(projectRoot, "dishes/generated/artifact/app.mjs")), true);
  assert.equal(await eslint.isPathIgnored(path.join(projectRoot, "lib/taste/catalog.mjs")), false);
});
