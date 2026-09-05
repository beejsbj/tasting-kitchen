#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { buildRegistry, cook, discover, inspect, listRecipes, loadCatalog, plan } from "../lib/taste/index.mjs";
import { recoverAttempt } from "../lib/taste/recovery.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const valueFlags = new Set(["recipe", "menu", "revision", "config", "variant", "cuisine", "tag", "status", "origin", "kind", "output", "attempt", "intent", "codex"]);
const booleanFlags = new Set(["json", "execute", "help"]);

const commandFlags = {
  help: new Set(),
  validate: new Set(),
  discover: new Set(),
  inspect: new Set(["recipe", "menu", "revision"]),
  list: new Set(["cuisine", "tag", "status", "origin", "kind"]),
  plan: new Set(["recipe", "menu", "config", "variant", "cuisine", "tag", "status", "origin", "kind"]),
  cook: new Set(["recipe", "menu", "config", "variant", "cuisine", "tag", "status", "origin", "kind", "intent", "execute", "codex"]),
  "build-registry": new Set(["output"]),
  recover: new Set(["attempt"]),
};

function parseArgs(argv) {
  const positional = [];
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) { positional.push(token); continue; }
    const [key, inline] = token.slice(2).split(/=(.*)/s, 2);
    if (booleanFlags.has(key)) {
      if (inline !== undefined) throw new Error(`--${key} does not take a value`);
      if (options[key] !== undefined) throw new Error(`--${key} may be supplied only once`);
      options[key] = true;
      continue;
    }
    if (!valueFlags.has(key)) throw new Error(`Unknown flag: --${key}`);
    const value = inline ?? argv[++index];
    if (!value || value.startsWith("--")) throw new Error(`--${key} requires a value`);
    if (["recipe", "tag"].includes(key)) options[key] = [...(options[key] ?? []), ...value.split(",").filter(Boolean)];
    else if (options[key] !== undefined) throw new Error(`--${key} may be supplied only once`);
    else options[key] = value;
  }
  return { positional, options };
}

function commandAndOptions(positional, options) {
  if (positional.length > 1) throw new Error(`Unexpected positional argument: ${positional[1]}`);
  const command = positional[0] ?? "help";
  if (!(command in commandFlags)) throw new Error(`Unknown command: ${command}`);
  if (options.help) {
    if (command !== "help" || Object.keys(options).some((key) => key !== "help")) throw new Error("--help must be used by itself");
    return { command: "help", options: {} };
  }
  for (const key of Object.keys(options)) {
    if (key === "json") continue;
    if (!commandFlags[command].has(key)) throw new Error(`--${key} is not valid for taste ${command}`);
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
  if (options.config && options.variant && options.config !== options.variant) throw new Error("--config and legacy --variant disagree");
  const configurationId = options.config ?? options.variant;
  if (!configurationId) throw new Error("--config is required (legacy --variant is accepted)");
  if (options.recipe?.length && options.menu) throw new Error("Use either --recipe or --menu, not both");
  return { configurationId, ...(options.recipe?.length ? { recipeIds: options.recipe } : options.menu ? { menuId: options.menu } : { filter: { status: "ready", ...filterFrom(options) } }) };
}

function inspectSelection(options) {
  if (options.recipe?.length > 1) throw new Error("inspect accepts one --recipe id");
  const selectors = [
    options.recipe?.length ? { recipeId: options.recipe[0] } : null,
    options.menu ? { menuId: options.menu } : null,
    options.revision ? { revisionHash: options.revision } : null,
  ].filter(Boolean);
  if (selectors.length !== 1) throw new Error("inspect requires exactly one of --recipe, --menu, or --revision");
  return selectors[0];
}

function print(value, json = false) {
  process.stdout.write(`${json || typeof value !== "string" ? JSON.stringify(value, null, 2) : value}\n`);
}

function help() {
  return `taste — inspect and cook immutable Recipe revisions

Usage:
  taste discover [--json]
  taste inspect --recipe ID|--menu ID|--revision HASH [--json]
  taste list [--cuisine ID] [--tag ID] [--status STATUS] [--json]
  taste plan --config ID [--recipe ID[,ID...]] [filters] [--json]
  taste cook --config ID [--recipe ID[,ID...]] --intent fill-missing|repeat [--execute] [--json]
  taste validate
  taste build-registry [--output PATH]
  taste recover --attempt ID

Cook is dry-run by default. --execute additionally requires TASTE_ALLOW_MODEL_RUNS=1.
Errors use {"error":{"code":"INVALID_ARGUMENT","message":"..."}} on stderr with --json.
--variant is accepted as a compatibility alias for --config.`;
}

async function validate() {
  const child = spawn(process.execPath, [path.join(repoRoot, "scripts", "validate-catalog.mjs")], { cwd: repoRoot, stdio: "inherit", shell: false });
  return new Promise((resolve) => {
    child.once("error", () => resolve(1));
    child.once("close", (code) => resolve(code ?? 1));
  });
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const { command, options } = commandAndOptions(parsed.positional, parsed.options);
  if (command === "help") return print(help());
  if (command === "validate") { process.exitCode = await validate(); return; }
  if (command === "discover") return print(await discover(repoRoot), true);
  if (command === "inspect") return print(await inspect(repoRoot, inspectSelection(options)), true);
  if (command === "list") {
    const recipes = listRecipes(await loadCatalog(repoRoot), filterFrom(options));
    return options.json ? print(recipes, true) : recipes.forEach((recipe) => process.stdout.write(`${recipe.id}\t${recipe.cuisines.join(",")}\t${recipe.origin}\t${recipe.status}\t${recipe.kind}\t${recipe.title}\n`));
  }
  if (command === "plan") return print(await plan(repoRoot, selection(options)), true);
  if (command === "cook") {
    if (!options.intent || !["fill-missing", "repeat"].includes(options.intent)) throw new Error("cook requires --intent fill-missing or --intent repeat");
    if (options.execute && process.env.TASTE_ALLOW_MODEL_RUNS !== "1") throw new Error("Refusing model execution: set TASTE_ALLOW_MODEL_RUNS=1 as an explicit paid-run acknowledgement");
    const result = await cook(repoRoot, { ...selection(options), intent: options.intent, execute: options.execute, executable: options.codex });
    if (result.failed?.length) process.exitCode = 1;
    return print(result, true);
  }
  if (command === "build-registry") {
    const output = options.output ? path.resolve(process.cwd(), options.output) : undefined;
    const result = await buildRegistry({ repoRoot, basePath: process.env.TASTE_BASE_PATH ?? "/", ...(output ? { output } : {}) });
    return print({ status: "built", output: path.relative(repoRoot, result.output), dishes: result.registry.dishes.length }, true);
  }
  if (command === "recover") {
    if (!options.attempt) throw new Error("recover requires --attempt ID");
    return print(await recoverAttempt({ repoRoot, catalog: await loadCatalog(repoRoot), attemptId: options.attempt }), true);
  }
}

const jsonErrors = process.argv.includes("--json");
main().catch((error) => {
  if (jsonErrors) process.stderr.write(`${JSON.stringify({ error: { code: "INVALID_ARGUMENT", message: error.message } })}\n`);
  else process.stderr.write(`taste: ${error.message}\n`);
  process.exitCode = 1;
});
