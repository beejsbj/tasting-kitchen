#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { axisSetsForContext, buildRegistry, compareRubricsFromFile, cook, discover, evaluateDishWithJev, inspect, listRecipes, loadAxisSets, loadCatalog, loadDishes, loadObservations, plan } from "../lib/taste/index.mjs";
import { recoverAttempt } from "../lib/taste/recovery.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const valueFlags = new Set(["recipe", "menu", "revision", "config", "variant", "skill", "cuisine", "tag", "status", "origin", "kind", "output", "attempt", "intent", "codex", "dish", "axis-set", "axis-version", "provider", "evaluator", "experiment"]);
const booleanFlags = new Set(["json", "execute", "help", "public-checkout"]);

const commandFlags = {
  help: new Set(),
  validate: new Set(["public-checkout"]),
  discover: new Set(),
  inspect: new Set(["recipe", "menu"]),
  list: new Set(["cuisine", "tag", "status", "origin", "kind"]),
  plan: new Set(["recipe", "menu", "config", "variant", "skill", "cuisine", "tag", "status", "origin", "kind"]),
  cook: new Set(["recipe", "menu", "config", "variant", "skill", "cuisine", "tag", "status", "origin", "kind", "intent", "execute", "codex"]),
  axes: new Set(["recipe", "menu"]),
  observations: new Set(["dish"]),
  observe: new Set(["dish", "axis-set", "axis-version", "recipe", "menu", "revision", "provider", "evaluator", "execute"]),
  "compare-rubrics": new Set(["experiment", "output"]),
  "build-registry": new Set(["output"]),
  recover: new Set(["attempt"]),
};

class UsageError extends Error {
  constructor(message) {
    super(message);
    this.code = "INVALID_ARGUMENT";
  }
}

function parseArgs(argv) {
  const positional = [];
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) { positional.push(token); continue; }
    const [key, inline] = token.slice(2).split(/=(.*)/s, 2);
    if (booleanFlags.has(key)) {
      if (inline !== undefined) throw new UsageError(`--${key} does not take a value`);
      if (options[key] !== undefined) throw new UsageError(`--${key} may be supplied only once`);
      options[key] = true;
      continue;
    }
    if (!valueFlags.has(key)) throw new UsageError(`Unknown flag: --${key}`);
    const value = inline ?? argv[++index];
    if (!value || value.startsWith("--")) throw new UsageError(`--${key} requires a value`);
    if (["recipe", "tag"].includes(key)) options[key] = [...(options[key] ?? []), ...value.split(",").filter(Boolean)];
    else if (options[key] !== undefined) throw new UsageError(`--${key} may be supplied only once`);
    else options[key] = value;
  }
  return { positional, options };
}

function commandAndOptions(positional, options) {
  if (positional.length > 1) throw new UsageError(`Unexpected positional argument: ${positional[1]}`);
  const command = positional[0] ?? "help";
  if (!(command in commandFlags)) throw new UsageError(`Unknown command: ${command}`);
  if (options.help) {
    if (Object.keys(options).some((key) => key !== "help" && key !== "json")) throw new UsageError("--help must be used without command options");
    return { command: "help", options };
  }
  for (const key of Object.keys(options)) {
    if (key === "json") continue;
    if (!commandFlags[command].has(key)) throw new UsageError(`--${key} is not valid for taste ${command}`);
  }
  return { command, options };
}

function filterFrom(options) {
  return {
    ...(options.cuisine ? { cuisine: options.cuisine } : {}),
    ...(options.status ? { status: options.status } : {}),
    ...(options.origin ? { origin: options.origin } : {}),
    ...(options.kind ? { kind: options.kind } : {}),
    ...(options.tag ? { tags: options.tag } : {}),
  };
}

function selection(options) {
  if (options.config && options.variant && options.config !== options.variant) throw new UsageError("--config and legacy --variant disagree");
  const configurationId = options.config ?? options.variant;
  if (!configurationId) throw new UsageError("--config is required (legacy --variant is accepted)");
  if (options.recipe?.length && options.menu) throw new UsageError("Use either --recipe or --menu, not both");
  return { configurationId, ...(options.skill ? { skillId: options.skill } : {}), ...(options.recipe?.length ? { recipeIds: options.recipe } : options.menu ? { menuId: options.menu } : { filter: { status: "ready", ...filterFrom(options) } }) };
}

