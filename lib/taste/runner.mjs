import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import {
  copyTree,
  within,
  writeJsonAtomic,
} from "./files.mjs";
import { fixtureSourceFile } from "./catalog.mjs";
import { describeTree } from "./files.mjs";
import { compatibilityFor, resolveHarnessAdapter } from "./harness-adapters.mjs";
import { finalizeAttempt } from "./publication.mjs";
import { freezeConfigurationRevision, freezeRecipeRevision } from "./revisions.mjs";
import { freezeSkillRevision, resolveSkill, skillCompatibility } from "./skills.mjs";

function safeId(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
}

function runStamp(now) {
  return now.toISOString().replace(/[-:.TZ]/g, "");
}

function relativeEvidence(root, value) {
  return value ? path.relative(root, value).split(path.sep).join("/") : null;
}

function skillMount(recipe) {
  return recipe.skills?.mountAs ?? "skill";
}

async function prepareWorkspace(repoRoot, recipe, workspace, skill) {
  await mkdir(workspace, { recursive: false });
  const recipeDirectory = path.dirname(path.join(repoRoot, recipe.sourcePath));
  for (const fixture of recipe.setup.fixtures) {
    await copyTree(fixtureSourceFile(repoRoot, recipeDirectory, recipe, fixture), within(workspace, fixture.mountAs, `fixture mount ${fixture.id}`));
  }
  // The skill layer is the only workspace difference between layers of one
  // Recipe Revision. Its bytes are frozen separately and checked after the run.
  if (skill) await copyTree(skill.root, within(workspace, skillMount(recipe), "skill mount"));
  await mkdir(path.join(workspace, "output"), { recursive: true });
}

async function assertSkillUntouched(workspace, recipe, skill) {
  if (!skill) return;
  const described = await describeTree(within(workspace, skillMount(recipe), "skill mount"));
  if (described.treeHash !== skill.treeHash) {
    const error = new Error(`Skill layer ${skill.id} changed during execution`);
    error.stage = "validation";
    throw error;
  }
}

function requestedManifest(catalog, recipe, variant, adapter, attemptId, startedAt, skill) {
  return {
    schemaVersion: 1,
    attemptId,
    startedAt,
    workspace: "workspace/",
    recipe: { id: recipe.id, version: recipe.version, hash: recipe.recipeHash, fixtureHashes: recipe.fixtureHashes },
    skill: skill ? { id: skill.id, hash: skill.skillHash, treeHash: skill.treeHash, mountAs: skillMount(recipe) } : null,
    identity: {
      variantId: variant.id,
      provider: variant.provider,
      model: variant.model,
      harness: variant.harness,
      reasoningEffort: variant.reasoningEffort,
      serviceTier: variant.serviceTier,
      personality: variant.personality,
      capabilities: variant.capabilities,
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
      ...adapter.requestedExecution(),
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
  allowStatuses,
  skill = null,
} = {}) {
  const resolved = resolveHarnessAdapter(variant);
  const adapter = resolved.adapter;
  variant = resolved.variant;
  const compatibility = compatibilityFor({ variant, recipe, ...(allowStatuses ? { allowStatuses } : {}) });
  const skillReasons = skillCompatibility(recipe, skill);
  if (!compatibility.supported || skillReasons.length) throw new Error(`Unsupported recipe/configuration: ${[...compatibility.reasons, ...skillReasons].join("; ")}`);
  if (recipe.missingPrivateFixtures?.length) throw new Error(`Private fixtures are absent on this machine: ${recipe.missingPrivateFixtures.join(", ")}`);
  const stamp = runStamp(now);
  const attemptId = `attempt_${safeId(recipe.id)}_${safeId(variant.id)}${skill ? `_${safeId(skill.id)}` : ""}_${stamp}_${safeId(nonce)}`;
  const runtimeRoot = path.join(repoRoot, "private", "runtime");
  const attemptDir = path.join(runtimeRoot, "attempts", attemptId);
  const workspace = path.join(attemptDir, "workspace");
  const rawDir = path.join(attemptDir, "raw");
  const codexHome = path.join(attemptDir, "codex-home");
  const selectedExecutable = executable ?? adapter.executable;
  const selectedSession = runSession ?? adapter.execute;
  const selectedVerifier = verifyIdentity ?? adapter.verifyIdentity;
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
      if (skill) await freezeSkillRevision(repoRoot, skill);
      recipe.fixtureIntegrityRequired = true;
    }
    await adapter.prepareAttempt({ codexHome, authPath, executable: selectedExecutable, env, cwd: attemptDir });
    await prepareWorkspace(repoRoot, recipe, workspace, skill);
    const request = requestedManifest(catalog, recipe, variant, adapter, attemptId, now.toISOString(), skill);
    await writeJsonAtomic(path.join(attemptDir, "requested.json"), request);
    const result = await selectedSession({ variant, recipe, workspace, privateDir: rawDir, codexHome, executable: selectedExecutable, env });
    await writeJsonAtomic(path.join(attemptDir, "execution.json"), {
      cliVersion: result.cliVersion,
      threadId: result.threadId,
      observedModel: result.observedModel ?? null,
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
    await assertSkillUntouched(workspace, recipe, skill);
    const finalizedAt = new Date();
    const publication = await finalizeAttempt({
      repoRoot, catalog, recipe, variant, skill, attemptId, attemptDir, workspace, result, observed,
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
  const skill = resolveSkill(catalog, plan.skill?.id);
  if (plan.skill && skill.skillHash !== plan.skill.hash) throw new Error(`Skill layer ${skill.id} changed since this plan was made`);
  const checked = plan.supported.map((item) => {
    const recipe = byId.get(item.recipeId);
    if (!recipe) throw new Error(`Plan references unknown recipe: ${item.recipeId}`);
    const compatibility = compatibilityFor({ variant: plan.variant, recipe, ...(options.allowStatuses ? { allowStatuses: options.allowStatuses } : {}) });
    if (!compatibility.supported) throw new Error(`Unsupported recipe/configuration: ${compatibility.reasons.join("; ")}`);
    return recipe;
  });
  const results = [];
  for (const recipe of checked) {
    // A stale or hand-built plan cannot bypass the same allowlisted boundary.
    resolveHarnessAdapter(plan.variant);
    results.push(await executeRecipe({ repoRoot, catalog, recipe, variant: plan.variant, skill, ...options }));
  }
  return {
    schemaVersion: 1,
    variant: plan.variant,
    skill: plan.skill ?? null,
    results,
    unsupported: plan.unsupported,
    accepted: results.filter((result) => result.status === "accepted"),
    failed: results.filter((result) => result.status === "failed"),
  };
}
