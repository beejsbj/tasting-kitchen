#!/usr/bin/env node
// One-time backfill. Builds inputs.json, inputs/ and receipt.json for every Dish
// that was published before sidecars existed, using the frozen
// catalog/revisions/{recipes,configurations} JSON that the simplified model
// removes. Those files remain available in git history at commit f87ce48.
// Never rewrites dish.json; skips Dishes that already have sidecars.
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { computeConfigHash, computeRecipeHash, sha256 } from "../lib/taste/catalog.mjs";
import { pathExists } from "../lib/taste/files.mjs";
import { INPUTS_MANIFEST, verifyInputs, writeDishSidecars } from "../lib/taste/receipts.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));
async function loadDir(directory) {
  const root = path.join(repoRoot, "catalog", "revisions", directory);
  return Promise.all((await readdir(root)).filter((name) => name.endsWith(".json")).map((name) => readJson(path.join(root, name))));
}

const recipeRevisions = new Map((await loadDir("recipes")).map((revision) => [revision.hash, revision]));
const configRevisions = new Map((await loadDir("configurations")).map((revision) => [revision.hash, revision]));
let written = 0;
for (const trees of ["dishes", path.join("private", "dishes")]) {
  const root = path.join(repoRoot, trees);
  if (!await pathExists(root)) continue;
  for (const entry of (await readdir(root, { withFileTypes: true })).filter((item) => item.isDirectory())) {
    const directory = path.join(root, entry.name);
    if (await pathExists(path.join(directory, INPUTS_MANIFEST))) continue;
    const dish = await readJson(path.join(directory, "dish.json"));
    if (dish.skill) throw new Error(`${dish.id}: skill dishes were never frozen; nothing to backfill from`);
    const revision = recipeRevisions.get(dish.recipe.hash);
    const configuration = configRevisions.get(dish.identity.configHash);
    if (!revision) throw new Error(`${dish.id}: no frozen recipe revision ${dish.recipe.hash}`);
    if (!configuration) throw new Error(`${dish.id}: no frozen configuration revision ${dish.identity.configHash}`);
    if (configuration.hash !== computeConfigHash(configuration.configuration)) throw new Error(`${dish.id}: configuration revision does not match its hash`);
    const fixtureHashes = Object.fromEntries(revision.fixtures.map((fixture) => [fixture.id, fixture.sha256]));
    if (computeRecipeHash(revision.execution, fixtureHashes) !== dish.recipe.hash) throw new Error(`${dish.id}: recipe revision does not reproduce the recorded recipe hash`);
    const fixtures = revision.fixtures.map((fixture) => {
      if (fixture.public === false) return { ...fixture, size: undefined };
      const bytes = Buffer.from(fixture.contentBase64, "base64");
      if (sha256(bytes) !== fixture.sha256) throw new Error(`${dish.id}: fixture ${fixture.id} bytes do not match their hash`);
      const { contentBase64, ...declaration } = fixture;
      return { ...declaration, bytes };
    });
    if (fixtures.some((fixture) => fixture.public === false)) throw new Error(`${dish.id}: private fixture sizes are unknown to a frozen revision`);
    await writeDishSidecars(directory, {
      recipe: { id: dish.recipe.id, recipeHash: dish.recipe.hash },
      fixtures,
      receipt: { schemaVersion: 1, configuration: configuration.configuration, skill: null },
    });
    const problems = await verifyInputs(directory, await readJson(path.join(directory, INPUTS_MANIFEST)));
    if (problems.length) throw new Error(`${dish.id}: ${problems.join("; ")}`);
    written += 1;
  }
}
console.log(`Backfilled sidecars for ${written} Dish(es).`);