function inspectSelection(options) {
  if (options.recipe?.length > 1) throw new UsageError("inspect accepts one --recipe id");
  const selectors = [
    options.recipe?.length ? { recipeId: options.recipe[0] } : null,
    options.menu ? { menuId: options.menu } : null,
  ].filter(Boolean);
  if (selectors.length !== 1) throw new UsageError("inspect requires exactly one of --recipe or --menu");
  return selectors[0];
}

function contextSelection(options, { revision = false } = {}) {
  if (options.recipe?.length > 1) throw new UsageError("This command accepts one --recipe id");
  if (options.recipe?.length && options.menu) throw new UsageError("Use either --recipe or --menu, not both");
  const kind = options.recipe?.length ? "recipe" : options.menu ? "menu" : null;
  const id = options.recipe?.[0] ?? options.menu;
  if (!kind || !id) throw new UsageError("One of --recipe or --menu is required");
  if (revision && !options.revision) throw new UsageError("--revision (the recipe hash the Dish was cooked from) is required to pin the comparison context");
  return { kind, id, ...(revision ? { revisionHash: options.revision } : {}) };
}

function print(value, json = false) {
  process.stdout.write(`${json || typeof value !== "string" ? JSON.stringify(value, null, 2) : value}\n`);
}

function help() {
  return `taste — inspect and cook Recipes

Usage:
  taste discover [--json]
  taste inspect --recipe ID|--menu ID [--json]
  taste list [--cuisine ID] [--tag ID] [--status STATUS] [--json]
  taste plan --config ID [--skill ID|none] [--recipe ID[,ID...]|--menu ID] [filters] [--json]
  taste cook --config ID [--skill ID|none] [--recipe ID[,ID...]|--menu ID] --intent fill-missing|repeat [--execute] [--json]
  taste axes --recipe ID|--menu ID [--json]
  taste observations --dish ID [--json]
  taste observe --dish ID --axis-set ID --axis-version VERSION --recipe ID|--menu ID --revision RECIPE-HASH [--execute --provider ID]
  taste compare-rubrics --experiment PATH [--output PATH] [--json]
  taste validate [--public-checkout] [--json]
  taste build-registry [--output PATH]
  taste recover --attempt ID

  Validate checks private provenance by default. --public-checkout skips private provenance entirely, even when present; public checks still run.
  --skill mounts one catalog skill layer at the recipe's mount path; the default is none. The layer is part of Dish identity.
  Cook and observe are dry-run by default. Observe requires an explicit axis-set version; live execution additionally requires TASTE_ALLOW_JEV_RUNS=1.
Errors use {"error":{"code":"INVALID_ARGUMENT","message":"..."}} on stderr with --json.
--variant is accepted as a compatibility alias for --config.`;
}

