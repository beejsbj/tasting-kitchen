import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";

import { hashCanonical } from "./catalog.mjs";
import { CHEF_FAULTS } from "./faults.mjs";
import { isPersonalEnvironment } from "./environments.mjs";
import {
  assertPublicTextSafe,
  copySelectedFiles,
  describeTree,
  matchesAny,
  pathExists,
  scanPublicTree,
  scanWebArtifactNetwork,
  walkFiles,
  within,
  writeJsonAtomic,
} from "./files.mjs";
import { createReceipt, INPUTS_DIRECTORY, readDishSidecars, writeDishSidecars } from "./receipts.mjs";
import { fixtureBytes, publicValidation, publishDirectory, sanitizePublicResponse, setupReceipt } from "./publication.mjs";

/**
 * A No Dish is the public plate of a chef fault: the configuration was given the
 * Recipe and could not make it. It is immutable, sits at recipe hash ×
 * configuration × skill layer exactly like a Dish, and counts as coverage.
 *
 * It holds only what is safe to show: the stage, a plain reason, the validation
 * receipt, the public trace up to the failure, and a partial artifact only when
 * it passes the public scans. A kitchen fault never becomes a No Dish.
 */
export const NO_DISH_MANIFEST = "no-dish.json";

const NO_DISH_ID = /^nodish_[a-zA-Z0-9_-]+$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const STAGES = new Set(["execution", "validation"]);
const KINDS = new Set(["web", "image", "code", "session", "document", "audio"]);

export function noDishIdForAttempt(attemptId) {
  if (!/^attempt_[a-zA-Z0-9_-]+$/u.test(attemptId)) throw new Error(`Unsafe attempt id: ${attemptId}`);
  return `nodish_${attemptId.slice("attempt_".length)}`;
}

export function noDishDirectory(repoRoot, noDishId, { isPrivate = false } = {}) {
  return isPrivate ? path.join(repoRoot, "private", "no-dishes", noDishId) : path.join(repoRoot, "no-dishes", noDishId);
}

/** The turns the model reached, prompts as sent and responses as public-safe text. A failed turn has no response. */
function partialTranscript(recipe, result, workspace) {
  const reached = recipe.turns.slice(0, Math.max(1, result?.turns?.length ?? 0));
  return {
    schemaVersion: 1,
    recipeId: recipe.id,
    partial: true,
    turns: reached.map((turn, index) => {
      const message = result?.turns?.[index]?.finalMessage;
      return {
        id: turn.id,
        role: turn.role,
        prompt: index === 0 ? `${recipe.setup.instructions}\n\n${turn.content}` : turn.content,
        response: typeof message === "string" ? sanitizePublicResponse(message, { workspace, selectedFiles: [] }) : null,
        usage: result?.turns?.[index]?.usage ?? null,
      };
    }),
  };
}

/** Files the output contract would select, without demanding the entry: what the model left, if it fits the limits. */
async function partialSelection(workspace, output) {
  if (!await pathExists(workspace)) return null;
  const files = (await walkFiles(workspace)).filter((relative) => matchesAny(relative, output.include)).sort();
  if (files.length === 0 || files.length > output.limits.maxFiles) return null;
  return { files };
}

/** Try one optional piece; anything that is not public-safe is left out rather than blocking the plate. */
async function optional(action, cleanup) {
  try { return await action(); }
  catch {
    await cleanup?.();
    return null;
  }
}

/**
 * Publish the No Dish for a chef-fault attempt. `fault` must be a chef class
 * from classifyFailure. Returns the manifest, or throws when even the bare
 * plate cannot be published safely (the attempt then stays private).
 */
