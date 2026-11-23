#!/usr/bin/env node
// Prove a film Recipe's toolchain with Kitchen's no-model reference; no model runs.
// usage: node scripts/smoke-recipe.mjs <recipe-id> [--out DIR | --resume DIR] [--out-outside-private]
// --resume repeats every step after the render on an earlier smoke's workspace.
// Evidence lands in private/runtime/smoke/<recipe-id>/<stamp>/ (ignored) unless --out is given.
// --out and --resume must name a directory under private/ unless --out-outside-private says otherwise.
import path from "node:path";
import { parseArgs } from "node:util";

import { smokeRecipe } from "../lib/taste/smoke.mjs";

const usage = "usage: node scripts/smoke-recipe.mjs <recipe-id> [--out DIR | --resume DIR] [--out-outside-private]";
let parsed;
try {
  parsed = parseArgs({ allowPositionals: true, options: { out: { type: "string" }, resume: { type: "string" }, "out-outside-private": { type: "boolean" } } });
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
let result;
try {
  result = await smokeRecipe({
    repoRoot: path.resolve(import.meta.dirname, ".."),
    recipeId,
    ...(values.out ? { outDir: path.resolve(values.out) } : {}),
    ...(values.resume ? { resume: path.resolve(values.resume) } : {}),
    allowOutsidePrivate: values["out-outside-private"] === true,
    log: (line) => console.error(line),
  });
} catch (error) {
  // A refusal before any step (an unknown Recipe, an output outside private/) leaves no receipt.
  console.error(error.message);
  process.exit(1);
}
for (const [name, step] of Object.entries(result.steps)) console.log(`${step.passed ? "PASS" : "FAIL"} ${name}${step.reused ? " (reused)" : ` (${step.seconds.toFixed(1)} s)`}${step.error ? `: ${step.error}` : ""}`);
console.log(`${result.passed ? "smoke passed" : "smoke failed"}: ${path.join(result.directory, "smoke.json")}`);
process.exit(result.passed ? 0 : 1);
