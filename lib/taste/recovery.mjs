import { readFile } from "node:fs/promises";
import path from "node:path";

import { canonicalJson, resolveVariant } from "./catalog.mjs";
import { parseCodexJsonl } from "./codex.mjs";
import { pathExists, within, writeJsonAtomic } from "./files.mjs";
import { verifyObservedIdentity } from "./identity.mjs";
import { dishIdForAttempt, finalizeAttempt } from "./publication.mjs";

const ATTEMPT_ID = /^attempt_[a-zA-Z0-9_-]+$/u;
const FAST_TIER_ALIAS_FAILURE = "Effective Codex identity mismatch: tier requested fast, observed priority";

async function readJson(filename, label) {
  try { return JSON.parse(await readFile(filename, "utf8")); }
  catch (error) { throw new Error(`Cannot read ${label}: ${error.message}`, { cause: error }); }
}

function recoveryMode(state) {
  if (state?.status !== "failed") return null;
  if (
    state.stage === "publication"
    || (state.stage === undefined && typeof state.message === "string" && state.message.startsWith("Public artifact scan failed:"))
  ) return "publication";
  if (state.stage === "execution" && state.message === FAST_TIER_ALIAS_FAILURE) return "fast-tier-alias";
  return null;
}

function provesFastTierInvocation(argv) {
  if (!Array.isArray(argv)) return false;
  const tierSettings = [];
  let fastModeEnabled = 0;
  let fastModeDisabled = 0;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "-c" && typeof argv[index + 1] === "string" && argv[index + 1].startsWith("service_tier=")) {
      tierSettings.push(argv[index + 1]);
    }
    if (argv[index] === "--enable" && argv[index + 1] === "fast_mode") fastModeEnabled += 1;
    if (argv[index] === "--disable" && argv[index + 1] === "fast_mode") fastModeDisabled += 1;
  }
  return tierSettings.length === 1
    && tierSettings[0] === 'service_tier="fast"'
    && fastModeEnabled === 1
    && fastModeDisabled === 0;
}

function assertFastTierAliasEvidence(requested, execution, recipe, variant) {
  if (requested.identity?.serviceTier !== "fast" || variant.serviceTier !== "fast") {
    throw new Error("Fast-tier alias recovery requires an exact raw fast tier request");
  }
  if (!Array.isArray(execution.turns) || execution.turns.length !== recipe.turns.length) {
    throw new Error("Fast-tier alias recovery requires every scripted turn");
  }
  for (const turn of execution.turns) {
    if (!provesFastTierInvocation(turn.argv)) {
      throw new Error(`Fast-tier alias recovery lacks exact fast invocation proof for turn ${turn.turnId ?? "unknown"}`);
    }
  }
}

function assertCurrentContracts(requested, recipe, variant) {
  if (requested.recipe?.id !== recipe.id || requested.recipe?.version !== recipe.version) throw new Error("Attempt recipe identity no longer matches the catalog");
  if (requested.recipe.hash !== recipe.recipeHash) throw new Error("Attempt recipe hash no longer matches the catalog");
  if (canonicalJson(requested.recipe.fixtureHashes) !== canonicalJson(recipe.fixtureHashes)) throw new Error("Attempt fixture hashes no longer match the catalog");
  if (requested.identity?.variantId !== variant.id) throw new Error("Attempt variant identity no longer matches the catalog");
  if (requested.identity.configHash !== variant.configHash) throw new Error("Attempt variant config hash no longer matches the catalog");
}

async function reconstructResult(attemptDir, execution, recipe) {
  if (execution.failure !== null) throw new Error("Attempt execution contains a model failure");
  if (!Array.isArray(execution.turns) || execution.turns.length !== recipe.turns.length) throw new Error("Attempt does not contain every scripted turn");
  const turns = [];
  for (const [index, recorded] of execution.turns.entries()) {
    const expected = recipe.turns[index];
    if (recorded.turnId !== expected.id) throw new Error(`Attempt turn ${index + 1} does not match recipe turn ${expected.id}`);
    for (const key of ["eventsPath", "finalPath"]) {
      if (typeof recorded[key] !== "string" || !recorded[key].startsWith("raw/turns/")) throw new Error(`Attempt turn ${expected.id} has an unsafe ${key}`);
    }
    const eventsText = await readFile(within(attemptDir, recorded.eventsPath, `turn ${expected.id} events`), "utf8");
    const parsed = parseCodexJsonl(eventsText);
    if (parsed.threadId !== execution.threadId) throw new Error(`Attempt turn ${expected.id} changed thread UUID`);
    const finalMessage = await readFile(within(attemptDir, recorded.finalPath, `turn ${expected.id} final message`), "utf8");
    turns.push({ turnId: expected.id, events: parsed.events, finalMessage, usage: recorded.usage ?? null });
  }
  return { threadId: execution.threadId, cliVersion: execution.cliVersion, failure: null, turns };
}