export async function publishNoDish({
  repoRoot, catalog, catalogHash = catalog?.catalogHash, recipe, variant, skill = null, attemptId, attemptDir, workspace,
  result = null, observed = null, checks = null, fault, executedAt, failedAt = new Date(), publishPersonal = false, setup = null,
} = {}) {
  if (fault?.class !== "chef" || !Object.hasOwn(CHEF_FAULTS, fault.code)) throw new Error("Only a chef fault becomes a No Dish");
  if (!STAGES.has(fault.stage)) throw new Error(`A No Dish records an execution or validation fault, not ${fault.stage}`);
  const id = noDishIdForAttempt(attemptId);
  const isPrivate = recipe.visibility === "private" || (isPersonalEnvironment(variant) && !publishPersonal);
  const destination = noDishDirectory(repoRoot, id, { isPrivate });
  if (await pathExists(destination)) throw new Error(`No Dish already exists and will not be overwritten: ${id}`);
  const staging = path.join(attemptDir, "no-dish-staging");
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  try {
    const validation = checks ? await optional(async () => {
      const report = publicValidation(checks);
      assertPublicTextSafe(JSON.stringify(report), "validation receipt");
      await writeJsonAtomic(path.join(staging, "validation.json"), report);
      return { passed: false, report: "validation.json" };
    }, () => rm(path.join(staging, "validation.json"), { force: true })) : null;
    const trace = await optional(async () => {
      const transcript = partialTranscript(recipe, result, workspace);
      assertPublicTextSafe(JSON.stringify(transcript), "partial trace");
      await writeJsonAtomic(path.join(staging, "trace.json"), transcript);
      return "trace.json";
    }, () => rm(path.join(staging, "trace.json"), { force: true }));
    const artifactRoot = path.join(staging, "artifact");
    const artifact = recipe.output.kind === "session" ? null : await optional(async () => {
      const selection = await partialSelection(workspace, recipe.output);
      if (!selection) return null;
      await mkdir(artifactRoot, { recursive: true });
      await copySelectedFiles(workspace, artifactRoot, selection);
      const described = await describeTree(artifactRoot);
      if (described.files.reduce((total, file) => total + file.bytes, 0) > recipe.output.limits.maxBytes) throw new Error("Partial artifact exceeds the byte limit");
      await scanPublicTree(artifactRoot);
      if (recipe.output.kind === "web") await scanWebArtifactNetwork(artifactRoot);
      return {
        kind: recipe.output.kind,
        ...(selection.files.includes(recipe.output.entry) ? { entry: `artifact/${recipe.output.entry}` } : {}),
        files: described.files.map((file) => ({ ...file, path: `artifact/${file.path}` })),
        treeHash: described.treeHash,
        partial: true,
      };
    }, () => rm(artifactRoot, { recursive: true, force: true }));

    const failedChecks = (checks?.checks ?? []).filter((check) => check.required && !check.passed).map((check) => check.id);
    const withoutHash = {
      schemaVersion: 1,
      id,
      outcome: "no-dish",
      recipe: { id: recipe.id, version: recipe.version, hash: recipe.recipeHash },
      ...(skill ? { skill: { id: skill.id, hash: skill.skillHash } } : {}),
      ...(isPrivate ? { visibility: "private" } : {}),
      executedAt: new Date(executedAt).toISOString(),
      failedAt: new Date(failedAt).toISOString(),
      identity: {
        variantId: variant.id,
        provider: variant.provider,
        requestedModel: variant.model,
        observedModel: observed?.model ?? result?.observedModel ?? null,
        harness: variant.harness,
        harnessVersion: result?.cliVersion ?? null,
        reasoningEffort: variant.reasoningEffort,
        serviceTier: variant.serviceTier,
        configHash: variant.configHash,
        ...(catalogHash ? { catalogHash } : {}),
        // Coverage of a snapshot cell is per setup digest, for a No Dish as for a Dish.
        ...(variant.executionProfile.environment === "snapshot" && setup?.digest ? { setupDigest: setup.digest } : {}),
      },
      fault: {
        class: "chef",
        code: fault.code,
        stage: fault.stage,
        reason: fault.reason,
        ...(result?.failure?.turnId ? { turn: result.failure.turnId } : {}),
        ...(failedChecks.length ? { checks: failedChecks } : {}),
      },
      validation,
      publicTrace: trace,
      artifact,
    };
    const manifest = { ...withoutHash, noDishHash: hashCanonical(withoutHash) };
    await writeJsonAtomic(path.join(staging, NO_DISH_MANIFEST), manifest);
    await writeDishSidecars(staging, {
      recipe: { id: recipe.id, recipeHash: recipe.recipeHash },
      fixtures: await fixtureBytes(repoRoot, recipe),
      receipt: createReceipt(variant, skill, recipe, setupReceipt(setup, observed)),
    });
    await scanPublicTree(staging, { verbatim: [INPUTS_DIRECTORY] });
    await publishDirectory(staging, destination);
    return { status: "no-dish", noDishId: id, directory: destination, manifest };
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

const NO_DISH_KEYS = ["schemaVersion", "id", "outcome", "recipe", "skill", "visibility", "executedAt", "failedAt", "identity", "fault", "validation", "publicTrace", "artifact", "noDishHash"];
const IDENTITY_KEYS = ["variantId", "provider", "requestedModel", "observedModel", "harness", "harnessVersion", "reasoningEffort", "serviceTier", "configHash", "catalogHash", "setupDigest"];
const FAULT_KEYS = ["class", "code", "stage", "reason", "turn", "checks"];

function invalid(id, message) {
  return new Error(`Invalid No Dish ${id}: ${message}`);
}

function onlyKeys(value, allowed, id, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid(id, `${label} must be an object`);
  const extra = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extra.length) throw invalid(id, `${label} has unknown keys: ${extra.join(", ")}`);
}

function text(value, id, label, { nullable = false } = {}) {
  if (nullable && value === null) return;
  if (typeof value !== "string" || value.trim() === "") throw invalid(id, `${label} must be a non-empty string`);
}

/** Validate one manifest and its directory. A kitchen fault in the public tree is refused outright. */
export async function validateNoDish(directory, manifest, { publicScan = true } = {}) {
  const id = manifest?.id ?? path.basename(directory);
  onlyKeys(manifest, NO_DISH_KEYS, id, "manifest");
  if (manifest.schemaVersion !== 1) throw invalid(id, "schemaVersion must be 1");
  if (!NO_DISH_ID.test(manifest.id ?? "") || manifest.id !== path.basename(directory)) throw invalid(id, "id must be a No Dish id matching its directory");
  if (manifest.outcome !== "no-dish") throw invalid(id, "outcome must be no-dish");
  onlyKeys(manifest.recipe, ["id", "version", "hash"], id, "recipe");
  if (!SHA256.test(manifest.recipe.hash ?? "")) throw invalid(id, "recipe.hash must be a sha256 hash");
  if (manifest.skill !== undefined) {
    onlyKeys(manifest.skill, ["id", "hash"], id, "skill");
    if (!SHA256.test(manifest.skill.hash ?? "")) throw invalid(id, "skill.hash must be a sha256 hash");
  }
  if (publicScan && manifest.visibility === "private") throw invalid(id, "a private No Dish is stored in the public tree");
  for (const key of ["executedAt", "failedAt"]) {
    const value = manifest[key];
    if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw invalid(id, `${key} must be a UTC ISO date-time (so the newest sorts last)`);
  }
  onlyKeys(manifest.identity, IDENTITY_KEYS, id, "identity");
  for (const key of ["variantId", "provider", "requestedModel", "harness", "reasoningEffort", "serviceTier"]) text(manifest.identity[key], id, `identity.${key}`);
  for (const key of ["observedModel", "harnessVersion"]) text(manifest.identity[key], id, `identity.${key}`, { nullable: true });
  if (!SHA256.test(manifest.identity.configHash ?? "")) throw invalid(id, "identity.configHash must be a sha256 hash");
  onlyKeys(manifest.fault, FAULT_KEYS, id, "fault");
  // The fairness rule, enforced at rest: only a chef fault is ever a public plate.
  if (manifest.fault.class !== "chef") throw invalid(id, "only a chef fault may be a No Dish");
  if (!Object.hasOwn(CHEF_FAULTS, manifest.fault.code)) throw invalid(id, `unknown chef fault ${manifest.fault.code}`);
  if (!STAGES.has(manifest.fault.stage)) throw invalid(id, "fault.stage must be execution or validation");
  text(manifest.fault.reason, id, "fault.reason");
  // The public reason is fixed text per code, never anything that came from the failure itself.
  if (manifest.fault.reason !== CHEF_FAULTS[manifest.fault.code]) throw invalid(id, "fault.reason must be the fixed reason for its code");
  if (manifest.fault.turn !== undefined) text(manifest.fault.turn, id, "fault.turn");
  if (manifest.fault.checks !== undefined && (!Array.isArray(manifest.fault.checks) || manifest.fault.checks.some((check) => typeof check !== "string"))) throw invalid(id, "fault.checks must list check ids");
  if (manifest.validation !== null) {
    onlyKeys(manifest.validation, ["passed", "report"], id, "validation");
    if (manifest.validation.passed !== false || manifest.validation.report !== "validation.json") throw invalid(id, "validation must point at a failed validation.json");
    if (!await pathExists(path.join(directory, "validation.json"))) throw invalid(id, "validation.json is missing");
  }
  if (manifest.publicTrace !== null) {
    if (manifest.publicTrace !== "trace.json") throw invalid(id, "publicTrace must be trace.json or null");
    if (!await pathExists(path.join(directory, "trace.json"))) throw invalid(id, "trace.json is missing");
  }
  if (manifest.artifact !== null) {
    onlyKeys(manifest.artifact, ["kind", "entry", "files", "treeHash", "partial"], id, "artifact");
    if (!KINDS.has(manifest.artifact.kind) || manifest.artifact.partial !== true) throw invalid(id, "artifact must be a partial artifact of a known kind");
    const described = await describeTree(within(directory, "artifact", "partial artifact"));
    if (described.treeHash !== manifest.artifact.treeHash) throw invalid(id, "partial artifact bytes do not match their tree hash");
  }
  // The hash covers everything but itself.
  const { noDishHash, ...withoutHash } = manifest;
  if (noDishHash !== hashCanonical(withoutHash)) throw invalid(id, "noDishHash does not match the manifest");
  if (publicScan) {
    await readDishSidecars(directory);
    await scanPublicTree(directory, { verbatim: [INPUTS_DIRECTORY] });
  }
  return manifest;
}

async function loadNoDishTree(root, { publicScan }) {
  if (!await pathExists(root)) return [];
  const entries = (await readdir(root, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
  const plates = [];
  for (const entry of entries) {
    // Dot-directories are in-flight publications (see publishDirectory).
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const directory = path.join(root, entry.name);
    plates.push(await validateNoDish(directory, JSON.parse(await readFile(path.join(directory, NO_DISH_MANIFEST), "utf8")), { publicScan }));
  }
  return plates.sort((a, b) => a.executedAt.localeCompare(b.executedAt) || a.id.localeCompare(b.id));
}

/** Public No Dishes under `no-dishes/`. */
export function loadNoDishes(repoRoot) {
  return loadNoDishTree(path.join(repoRoot, "no-dishes"), { publicScan: true });
}

/** No Dishes of private Recipes and unpublished personal environments. Never published. */
export function loadPrivateNoDishes(repoRoot) {
  return loadNoDishTree(path.join(repoRoot, "private", "no-dishes"), { publicScan: false });
}
