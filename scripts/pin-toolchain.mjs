#!/usr/bin/env node
// Write the current toolchain pin into every Recipe that names a toolchain.
// The pin is a fixture, so re-pinning deliberately moves those recipe hashes.
// usage: node scripts/pin-toolchain.mjs [--check]
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { loadCatalog } from "../lib/taste/catalog.mjs";
import { loadToolchains, renderToolchainPin, resolveToolchain, TOOLCHAIN_FIXTURE_ID } from "../lib/taste/toolchains.mjs";

const root = path.resolve(import.meta.dirname, "..");
const check = process.argv.includes("--check");
const catalog = await loadCatalog(root);
const toolchains = await loadToolchains(root);
let stale = 0;
for (const recipe of catalog.recipes.filter((candidate) => candidate.toolchain)) {
  const fixture = recipe.setup.fixtures.find((candidate) => candidate.id === TOOLCHAIN_FIXTURE_ID);
  if (!fixture) throw new Error(`${recipe.id} names toolchain ${recipe.toolchain.id} but has no "${TOOLCHAIN_FIXTURE_ID}" fixture`);
  const filename = path.join(root, path.dirname(recipe.sourcePath), fixture.path);
  const wanted = renderToolchainPin(resolveToolchain(toolchains, recipe.toolchain.id));
  const current = await readFile(filename, "utf8").catch(() => null);
  if (current === wanted) continue;
  stale += 1;
  if (check) console.error(`stale: ${path.relative(root, filename)}`);
  else { await writeFile(filename, wanted); console.log(`pinned: ${path.relative(root, filename)}`); }
}
if (check && stale) process.exit(1);
