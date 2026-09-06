import { mkdir, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";

import { hashCanonical, sha256 } from "./catalog.mjs";
import { runChecks } from "./checks.mjs";
import {
  assertPublicTextSafe,
  copySelectedFiles,
  describeTree,
  pathExists,
  scanPublicTree,
  scanWebArtifactNetwork,
  selectArtifactFiles,
  within,
  writeJsonAtomic,
} from "./files.mjs";

export class FinalizationError extends Error {
  constructor(stage, message, options) {
    super(message, options);
    this.name = "FinalizationError";
    this.stage = stage;
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

function publicValidation(checks) {
  return {
    schemaVersion: 1,
    passed: true,
    checks: checks.checks.map(({ id, type, required, description, passed, advisory, detail }) => ({
      id, type, required, description, passed, ...(advisory ? { advisory } : {}), detail,
    })),
  };
}

export function dishIdForAttempt(attemptId) {
  if (!/^attempt_[a-zA-Z0-9_-]+$/u.test(attemptId)) throw new Error(`Unsafe attempt id: ${attemptId}`);
  return `dish_${attemptId.slice("attempt_".length)}`;
}

/** Shared, model-free publication path for fresh executions and recovery. */
export async function finalizeAttempt({
  repoRoot,
  catalog,
  recipe,
  variant,
  attemptId,
  attemptDir,
  workspace,
  result,
  observed,
  executedAt,
  finalizedAt = new Date(),
  recovered = false,
  env = process.env,
} = {}) {
  const staging = path.join(attemptDir, "public-staging");
  const dishId = dishIdForAttempt(attemptId);
  const dishDirectory = path.join(repoRoot, "dishes", dishId);
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
    let selection = await selectArtifactFiles(workspace, recipe.output);
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
      if (actual !== expected) throw new FinalizationError("validation", `Fixture ${fixture.id} changed during execution`);
    }
    const checks = await runChecks(recipe, workspace, { env });
    await writeJsonAtomic(path.join(attemptDir, recovered ? "validation.recovery.json" : "validation.raw.json"), checks);
    if (!checks.passed) {
      const failed = checks.checks.filter((check) => check.required && !check.passed).map((check) => check.id);
      throw new FinalizationError("validation", `Required validation failed: ${failed.join(", ")}`);
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
        catalogHash: catalog.catalogHash,
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
    await scanPublicTree(staging);
    await mkdir(path.dirname(dishDirectory), { recursive: true });
    await rename(staging, dishDirectory);
    return { status: "accepted", attemptId, dishId, dishDirectory, manifest: dish, recovered };
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    if (error instanceof FinalizationError) throw error;
    throw new FinalizationError("publication", error.message, { cause: error });
  }
}
