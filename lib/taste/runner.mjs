import { randomBytes } from "node:crypto";
import { mkdir, readdir, stat, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runCodexSession } from "./codex.mjs";
import { runCursorSession, verifyCursorIdentity } from "./cursor.mjs";
import {
  copyTree,
  ensurePrivateDirectory,
  within,
  writeJsonAtomic,
} from "./files.mjs";
import { verifyObservedIdentity } from "./identity.mjs";
import { finalizeAttempt } from "./publication.mjs";
import { freezeConfigurationRevision, freezeRecipeRevision } from "./revisions.mjs";

function safeId(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
}

function runStamp(now) {
  return now.toISOString().replace(/[-:.TZ]/g, "");
}

function relativeEvidence(root, value) {
  return value ? path.relative(root, value).split(path.sep).join("/") : null;
}

async function prepareWorkspace(repoRoot, recipe, workspace) {
  await mkdir(workspace, { recursive: false });
  const recipeDirectory = path.dirname(path.join(repoRoot, recipe.sourcePath));
  for (const fixture of recipe.setup.fixtures) {
    await copyTree(within(recipeDirectory, fixture.path, `fixture ${fixture.id}`), within(workspace, fixture.mountAs, `fixture mount ${fixture.id}`));
  }
  await mkdir(path.join(workspace, "output"), { recursive: true });
}

async function prepareAttemptCodexHome(codexHome, authSource) {
  await ensurePrivateDirectory(codexHome);
  const source = path.resolve(authSource);
  const info = await stat(source);
  if (!info.isFile()) throw new Error(`Codex auth source is not a regular file: ${source}`);
  await symlink(source, path.join(codexHome, "auth.json"));
  const entries = await readdir(codexHome);
  if (entries.length !== 1 || entries[0] !== "auth.json") {
    throw new Error("Fresh attempt Codex home may contain only auth.json before launch");
  }
}

function requestedManifest(catalog, recipe, variant, attemptId, startedAt) {
  const codex = variant.harness === "codex-cli";
  return {
    schemaVersion: 1,
    attemptId,
    startedAt,
    workspace: "workspace/",
    recipe: { id: recipe.id, version: recipe.version, hash: recipe.recipeHash, fixtureHashes: recipe.fixtureHashes },
    identity: {
      variantId: variant.id,
      provider: variant.provider,
      model: variant.model,
      harness: variant.harness,
      reasoningEffort: variant.reasoningEffort,
      serviceTier: variant.serviceTier,
      personality: variant.personality,
      configHash: variant.configHash,
      catalogHash: catalog.catalogHash,
    },
    boundary: recipe.harness,
    execution: {
      profileId: variant.executionProfile.id,
      label: variant.executionProfile.label,
      sandbox: variant.executionProfile.sandbox,
      approvalPolicy: variant.executionProfile.approvalPolicy,
      runtime: variant.executionProfile.runtime,
      workspace: "fresh-copy",
      ...(codex ? { codexHome: "fresh-per-attempt" } : { providerAuth: "existing-login" }),
      nativeWeb: variant.executionProfile.nativeWeb,
      networkEnforcement: variant.executionProfile.networkPolicy === "not-enforced" ? "not-technically-enforced" : variant.executionProfile.networkPolicy,
      hostFilesystem: variant.executionProfile.filesystemBoundary,
    },
  };
}

