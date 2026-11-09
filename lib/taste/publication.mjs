import { mkdir, readFile, rename, rm } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";

import { fixtureSourceFile, hashCanonical, sha256 } from "./catalog.mjs";
import { createReceipt, INPUTS_DIRECTORY, writeDishSidecars } from "./receipts.mjs";
import { runChecks } from "./checks.mjs";
import { assertSetupRecord, isPersonalEnvironment } from "./environments.mjs";
import {
  assertPublicTextSafe,
  copySelectedFiles,
  copyTree,
  describeTree,
  pathExists,
  scanPublicTree,
  scanWebArtifactNetwork,
  ArtifactContractError,
  selectArtifactFiles,
  within,
  writeJsonAtomic,
} from "./files.mjs";

export class FinalizationError extends Error {
  /** `chefFault` is set only where the evidence is the model's own output (see faults.mjs); `checks` travels with a validation failure. */
  constructor(stage, message, { chefFault, kitchenFault, checks, ...options } = {}) {
    super(message, options);
    this.name = "FinalizationError";
    this.stage = stage;
    if (chefFault) this.chefFault = chefFault;
    if (kitchenFault) this.kitchenFault = kitchenFault;
    if (checks) this.checks = checks;
  }
}

function publicAction(event, workspace) {
  const item = event?.item;
  if (!item || !["item.started", "item.completed"].includes(event.type)) return null;
  const allowed = new Set(["command_execution", "file_change", "mcp_tool_call", "tool_call"]);
  if (!allowed.has(item.type)) return null;
  const result = { event: event.type, type: item.type };
  if (typeof item.status === "string") result.status = item.status;
  if (Number.isInteger(item.exit_code)) result.exitCode = item.exit_code;
  const candidate = item.path ?? item.file_path;
  if (typeof candidate === "string") {
    const relative = path.relative(workspace, path.resolve(workspace, candidate)).split(path.sep).join("/");
    if (relative && !relative.startsWith("../") && relative !== "..") result.path = relative;
  }
  return result;
}

