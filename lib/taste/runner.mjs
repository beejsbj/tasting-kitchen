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
import { usesConnections } from "./environments.mjs";
import { compatibilityFor, resolveHarnessAdapter, skillDeliverySupport } from "./harness-adapters.mjs";
import { onInterrupt } from "./interrupt.mjs";
import { classifyFailure, refusalInTurns } from "./faults.mjs";
import { publishNoDish } from "./no-dishes.mjs";
import { finalizeAttempt } from "./publication.mjs";
import { assertIsolatedWorkspace, createCookDirectory } from "./runtime-root.mjs";
import { applySkillToRecipe, resolveSkill, skillCompatibility } from "./skills.mjs";

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
  // recipe hash. Its tree hash is checked after the run.
  if (skill && skill.delivery !== "prompt") await copyTree(skill.root, within(workspace, skillMount(recipe), "skill mount"));
  await mkdir(path.join(workspace, "output"), { recursive: true });
}

async function assertSkillUntouched(workspace, recipe, skill) {
  if (!skill || skill.delivery === "prompt") return;
  const described = await describeTree(within(workspace, skillMount(recipe), "skill mount"));
  if (described.treeHash !== skill.treeHash) {
    const error = new Error(`Skill layer ${skill.id} changed during execution`);
    error.stage = "validation";
    // Only the model touched the mounted skill: editing it breaks the output contract.
    error.chefFault = "output-contract";
    throw error;
  }
}

/**
 * The exact request frozen beside an attempt. Recovery rebuilds the configuration, the publish choice
 * and, for a snapshot, the setup digest from it: the copy itself may change during the run.
 */
export function requestedManifest(catalog, recipe, variant, adapter, attemptId, startedAt, skill, publishPersonal = false, setup = null, cookDirectory = undefined) {
  return {
    schemaVersion: 1,
    attemptId,
    startedAt,
    // The workspace and harness homes sit in this cook directory, outside the repo.
    ...(cookDirectory ? { cookDirectory } : {}),
    workspace: "workspace/",
    recipe: { id: recipe.id, version: recipe.version, hash: recipe.recipeHash, fixtureHashes: recipe.fixtureHashes },
    skill: skill ? { id: skill.id, hash: skill.skillHash, treeHash: skill.treeHash, delivery: skill.delivery, ...(skill.delivery === "prompt" ? {} : { mountAs: skillMount(recipe) }) } : null,
    identity: {
      variantId: variant.id,
      provider: variant.provider,
      model: variant.model,
      harness: variant.harness,
      reasoningEffort: variant.reasoningEffort,
      serviceTier: variant.serviceTier,
      personality: variant.personality,
      capabilities: variant.capabilities,
      ...(variant.harnessPath !== undefined ? { harnessPath: variant.harnessPath } : {}),
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
      ...adapter.requestedExecution(variant),
      nativeWeb: variant.executionProfile.nativeWeb,
      networkEnforcement: variant.executionProfile.networkPolicy === "not-enforced" ? "not-technically-enforced" : variant.executionProfile.networkPolicy,
      hostFilesystem: variant.executionProfile.filesystemBoundary,
      ...(variant.executionProfile.environment !== undefined ? { environment: variant.executionProfile.environment } : {}),
      ...(variant.executionProfile.harnessProfile !== undefined ? { harnessProfile: variant.executionProfile.harnessProfile } : {}),
      ...(variant.executionProfile.memory !== undefined ? { memory: variant.executionProfile.memory } : {}),
      ...(variant.executionProfile.connections !== undefined ? { connections: variant.executionProfile.connections } : {}),
      ...(variant.executionProfile.route !== undefined ? { route: variant.executionProfile.route } : {}),
      ...(variant.executionProfile.upstream !== undefined ? { upstream: variant.executionProfile.upstream } : {}),
    },
    ...(setup ? { setup } : {}),
    publishPersonal,
  };
}

// How long an interrupted attempt gets to wind down before it is cleaned up regardless.
const INTERRUPT_GRACE_MS = 10_000;