/** Execute exactly one supported recipe × variant item. Failed attempts remain private. */
export async function executeRecipe({
  repoRoot,
  catalog,
  recipe,
  variant,
  executable,
  env = {},
  now = new Date(),
  nonce = randomBytes(4).toString("hex"),
  runSession,
  verifyIdentity,
  authPath,
} = {}) {
  const stamp = runStamp(now);
  const attemptId = `attempt_${safeId(recipe.id)}_${safeId(variant.id)}_${stamp}_${safeId(nonce)}`;
  const runtimeRoot = path.join(repoRoot, "private", "runtime");
  const attemptDir = path.join(runtimeRoot, "attempts", attemptId);
  const workspace = path.join(attemptDir, "workspace");
  const rawDir = path.join(attemptDir, "raw");
  const codexHome = path.join(attemptDir, "codex-home");
  const codex = variant.harness === "codex-cli";
  const cursor = variant.harness === "cursor-agent";
  if (!codex && !cursor) throw new Error(`Unsupported execution harness: ${variant.harness}`);
  const selectedExecutable = executable ?? (cursor ? "cursor-agent" : "codex");
  const selectedSession = runSession ?? (cursor ? runCursorSession : runCodexSession);
  const selectedVerifier = verifyIdentity ?? (cursor ? verifyCursorIdentity : verifyObservedIdentity);
  const authSource = authPath ?? env.TASTE_CODEX_AUTH_PATH ?? path.join(os.homedir(), ".codex", "auth.json");
  await mkdir(path.dirname(attemptDir), { recursive: true });
  await mkdir(attemptDir, { recursive: false });
  await mkdir(rawDir, { recursive: true });
  try {
    if (variant.executionProfile?.runtime !== `${process.platform}-host`) {
      throw new Error(`Execution profile requires ${variant.executionProfile?.runtime}; current runtime is ${process.platform}-host`);
    }
    // The immutable revision exists before the first real attempt, so a later
    // catalog edit cannot rebind an accepted Dish or recovery request.
    if (recipe.sourcePath && catalog.root) {
      await freezeRecipeRevision(repoRoot, recipe);
      await freezeConfigurationRevision(repoRoot, variant);
      recipe.fixtureIntegrityRequired = true;
    }
    if (codex) await prepareAttemptCodexHome(codexHome, authSource);
    await prepareWorkspace(repoRoot, recipe, workspace);
    const request = requestedManifest(catalog, recipe, variant, attemptId, now.toISOString());
    await writeJsonAtomic(path.join(attemptDir, "requested.json"), request);
    const result = await selectedSession({ variant, recipe, workspace, privateDir: rawDir, codexHome, executable: selectedExecutable, env });
    await writeJsonAtomic(path.join(attemptDir, "execution.json"), {
      cliVersion: result.cliVersion,
      threadId: result.threadId,
      failure: result.failure,
      turns: result.turns.map((turn) => ({
        turnId: turn.turnId,
        argv: turn.argv,
        eventsPath: relativeEvidence(attemptDir, turn.eventsPath),
        stderrPath: relativeEvidence(attemptDir, turn.stderrPath),
        finalPath: relativeEvidence(attemptDir, turn.finalPath),
        usage: turn.usage ?? null,
      })),
    });
    if (result.failure) throw new Error(`Codex turn ${result.failure.turnId} failed: ${result.failure.message}`);
    if (result.turns.length !== recipe.turns.length) throw new Error(`Captured ${result.turns.length}/${recipe.turns.length} scripted turns`);
    const observed = await selectedVerifier({ codexHome, threadId: result.threadId, variant, cliVersion: result.cliVersion, result });
    await writeJsonAtomic(path.join(attemptDir, "observed.json"), {
      ...observed,
      rolloutPath: observed.rolloutPath ? path.relative(runtimeRoot, observed.rolloutPath).split(path.sep).join("/") : undefined,
    });
    const finalizedAt = new Date();
    const publication = await finalizeAttempt({
      repoRoot, catalog, recipe, variant, attemptId, attemptDir, workspace, result, observed,
      executedAt: request.startedAt, finalizedAt, env,
    });
    await writeJsonAtomic(path.join(attemptDir, "state.json"), {
      status: "accepted",
      dishId: publication.dishId,
      executedAt: request.startedAt,
      finalizedAt: finalizedAt.toISOString(),
    });
    return publication;
  } catch (error) {
    await writeJsonAtomic(path.join(attemptDir, "state.json"), { status: "failed", stage: error.stage ?? "execution", message: error.message, failedAt: new Date().toISOString() });
    return { status: "failed", attemptId, attemptDir, error: error.message };
  }
}

/** Execute the supported rows in a precomputed plan; unsupported rows remain explicit. */
export async function executePlan({ repoRoot, catalog, plan, ...options }) {
  const byId = new Map(catalog.recipes.map((recipe) => [recipe.id, recipe]));
  const results = [];
  for (const item of plan.supported) {
    results.push(await executeRecipe({ repoRoot, catalog, recipe: byId.get(item.recipeId), variant: plan.variant, ...options }));
  }
  return {
    schemaVersion: 1,
    variant: plan.variant,
    results,
    unsupported: plan.unsupported,
    accepted: results.filter((result) => result.status === "accepted"),
    failed: results.filter((result) => result.status === "failed"),
  };
}