async function validate({ json = false, publicCheckout = false } = {}) {
  const child = spawn(process.execPath, [path.join(repoRoot, "scripts", "validate-catalog.mjs"), ...(publicCheckout ? ["--public-checkout"] : [])], { cwd: repoRoot, stdio: json ? "pipe" : "inherit", shell: false });
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += chunk; });
    child.stderr?.on("data", (chunk) => { stderr += chunk; });
    child.once("error", (error) => resolve({ exitCode: 1, stdout, stderr: `${stderr}${error.message}` }));
    child.once("close", (code) => resolve({ exitCode: code ?? 1, stdout, stderr }));
  });
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const { command, options } = commandAndOptions(parsed.positional, parsed.options);
  if (command === "help") return print(options.json ? { help: help() } : help(), options.json);
  if (command === "validate") {
    const result = await validate({ json: options.json, publicCheckout: options["public-checkout"] });
    process.exitCode = result.exitCode;
    if (options.json) print({ status: result.exitCode === 0 ? "valid" : "invalid", errors: result.stderr.trim() ? result.stderr.trim().split("\n") : [], output: result.stdout.trim() || undefined }, true);
    return;
  }
  if (command === "discover") return print(await discover(repoRoot), true);
  if (command === "inspect") return print(await inspect(repoRoot, inspectSelection(options)), true);
  if (command === "list") {
    const recipes = listRecipes(await loadCatalog(repoRoot), filterFrom(options));
    return options.json ? print(recipes, true) : recipes.forEach((recipe) => process.stdout.write(`${recipe.id}\t${recipe.cuisines.join(",")}\t${recipe.origin}\t${recipe.status}\t${recipe.kind}\t${recipe.title}\n`));
  }
  if (command === "plan") return print(await plan(repoRoot, selection(options)), true);
  if (command === "cook") {
    if (!options.intent || !["fill-missing", "repeat"].includes(options.intent)) throw new UsageError("cook requires --intent fill-missing or --intent repeat");
    if (options.execute && process.env.TASTE_ALLOW_MODEL_RUNS !== "1") throw new UsageError("Refusing model execution: set TASTE_ALLOW_MODEL_RUNS=1 as an explicit paid-run acknowledgement");
    const result = await cook(repoRoot, { ...selection(options), intent: options.intent, execute: options.execute, executable: options.codex });
    if (result.failed?.length) process.exitCode = 1;
    return print(result, true);
  }
  if (command === "axes") {
    const context = contextSelection(options);
    return print(axisSetsForContext(await loadAxisSets(repoRoot), context), true);
  }
  if (command === "observations") {
    if (!options.dish) throw new UsageError("observations requires --dish ID");
    const dishes = await loadDishes(repoRoot);
    if (!dishes.some((dish) => dish.id === options.dish)) throw new UsageError(`Unknown Dish: ${options.dish}`);
    const axisSets = await loadAxisSets(repoRoot);
    return print((await loadObservations(repoRoot, { dishes, axisSets })).filter((observation) => observation.dishId === options.dish), true);
  }
  if (command === "observe") {
    if (!options.dish || !options["axis-set"] || !options["axis-version"]) throw new UsageError("observe requires --dish, --axis-set, and --axis-version");
    if (options.execute && process.env.TASTE_ALLOW_JEV_RUNS !== "1") throw new UsageError("Refusing Jev execution: set TASTE_ALLOW_JEV_RUNS=1 as an explicit paid-run acknowledgement");
    return print(await evaluateDishWithJev(repoRoot, {
      dishId: options.dish,
      axisSetId: options["axis-set"],
      axisSetVersion: options["axis-version"],
      context: contextSelection(options, { revision: true }),
      execute: options.execute,
      evaluatorProvider: options.provider,
      evaluatorId: options.evaluator,
    }), true);
  }
  if (command === "compare-rubrics") {
    if (!options.experiment) throw new UsageError("compare-rubrics requires --experiment PATH");
    const experiment = path.resolve(process.cwd(), options.experiment);
    const output = options.output ? path.resolve(process.cwd(), options.output) : undefined;
    return print(await compareRubricsFromFile(experiment, { output }), true);
  }
  if (command === "build-registry") {
    const output = options.output ? path.resolve(process.cwd(), options.output) : undefined;
    const result = await buildRegistry({ repoRoot, basePath: process.env.TASTE_BASE_PATH ?? "/", ...(output ? { output } : {}) });
    return print({ status: "built", output: path.relative(repoRoot, result.output), dishes: result.registry.dishes.length }, true);
  }
  if (command === "recover") {
    if (!options.attempt) throw new UsageError("recover requires --attempt ID");
    return print(await recoverAttempt({ repoRoot, catalog: await loadCatalog(repoRoot), attemptId: options.attempt }), true);
  }
}

const jsonErrors = process.argv.includes("--json");
main().catch((error) => {
  if (jsonErrors) process.stderr.write(`${JSON.stringify({ error: { code: error.code === "INVALID_ARGUMENT" ? "INVALID_ARGUMENT" : "TASTE_ERROR", message: error.message } })}\n`);
  else process.stderr.write(`taste: ${error.message}\n`);
  process.exitCode = 1;
});