/**
 * Execute exactly one supported recipe × variant item. A failed attempt is
 * classified (faults.mjs): a kitchen fault stays private and retryable; a chef
 * fault also publishes a No Dish, so the cell shows the model could not make it.
 */
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
  publishPersonal = false,
  allowConnections = false,
} = {}) {
  const resolved = resolveHarnessAdapter(variant);
  const adapter = resolved.adapter;
  variant = resolved.variant;
  const compatibility = compatibilityFor({ variant, recipe, ...(allowStatuses ? { allowStatuses } : {}) });
  const skillReasons = [...skillCompatibility(recipe, skill), ...skillDeliverySupport(variant, skill)];
  if (!compatibility.supported || skillReasons.length) throw new Error(`Unsupported recipe/configuration: ${[...compatibility.reasons, ...skillReasons].join("; ")}`);
  if (recipe.missingPrivateFixtures?.length) throw new Error(`Private fixtures are absent on this machine: ${recipe.missingPrivateFixtures.join(", ")}`);
  // Connections let the model send mail or edit issues under bypassed permissions: only an explicit Cook flag allows them.
  if (usesConnections(variant) && allowConnections !== true) throw new Error(`Configuration ${variant.id} turns connections on; cook it with --allow-connections`);
  const stamp = runStamp(now);
  const attemptId = `attempt_${safeId(recipe.id)}_${safeId(variant.id)}${skill ? `_${safeId(skill.id)}` : ""}_${stamp}_${safeId(nonce)}`;
  // Private evidence stays under the repo's ignored private/ tree; the model
  // works in an opaque cook directory outside the repo (see runtime-root.mjs).
  const attemptDir = path.join(repoRoot, "private", "runtime", "attempts", attemptId);
  const rawDir = path.join(attemptDir, "raw");
  const selectedExecutable = executable ?? adapter.executable;
  const selectedSession = runSession ?? adapter.execute;
  const selectedVerifier = verifyIdentity ?? adapter.verifyIdentity;
  await mkdir(path.dirname(attemptDir), { recursive: true });
  await mkdir(attemptDir, { recursive: false });
  await mkdir(rawDir, { recursive: true });
  let cookDirectory;
  try {
    cookDirectory = await createCookDirectory({ env });
    // Before any credential or fixture is touched; repeated once the workspace is laid out.
    await assertIsolatedWorkspace(cookDirectory);
  } catch (error) {
    const fault = classifyFailure({ stage: "preparation", message: error.message });
    await writeJsonAtomic(path.join(attemptDir, "state.json"), { status: "failed", stage: "preparation", message: error.message, fault, failedAt: new Date().toISOString() });
    return { status: "failed", attemptId, attemptDir, error: error.message, fault };
  }
  const workspace = path.join(cookDirectory, "workspace");
  const codexHome = path.join(cookDirectory, "codex-home");
  // Adapters other than Codex name their own fresh per-attempt harness home.
  const harnessHome = path.join(cookDirectory, adapter.homeDirectory ?? "codex-home");
  // A failed cleanup must not replace the attempt's own result, but it must not be silent either:
  // it is kept beside the state and returned on the result, so a lingering copy of his setup or login gets noticed.
  let cleanupFailure = null;
  const cleanup = async () => {
    try { await adapter.cleanupAttempt?.({ variant, cwd: cookDirectory, harnessHome }); }
    catch (cleanupError) {
      cleanupFailure = cleanupError.message;
      await writeJsonAtomic(path.join(attemptDir, "cleanup-error.json"), { message: cleanupFailure, at: new Date().toISOString() }).catch(() => {});
    }
  };
  // Killed mid-run: stop the harness, let the attempt wind down (it checks for the interruption before each stage),
  // then discard the copied setup and borrowed login and leave a terminal state.
  let interruptedBy = null;
  let settled;
  const finished = new Promise((resolve) => { settled = resolve; });
  const interruptedState = () => ({ status: "failed", stage: "interrupted", message: `Interrupted by ${interruptedBy}`, fault: classifyFailure({ stage: "interrupted" }), failedAt: new Date().toISOString() });
  const assertNotInterrupted = () => { if (interruptedBy) throw new Error(`Interrupted by ${interruptedBy}`); };
  const disposeInterrupt = onInterrupt(async (signal) => {
    interruptedBy = signal;
    let timer;
    const timedOut = await Promise.race([
      finished.then(() => false),
      new Promise((resolve) => { timer = setTimeout(() => resolve(true), INTERRUPT_GRACE_MS); }),
    ]);
    clearTimeout(timer);
    // An attempt that settled in time wrote its own terminal state (a Dish it already published stays accepted) and cleaned up.
    if (!timedOut) return;
    await writeJsonAtomic(path.join(attemptDir, "state.json"), interruptedState()).catch(() => {});
    await cleanup();
  });
  let returned;
  // Hoisted so a chef fault can publish the No Dish with whatever the Run reached.
  let request = null;
  let setup = null;
  let layered = recipe;
  let result = null;
  let observed = null;
  try {
    if (variant.executionProfile?.runtime !== `${process.platform}-host`) {
      throw new Error(`Execution profile requires ${variant.executionProfile?.runtime}; current runtime is ${process.platform}-host`);
    }
    // Catalog recipes carry fixture hashes; publication re-checks the mounted
    // bytes against them, and copies the public ones beside the Dish.
    if (recipe.sourcePath && catalog.root) recipe.fixtureIntegrityRequired = true;
    // Recorded first, so a failed attempt still names its cook directory; rewritten with the setup once it is known.
    request = requestedManifest(catalog, recipe, variant, adapter, attemptId, now.toISOString(), skill, publishPersonal, null, cookDirectory);
    await writeJsonAtomic(path.join(attemptDir, "requested.json"), request);
    const prepared = await adapter.prepareAttempt({ variant, codexHome, harnessHome, authPath, executable: selectedExecutable, env, cwd: cookDirectory });
    setup = prepared?.setup ?? null;
    assertNotInterrupted();
    // A snapshot's setup record (its digest) belongs in the request recovery reads.
    if (setup) await writeJsonAtomic(path.join(attemptDir, "requested.json"), requestedManifest(catalog, recipe, variant, adapter, attemptId, now.toISOString(), skill, publishPersonal, setup, cookDirectory));
    await prepareWorkspace(repoRoot, recipe, workspace, skill);
    await assertIsolatedWorkspace(workspace);
    assertNotInterrupted();
    // The model and the public trace both see the layered recipe; the Dish keeps the base recipe hash.
    layered = applySkillToRecipe(recipe, skill);
    result = await selectedSession({ variant, recipe: layered, workspace, privateDir: rawDir, codexHome, harnessHome, executable: selectedExecutable, env, setup });
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
    if (result.failure) {
      // An adapter tags a turn failure as the model's only from structured evidence (a refusal, an exhausted turn budget).
      throw Object.assign(new Error(`${variant.harness} turn ${result.failure.turnId} failed: ${result.failure.message}`), result.failure.chefFault ? { chefFault: result.failure.chefFault } : {});
    }
    if (result.turns.length !== recipe.turns.length) throw new Error(`Captured ${result.turns.length}/${recipe.turns.length} scripted turns`);
    observed = await selectedVerifier({ codexHome, threadId: result.threadId, variant, cliVersion: result.cliVersion, result, env, recipe: layered });
    await writeJsonAtomic(path.join(attemptDir, "observed.json"), {
      ...observed,
      rolloutPath: observed.rolloutPath ? path.relative(cookDirectory, observed.rolloutPath).split(path.sep).join("/") : undefined,
    });
    await assertSkillUntouched(workspace, recipe, skill);
    const finalizedAt = new Date();
    const publication = await finalizeAttempt({
      repoRoot, catalog, recipe: layered, variant, skill, attemptId, attemptDir, workspace, result, observed,
      executedAt: request.startedAt, finalizedAt, env, publishPersonal, setup,
    });
    await writeJsonAtomic(path.join(attemptDir, "state.json"), {
      status: "accepted",
      dishId: publication.dishId,
      executedAt: request.startedAt,
      finalizedAt: finalizedAt.toISOString(),
    });
    returned = publication;
    return publication;
  } catch (error) {
    // The killed harness fails its turn; that is the interruption's doing, not a second story.
    if (interruptedBy) {
      const state = interruptedState();
      await writeJsonAtomic(path.join(attemptDir, "state.json"), state);
      returned = { status: "failed", attemptId, attemptDir, error: error.message, fault: state.fault };
      return returned;
    }
    const stage = error.stage ?? "execution";
    // A failed output whose turns carry a structured refusal was declined, not botched.
    const chefFault = error.chefFault && ["checks-failed", "output-contract"].includes(error.chefFault) && refusalInTurns(result?.turns) ? "refused" : error.chefFault;
    const fault = classifyFailure({ stage, message: error.message, chefFault, kitchenFault: error.kitchenFault });
    let noDish = null;
    let noDishError = null;
    if (fault.class === "chef") {
      try {
        noDish = await publishNoDish({
          repoRoot, catalog, recipe: layered, variant, skill, attemptId, attemptDir, workspace, result, observed, checks: error.checks ?? null, fault,
          executedAt: request?.startedAt ?? now.toISOString(), publishPersonal, setup,
        });
      } catch (publishError) {
        // The plate could not be published safely: the attempt stays private, and the cell stays open.
        noDishError = publishError.message;
      }
    }
    await writeJsonAtomic(path.join(attemptDir, "state.json"), {
      status: "failed", stage, message: error.message, fault, failedAt: new Date().toISOString(),
      ...(noDish ? { noDishId: noDish.noDishId } : {}), ...(noDishError ? { noDishError } : {}),
    });
    returned = { status: "failed", attemptId, attemptDir, error: error.message, fault, ...(noDish ? { noDishId: noDish.noDishId } : {}), ...(noDishError ? { noDishError } : {}) };
    return returned;
  } finally {
    // A borrowed login or a copied setup must not outlive the attempt, whichever way it ended.
    disposeInterrupt();
    await cleanup();
    if (cleanupFailure && returned) returned.cleanupError = cleanupFailure;
    settled();
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
    if (recipe.recipeHash !== item.recipeHash) throw new Error(`Recipe ${recipe.id} changed since this plan was made`);
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
    // Chef faults that became public plates: the cell is covered by what the model could not make.
    noDishes: results.filter((result) => result.noDishId),
  };
}