function exactPathBoundary(text, start, length) {
  const before = start === 0 ? "" : text[start - 1];
  const afterIndex = start + length;
  const after = afterIndex >= text.length ? "" : text[afterIndex];
  const beforeOk = before === "" || /[\s([<{"'`]/u.test(before);
  const afterOk = after === "" || /[\s)\]}>,”",;:!?"'`]/u.test(after)
    || (after === "." && (afterIndex + 1 === text.length || /[\s)\]}>"'`]/u.test(text[afterIndex + 1])));
  return beforeOk && afterOk;
}

/** Rewrite only complete selected-file paths rooted at this exact workspace. */
export function sanitizePublicResponse(text, { workspace, selectedFiles }) {
  if (typeof text !== "string") throw new TypeError("Public response must be text");
  if (/file:\/\//iu.test(text)) return assertPublicTextSafe(text, "assistant response");
  let sanitized = text;
  const replacements = selectedFiles
    .map((relative) => ({
      absolute: within(workspace, relative, "selected artifact path"),
      publicPath: `artifact/${relative}`,
    }))
    .sort((left, right) => right.absolute.length - left.absolute.length);
  for (const replacement of replacements) {
    let cursor = 0;
    let rebuilt = "";
    while (cursor < sanitized.length) {
      const index = sanitized.indexOf(replacement.absolute, cursor);
      if (index < 0) { rebuilt += sanitized.slice(cursor); break; }
      rebuilt += sanitized.slice(cursor, index);
      if (exactPathBoundary(sanitized, index, replacement.absolute.length)) {
        rebuilt += replacement.publicPath;
        cursor = index + replacement.absolute.length;
      } else {
        rebuilt += sanitized.slice(index, index + replacement.absolute.length);
        cursor = index + replacement.absolute.length;
      }
    }
    sanitized = rebuilt;
  }
  return assertPublicTextSafe(sanitized, "assistant response");
}

function makePublicTranscript(recipe, result, workspace, selectedFiles) {
  return {
    schemaVersion: 1,
    recipeId: recipe.id,
    turns: recipe.turns.map((turn, index) => ({
      id: turn.id,
      role: turn.role,
      prompt: index === 0 ? `${recipe.setup.instructions}\n\n${turn.content}` : turn.content,
      response: sanitizePublicResponse(result.turns[index]?.finalMessage ?? "", { workspace, selectedFiles }),
      usage: result.turns[index]?.usage ?? null,
      actions: (result.turns[index]?.events ?? []).map((event) => publicAction(event, workspace)).filter(Boolean),
    })),
  };
}

export function publicValidation(checks) {
  return {
    schemaVersion: 1,
    passed: checks.passed,
    checks: checks.checks.map(({ id, type, required, description, passed, advisory, errored, detail }) => ({
      id, type, required, description, passed, ...(advisory ? { advisory } : {}), ...(errored ? { errored } : {}), detail,
    })),
  };
}

/** Fixture declarations with the exact bytes the catalog hashed. Private fixtures keep their hash and size only. */
export async function fixtureBytes(repoRoot, recipe) {
  if (!recipe.sourcePath) return [];
  const recipeDirectory = path.dirname(path.join(repoRoot, recipe.sourcePath));
  return Promise.all(recipe.setup.fixtures.map(async (fixture) => {
    const bytes = await readFile(fixtureSourceFile(repoRoot, recipeDirectory, recipe, fixture));
    const hash = sha256(bytes);
    if (recipe.fixtureHashes?.[fixture.id] && hash !== recipe.fixtureHashes[fixture.id]) throw new FinalizationError("validation", `Fixture ${fixture.id} changed since the recipe was loaded`);
    return fixture.public === false ? { ...fixture, sha256: hash, size: bytes.length } : { ...fixture, sha256: hash, bytes };
  }));
}

/**
 * What a personal Dish's receipt says about the setup: the digest, the
 * per-entry summary (top-level names only), the toggles, and the MCP servers
 * and plugins the harness reported loading. Never file names or contents.
 */
export function setupReceipt(setup, observed) {
  if (!setup) return null;
  const loaded = observed?.loaded;
  return {
    environment: setup.environment,
    ...(setup.harnessProfile ? { harnessProfile: setup.harnessProfile } : {}),
    memory: setup.memory,
    connections: setup.connections,
    ...(setup.digest ? { digest: setup.digest } : {}),
    ...(setup.digestAtStart ? { digestAtStart: setup.digestAtStart } : {}),
    ...(setup.entries ? { entries: setup.entries } : {}),
    ...(setup.toolsets ? { toolsets: setup.toolsets } : {}),
    ...(loaded ? { loaded: { mcpServers: loaded.mcpServers.map((server) => server.name), plugins: loaded.plugins } } : {}),
  };
}

/**
 * Move a finished staging tree into place. A plain rename is atomic, so it goes
 * first. Staging (private/runtime) and the destination (dishes/ or
 * private/dishes/) may sit on different filesystems, for instance when private/
 * is a symlink, and rename then fails with EXDEV. Only then is the tree copied
 * beside its destination and renamed within that one directory. A crash during
 * the copy leaves a dot-prefixed `.publishing-*` directory, which the Dish
 * loader ignores.
 */
export async function publishDirectory(staging, destination) {
  await mkdir(path.dirname(destination), { recursive: true });
  try {
    await rename(staging, destination);
    return;
  } catch (error) {
    if (error?.code !== "EXDEV") throw error;
  }
  const temporary = path.join(path.dirname(destination), `.${path.basename(destination)}.publishing-${randomBytes(6).toString("hex")}`);
  try {
    await copyTree(staging, temporary);
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
  // The Dish is in place; a leftover staging tree must not turn that into a failed publication.
  await rm(staging, { recursive: true, force: true }).catch(() => {});
}

export function dishIdForAttempt(attemptId) {
  if (!/^attempt_[a-zA-Z0-9_-]+$/u.test(attemptId)) throw new Error(`Unsafe attempt id: ${attemptId}`);
  return `dish_${attemptId.slice("attempt_".length)}`;
}

/** Shared, model-free publication path for fresh executions and recovery. */
export async function finalizeAttempt({
  repoRoot,
  catalog,
  catalogHash = catalog.catalogHash,
  recipe,
  variant,
  skill = null,
  attemptId,
  attemptDir,
  workspace,
  result,
  observed,
  executedAt,
  finalizedAt = new Date(),
  recovered = false,
  publishPersonal = false,
  setup = null,
  env = process.env,
} = {}) {
  const staging = path.join(attemptDir, "public-staging");
  const dishId = dishIdForAttempt(attemptId);
  // A private Recipe's Dishes stay inside the ignored private tree. They are
  // validated and immutable like public Dishes but are never staged for the gallery.
  // A personal-environment Run carries Burooj's own setup into the trace, so its
  // Dish is private too unless the Cook explicitly asked to publish it.
  const isPrivate = recipe.visibility === "private" || (isPersonalEnvironment(variant) && !publishPersonal);
  try { assertSetupRecord(setup, variant); }
  catch (error) { throw new FinalizationError("publication", error.message, { cause: error }); }
  const dishDirectory = isPrivate ? path.join(repoRoot, "private", "dishes", dishId) : path.join(repoRoot, "dishes", dishId);
  if (await pathExists(dishDirectory)) throw new FinalizationError("publication", `Accepted dish already exists and will not be overwritten: ${dishId}`);
  if (await pathExists(staging)) throw new FinalizationError("publication", "Attempt public staging directory already exists");

  try {
    // Session artifacts are runner-owned. Write a provisional transcript only
    // to establish the selected output set; it is replaced before validation.
    if (recipe.output.kind === "session") {
      await writeJsonAtomic(within(workspace, recipe.output.entry, "session artifact entry"), {
        schemaVersion: 1,
        recipeId: recipe.id,
        turns: result.turns.map((turn, index) => ({ id: recipe.turns[index].id, response: turn.finalMessage ?? "" })),
      });
    }
    let selection;
    try { selection = await selectArtifactFiles(workspace, recipe.output); }
    catch (error) {
      // Kitchen writes a session's entry itself; for any other kind only a broken contract (no entry, too many files or bytes) is the model's.
      if (recipe.output.kind === "session") throw new FinalizationError("publication", error.message, { cause: error });
      throw new FinalizationError("validation", error.message, { cause: error, ...(error instanceof ArtifactContractError ? { chefFault: "output-contract" } : {}) });
    }
    const transcript = makePublicTranscript(recipe, result, workspace, selection.files);
    if (recipe.output.kind === "session") {
      await writeJsonAtomic(within(workspace, recipe.output.entry, "session artifact entry"), transcript);
    }

    for (const fixture of recipe.setup.fixtures) {
      if (!recipe.fixtureIntegrityRequired) continue;
      if (fixture.editable === true) continue;
      const expected = recipe.fixtureHashes?.[fixture.id];
      if (!expected) throw new FinalizationError("validation", `Frozen recipe lacks a fixture hash for ${fixture.id}`);
      const actual = sha256(await readFile(within(workspace, fixture.mountAs, `fixture ${fixture.id}`)));
      if (actual !== expected) throw new FinalizationError("validation", `Fixture ${fixture.id} changed during execution`, { chefFault: "output-contract" });
    }
    const checks = await runChecks(recipe, workspace, { env });
    await writeJsonAtomic(path.join(attemptDir, recovered ? "validation.recovery.json" : "validation.raw.json"), checks);
    if (!checks.passed) {
      const failing = checks.checks.filter((check) => check.required && !check.passed);
      const failed = failing.map((check) => check.id);
      // A check that could not run never judged the output: the whole failure is Kitchen's.
      if (failing.some((check) => check.errored)) throw new FinalizationError("validation", `Required validation could not run: ${failing.filter((check) => check.errored).map((check) => check.id).join(", ")}`, { kitchenFault: "validator-error", checks });
      throw new FinalizationError("validation", `Required validation failed: ${failed.join(", ")}`, { chefFault: "checks-failed", checks });
    }
    selection = await selectArtifactFiles(workspace, recipe.output);

    await mkdir(path.join(staging, "artifact"), { recursive: true });
    await copySelectedFiles(workspace, path.join(staging, "artifact"), selection);
    await writeJsonAtomic(path.join(staging, "validation.json"), publicValidation(checks));
    await writeJsonAtomic(path.join(staging, "trace.json"), transcript);

    const described = await describeTree(path.join(staging, "artifact"));
    const dishWithoutHash = {
      schemaVersion: 1,
      id: dishId,
      recipe: { id: recipe.id, version: recipe.version, hash: recipe.recipeHash },
      ...(skill ? { skill: { id: skill.id, hash: skill.skillHash } } : {}),
      ...(isPrivate ? { visibility: "private" } : {}),
      executedAt: new Date(executedAt).toISOString(),
      finalizedAt: new Date(finalizedAt).toISOString(),
      identity: {
        variantId: variant.id,
        provider: variant.provider,
        requestedModel: variant.model,
        observedModel: observed.model,
        harness: variant.harness,
        harnessVersion: result.cliVersion,
        reasoningEffort: observed.reasoningEffort,
        serviceTier: observed.serviceTier,
        requestedServiceTier: observed.requestedServiceTier ?? variant.serviceTier,
        ...(observed.observedServiceTier ? { observedServiceTier: observed.observedServiceTier } : {}),
        configHash: variant.configHash,
        ...(catalogHash ? { catalogHash } : {}),
        // Which version of his setup a snapshot saw. Two snapshot Dishes are Repeats only when it matches.
        ...(variant.executionProfile.environment === "snapshot" ? { setupDigest: setup.digest } : {}),
      },
      status: "accepted",
      artifact: {
        kind: recipe.output.kind,
        entry: `artifact/${recipe.output.entry}`,
        files: described.files.map((file) => ({ ...file, path: `artifact/${file.path}` })),
        treeHash: described.treeHash,
      },
      validation: { passed: true, report: "validation.json" },
      publicTrace: "trace.json",
    };
    const dish = { ...dishWithoutHash, dishHash: hashCanonical(dishWithoutHash) };
    await writeJsonAtomic(path.join(staging, "dish.json"), dish);
    if (recipe.output.kind === "web") await scanWebArtifactNetwork(path.join(staging, "artifact"));
    // Sidecars sit outside dish.json and dishHash. inputs/ holds catalog
    // fixtures verbatim, so it is scanned for leaks but not for path shapes.
    await writeDishSidecars(staging, {
      recipe: { id: recipe.id, recipeHash: recipe.recipeHash },
      fixtures: await fixtureBytes(repoRoot, recipe),
      receipt: createReceipt(variant, skill, recipe, setupReceipt(setup, observed)),
    });
    await scanPublicTree(staging, { verbatim: [INPUTS_DIRECTORY] });
    await publishDirectory(staging, dishDirectory);
    return { status: "accepted", attemptId, dishId, dishDirectory, manifest: dish, recovered };
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    if (error instanceof FinalizationError) throw error;
    throw new FinalizationError("publication", error.message, { cause: error });
  }
}
