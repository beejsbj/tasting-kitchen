#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { listRecipes, loadCatalog, planSelection } from "../lib/taste/catalog.mjs";
import { buildCodexTurnArgs } from "../lib/taste/codex.mjs";
import { buildRegistry } from "../lib/taste/registry.mjs";
import { recoverAttempt } from "../lib/taste/recovery.mjs";
import { executePlan } from "../lib/taste/runner.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const positional = [];
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) { positional.push(token); continue; }
    const [rawKey, inline] = token.slice(2).split(/=(.*)/s, 2);
    if (["json", "execute", "canary", "help"].includes(rawKey)) { options[rawKey] = true; continue; }
    const value = inline ?? argv[++index];
    if (value === undefined || value.startsWith("--")) throw new Error(`--${rawKey} requires a value`);
    if (["recipe", "tag"].includes(rawKey)) options[rawKey] = [...(options[rawKey] ?? []), ...value.split(",").filter(Boolean)];
    else options[rawKey] = value;
  }
  return { positional, options };
}

function filterFrom(options) {
  const filter = {};
  if (options.domain) filter.domain = options.domain;
  if (options.status) filter.status = options.status;
  if (options.origin) filter.origin = options.origin;
  if (options.kind) filter.kind = options.kind;
  if (options.tag) filter.tags = options.tag;
  return filter;
}

function selectionOptions(options) {
  if (!options.variant) throw new Error("--variant is required");
  return options.recipe?.length
    ? { variantId: options.variant, flight: options.recipe }
    : { variantId: options.variant, filter: { status: "ready", ...filterFrom(options) } };
}

function print(value, json = false) {
  if (json || typeof value !== "string") process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  else process.stdout.write(`${value}\n`);
}

function runProcess(executable, args) {
  return new Promise((resolve) => {
    const child = spawn(executable, args, { cwd: repoRoot, stdio: "inherit", shell: false });
    child.on("error", (error) => { throw error; });
    child.on("close", (code) => resolve(code ?? 1));
  });
}

function help() {
  return `taste — cook repeatable model-fingerprint recipes

Usage:
  taste validate
  taste list [--domain ID] [--tag ID] [--status STATUS] [--json]
  taste plan --variant ID [--recipe ID[,ID...]] [filters] [--json]
  taste run --variant ID [--recipe ID[,ID...]] [filters] [--canary] [--execute]
  taste recover --attempt ID
  taste build-registry [--output PATH]
  taste publish [--output PATH]

Run is a dry run unless --execute is supplied. Execution additionally requires
TASTE_ALLOW_MODEL_RUNS=1. --canary requires exactly one supported recipe.`;
}

async function main() {
  const { positional, options } = parseArgs(process.argv.slice(2));
  const command = positional[0] ?? "help";
  if (options.help || command === "help") return print(help());

  if (command === "validate") {
    process.exitCode = await runProcess(process.execPath, [path.join(repoRoot, "scripts", "validate-catalog.mjs")]);
    return;
  }

  if (command === "build-registry" || command === "publish") {
    const output = options.output ? path.resolve(process.cwd(), options.output) : undefined;
    const built = await buildRegistry({ repoRoot, ...(output ? { output } : {}) });
    return print({ status: "built", output: path.relative(repoRoot, built.output).split(path.sep).join("/"), dishes: built.registry.dishes.length }, options.json);
  }

  const catalog = await loadCatalog(repoRoot);
  if (command === "recover") {
    if (!options.attempt) throw new Error("recover requires --attempt ID");
    const result = await recoverAttempt({ repoRoot, catalog, attemptId: options.attempt });
    await buildRegistry({ repoRoot });
    return print(result, true);
  }
  if (command === "list") {
    const recipes = listRecipes(catalog, filterFrom(options));
    if (options.json) return print(recipes.map((record) => {
      const recipe = { ...record };
      delete recipe.fixtureHashes;
      delete recipe.sourcePath;
      return { ...recipe, recipeDir: path.posix.dirname(record.sourcePath) };
    }), true);
    for (const recipe of recipes) process.stdout.write(`${recipe.id}\t${recipe.domain}\t${recipe.origin}\t${recipe.status}\t${recipe.kind}\t${recipe.title}\n`);
    return;
  }

  if (command === "plan" || command === "run") {
    const plan = planSelection(catalog, selectionOptions(options));
    if (command === "plan") return print(plan, true);
    if (options.canary && plan.supported.length !== 1) throw new Error(`--canary requires exactly one supported recipe; selected ${plan.supported.length}`);
    if (!options.execute) {
      const first = plan.supported[0];
      let firstTurnArgv = null;
      if (first) {
        const recipe = catalog.recipes.find((candidate) => candidate.id === first.recipeId);
        firstTurnArgv = ["codex", ...buildCodexTurnArgs({
          variant: plan.variant,
          recipe,
          workspace: path.join(repoRoot, "private", "runtime", "attempts", "<attempt>", "workspace"),
          finalPath: path.join(repoRoot, "private", "runtime", "attempts", "<attempt>", "raw", "turn-1", "final.txt"),
        })];
      }
      return print({ mode: "dry-run", plan, firstTurnArgv, note: "No model was invoked. Pass --execute with TASTE_ALLOW_MODEL_RUNS=1 to cook." }, true);
    }
    if (process.env.TASTE_ALLOW_MODEL_RUNS !== "1") throw new Error("Refusing model execution: set TASTE_ALLOW_MODEL_RUNS=1 as an explicit paid-run acknowledgement");
    if (plan.supported.length === 0) throw new Error("No supported recipes selected");
    const result = await executePlan({ repoRoot, catalog, plan, executable: options.codex ?? "codex" });
    await buildRegistry({ repoRoot });
    print(result, true);
    if (result.failed.length) process.exitCode = 1;
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  process.stderr.write(`taste: ${error.message}\n`);
  process.exitCode = 1;
});