/** Recover a publication-only failure. This function contains no model adapter. */
export async function recoverAttempt({ repoRoot, catalog, attemptId, now = new Date(), verifyIdentity = verifyObservedIdentity, env = process.env } = {}) {
  if (!ATTEMPT_ID.test(attemptId ?? "")) throw new Error(`Unsafe attempt id: ${String(attemptId)}`);
  const attemptsRoot = path.join(repoRoot, "private", "runtime", "attempts");
  const attemptDir = within(attemptsRoot, attemptId, "attempt id");
  if (!await pathExists(attemptDir)) throw new Error(`Unknown attempt: ${attemptId}`);
  const [requested, execution, state] = await Promise.all([
    readJson(path.join(attemptDir, "requested.json"), "requested manifest"),
    readJson(path.join(attemptDir, "execution.json"), "execution receipt"),
    readJson(path.join(attemptDir, "state.json"), "attempt state"),
  ]);
  if (requested.attemptId !== attemptId) throw new Error("Attempt directory and requested manifest disagree");
  const mode = recoveryMode(state);
  if (!mode) throw new Error("Attempt did not fail specifically during publication or the allowed fast-tier identity alias");
  const dishId = dishIdForAttempt(attemptId);
  if (await pathExists(path.join(repoRoot, "dishes", dishId))) throw new Error(`Dish already exists: ${dishId}`);
  if (await pathExists(path.join(attemptDir, "state.pre-recovery.json"))) throw new Error("Attempt has already entered recovery");

  const recipe = catalog.recipes.find((candidate) => candidate.id === requested.recipe?.id);
  if (!recipe) throw new Error(`Attempt references unknown recipe: ${requested.recipe?.id}`);
  const variant = resolveVariant(catalog, requested.identity?.variantId);
  assertCurrentContracts(requested, recipe, variant);
  if (mode === "fast-tier-alias") assertFastTierAliasEvidence(requested, execution, recipe, variant);
  const result = await reconstructResult(attemptDir, execution, recipe);
  const codexHome = path.join(attemptDir, "codex-home");
  const observed = await verifyIdentity({ codexHome, threadId: execution.threadId, variant, cliVersion: execution.cliVersion });
  if (mode === "fast-tier-alias" && (observed.requestedServiceTier !== "fast" || observed.observedServiceTier !== "priority")) {
    throw new Error("Fast-tier alias recovery rollout does not prove requested fast and observed priority");
  }
  const runtimeRoot = path.join(repoRoot, "private", "runtime");
  await writeJsonAtomic(path.join(attemptDir, "observed.json"), {
    ...observed,
    rolloutPath: observed.rolloutPath ? path.relative(runtimeRoot, observed.rolloutPath).split(path.sep).join("/") : undefined,
  });
  const finalizedAt = new Date(now);
  const publication = await finalizeAttempt({
    repoRoot,
    catalog,
    recipe,
    variant,
    attemptId,
    attemptDir,
    workspace: path.join(attemptDir, "workspace"),
    result,
    observed,
    executedAt: requested.startedAt,
    finalizedAt,
    recovered: true,
    env,
  });
  await writeJsonAtomic(path.join(attemptDir, "state.pre-recovery.json"), state);
  await writeJsonAtomic(path.join(attemptDir, "recovery.json"), {
    status: "accepted",
    dishId: publication.dishId,
    executedAt: requested.startedAt,
    finalizedAt: finalizedAt.toISOString(),
    modelInvoked: false,
    requestedServiceTier: observed.requestedServiceTier,
    observedServiceTier: observed.observedServiceTier,
  });
  await writeJsonAtomic(path.join(attemptDir, "state.json"), {
    status: "accepted",
    recovered: true,
    dishId: publication.dishId,
    executedAt: requested.startedAt,
    finalizedAt: finalizedAt.toISOString(),
  });
  return publication;
}
