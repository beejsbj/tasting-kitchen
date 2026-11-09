#!/usr/bin/env node
// Prove a film Recipe's toolchain with Kitchen's no-model reference; no model runs.
// usage: node scripts/smoke-recipe.mjs <recipe-id> [--out DIR | --resume DIR]
// --resume repeats every step after the render on an earlier smoke's workspace.
// Evidence lands in private/runtime/smoke/<recipe-id>/<stamp>/ (ignored) unless --out is given.
import path from "node:path";
import { parseArgs } from "node:util";

import { smokeRecipe } from "../lib/taste/smoke.mjs";

const usage = "usage: node scripts/smoke-recipe.mjs <recipe-id> [--out DIR | --resume DIR]";
let parsed;
try {
  parsed = parseArgs({ allowPositionals: true, options: { out: { type: "string" }, resume: { type: "string" } } });
} catch (error) {
  console.error(`${error.message}\n${usage}`);
  process.exit(2);
}
const { values, positionals } = parsed;
const [recipeId] = positionals;
if (!recipeId || positionals.length > 1 || (values.out && values.resume)) {
  console.error(usage);
  process.exit(2);
}
const result = await smokeRecipe({
  repoRoot: path.resolve(import.meta.dirname, ".."),
  recipeId,
  ...(values.out ? { outDir: path.resolve(values.out) } : {}),
  ...(values.resume ? { resume: path.resolve(values.resume) } : {}),
  log: (line) => console.error(line),
});
for (const [name, step] of Object.entries(result.steps)) console.log(`${step.passed ? "PASS" : "FAIL"} ${name}${step.reused ? " (reused)" : ` (${step.seconds.toFixed(1)} s)`}${step.error ? `: ${step.error}` : ""}`);
console.log(`${result.passed ? "smoke passed" : "smoke failed"}: ${path.join(result.directory, "smoke.json")}`);
process.exit(result.passed ? 0 : 1);
