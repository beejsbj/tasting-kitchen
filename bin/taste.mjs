#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { buildRegistry, cook, discover, inspect, listRecipes, loadCatalog, plan } from "../lib/taste/index.mjs";
import { recoverAttempt } from "../lib/taste/recovery.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const valueFlags = new Set(["recipe", "menu", "config", "variant", "cuisine", "tag", "status", "origin", "kind", "output", "attempt", "intent", "codex"]);
const booleanFlags = new Set(["json", "execute", "help"]);

function parseArgs(argv) {
  const positional = [];
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) { positional.push(token); continue; }
    const [key, inline] = token.slice(2).split(/=(.*)/s, 2);
    if (booleanFlags.has(key)) { options[key] = true; continue; }
    if (!valueFlags.has(key)) throw new Error(`Unknown flag: --${key}`);
    const value = inline ?? argv[++index];
    if (!value || value.startsWith("--")) throw new Error(`--${key} requires a value`);
    if (["recipe", "tag"].includes(key)) options[key] = [...(options[key] ?? []), ...value.split(",").filter(Boolean)];
    else if (options[key] !== undefined) throw new Error(`--${key} may be supplied only once`);
    else options[key] = value;
  }
  return { positional, options };
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

function print(value, json = false) {
  process.stdout.write(`${json || typeof value !== "string" ? JSON.stringify(value, null, 2) : value}\n`);
}

function help() {
  return `taste — inspect and cook immutable Recipe revisions

Usage:
  taste discover [--json]
  taste inspect --recipe ID|--menu ID [--json]
  taste list [--cuisine ID] [--tag ID] [--status STATUS] [--json]
  taste plan --config ID [--recipe ID[,ID...]] [filters] [--json]
  taste cook --config ID [--recipe ID[,ID...]] --intent fill-missing|repeat [--execute] [--json]
  taste validate
  taste build-registry [--output PATH]
  taste recover --attempt ID

Cook is dry-run by default. --execute additionally requires TASTE_ALLOW_MODEL_RUNS=1.
--variant is accepted as a compatibility alias for --config.`;
}

async function validate() {
  const child = spawn(process.execPath, [path.join(repoRoot, "scripts", "validate-catalog.mjs")], { cwd: repoRoot, stdio: "inherit", shell: false });
  return new Promise((resolve) => child.on("close", (code) => resolve(code ?? 1)));
}

async function main() {
  const { positional, options } = parseArgs(process.argv.slice(2));
  const command = positional[0] ?? "help";
  if (options.help || command === "help") return print(help());
  if (command === "validate") { process.exitCode = await validate(); return; }
  if (command === "discover") return print(await discover(repoRoot), true);
  if (command === "inspect") return print(await inspect(repoRoot, { recipeId: options.recipe?.[0], menuId: options.menu }), true);
  if (command === "list") {
    const recipes = listRecipes(await loadCatalog(repoRoot), filterFrom(options));
    return options.json ? print(recipes, true) : recipes.forEach((recipe) => process.stdout.write(`${recipe.id}\t${recipe.cuisines.join(",")}\t${recipe.origin}\t${recipe.status}\t${recipe.kind}\t${recipe.title}\n`));
  }
  if (command === "plan") return print(await plan(repoRoot, selection(options)), true);
  if (command === "cook") {
    if (!options.intent || !["fill-missing", "repeat"].includes(options.intent)) throw new Error("cook requires --intent fill-missing or --intent repeat");
    if (options.execute && process.env.TASTE_ALLOW_MODEL_RUNS !== "1") throw new Error("Refusing model execution: set TASTE_ALLOW_MODEL_RUNS=1 as an explicit paid-run acknowledgement");
    return print(await cook(repoRoot, { ...selection(options), intent: options.intent, execute: options.execute, executable: options.codex }), true);
  }
  if (command === "build-registry") {
    const output = options.output ? path.resolve(process.cwd(), options.output) : undefined;
    const result = await buildRegistry({ repoRoot, ...(output ? { output } : {}) });
    return print({ status: "built", output: path.relative(repoRoot, result.output), dishes: result.registry.dishes.length }, true);
  }
  if (command === "recover") {
    if (!options.attempt) throw new Error("recover requires --attempt ID");
    return print(await recoverAttempt({ repoRoot, catalog: await loadCatalog(repoRoot), attemptId: options.attempt }), true);
  }
  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => { process.stderr.write(`taste: ${error.message}\n`); process.exitCode = 1; });
