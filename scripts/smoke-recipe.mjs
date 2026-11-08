#!/usr/bin/env node
// Prove a film Recipe's toolchain with Kitchen's no-model reference; no model runs.
// usage: node scripts/smoke-recipe.mjs <recipe-id> [--out DIR]
// Evidence lands in private/runtime/smoke/<recipe-id>/<stamp>/ (ignored) unless --out is given.
import path from "node:path";

import { smokeRecipe } from "../lib/taste/smoke.mjs";

const args = process.argv.slice(2);
const recipeId = args.find((argument) => !argument.startsWith("--"));
const outIndex = args.indexOf("--out");
if (!recipeId) {
  console.error("usage: node scripts/smoke-recipe.mjs <recipe-id> [--out DIR]");
  process.exit(2);
}
const result = await smokeRecipe({
  repoRoot: path.resolve(import.meta.dirname, ".."),
  recipeId,
  ...(outIndex >= 0 ? { outDir: path.resolve(args[outIndex + 1]) } : {}),
  log: (line) => console.error(line),
});
for (const [name, step] of Object.entries(result.steps)) console.log(`${step.passed ? "PASS" : "FAIL"} ${name} (${step.seconds.toFixed(1)} s)${step.error ? `: ${step.error}` : ""}`);
console.log(`${result.passed ? "smoke passed" : "smoke failed"}: ${path.join(result.directory, "smoke.json")}`);
process.exit(result.passed ? 0 : 1);
