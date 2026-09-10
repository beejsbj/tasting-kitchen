import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { computeConfigHash } from "../lib/taste/catalog.mjs";
import { pathExists } from "../lib/taste/files.mjs";
import { sanitizePublicResponse } from "../lib/taste/publication.mjs";
import { recoverAttempt } from "../lib/taste/recovery.mjs";
import { freezeConfigurationRevision } from "../lib/taste/revisions.mjs";

const THREAD_ID = "01901234-5678-7abc-8def-0123456789ab";
const ATTEMPT_ID = "attempt_demo-web_codex-sol-high_20260814200923790_test";

async function json(filename, value) {
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, `${JSON.stringify(value, null, 2)}\n`);
}

function variant({ fastAlias = false } = {}) {
  const value = {
    id: fastAlias ? "codex-luna-low-fast" : "codex-sol-high",
    label: fastAlias ? "Luna · Low · Fast · via Codex CLI · host-unsandboxed fallback" : "Sol · High · via Codex CLI · host-unsandboxed fallback",
    provider: "openai",
    model: fastAlias ? "gpt-5.6-luna" : "gpt-5.6-sol",
    harness: "codex-cli",
    reasoningEffort: fastAlias ? "low" : "high",
    serviceTier: fastAlias ? "fast" : "default",
    personality: "none",
    capabilities: ["files", "shell"],
    executionProfile: {
      id: "codex-linux-host-unsandboxed-v1",
      label: "via Codex CLI · host-unsandboxed fallback",
      runtime: "linux-host",
      sandbox: "danger-full-access",
      approvalPolicy: "never",
      nativeWeb: "disabled",
      networkPolicy: "not-enforced",
      filesystemBoundary: "not-a-secrecy-boundary",
    },
  };
  return { ...value, configHash: computeConfigHash(value) };
}

function cursorVariant() {
  const value = {
    id: "cursor-composer-2-5", label: "Cursor Composer", provider: "cursor", model: "composer-2.5[fast=false]",
    harness: "cursor-agent", reasoningEffort: "adaptive", serviceTier: "default", personality: "default", capabilities: ["files", "shell"],
    executionProfile: { id: "cursor-linux-host-unsandboxed-v1", label: "via Cursor Agent · host-unsandboxed", runtime: "linux-host", sandbox: "disabled", approvalPolicy: "force", nativeWeb: "not-enforced", networkPolicy: "not-enforced", filesystemBoundary: "not-a-secrecy-boundary" },
  };
  return { ...value, configHash: computeConfigHash(value) };
}

async function recoveryFixture({ fastAlias = false, observedTier = "priority", observedModel } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "taste-recovery-"));
  const attemptDir = path.join(root, "private/runtime/attempts", ATTEMPT_ID);
  const workspace = path.join(attemptDir, "workspace");
  const raw = path.join(attemptDir, "raw/turns/001-build");
  const codexSessions = path.join(attemptDir, "codex-home/sessions/2026/08/14");
  await Promise.all([mkdir(workspace, { recursive: true }), mkdir(raw, { recursive: true }), mkdir(codexSessions, { recursive: true })]);
  await writeFile(path.join(workspace, "index.html"), "<main>Recovered artifact</main>\n");
  const absoluteArtifact = path.join(workspace, "index.html");
  const rawFinal = `Finished [index.html](${absoluteArtifact}).`;
  await writeFile(path.join(raw, "final.txt"), rawFinal);
  await writeFile(path.join(raw, "stderr.txt"), "");
  await writeFile(path.join(raw, "stdout.jsonl"), [
    { type: "thread.started", thread_id: THREAD_ID },
    { type: "turn.completed", usage: { input_tokens: 7, output_tokens: 3 } },
  ].map(JSON.stringify).join("\n") + "\n");
  const selectedVariant = variant({ fastAlias });
  await writeFile(path.join(codexSessions, `rollout-${THREAD_ID}.jsonl`), [
    { type: "session_meta", payload: { cli_version: "0.145.0", model_provider: "openai", id: THREAD_ID } },
    { type: "turn_context", payload: { model: observedModel ?? selectedVariant.model, effort: selectedVariant.reasoningEffort, personality: "none", comp_hash: "3000" } },
    { type: "event_msg", payload: { type: "thread_settings_applied", thread_settings: { model: observedModel ?? selectedVariant.model, model_provider_id: "openai", reasoning_effort: selectedVariant.reasoningEffort, personality: "none", service_tier: fastAlias ? observedTier : "default" } } },
  ].map(JSON.stringify).join("\n") + "\n");

  const recipe = {
    schemaVersion: 1,
    id: "demo-web",
    version: "1.0.0",
    status: "ready",
    title: "Build one recovered web artifact",
    summary: "A small web artifact used to prove local recovery.",
    domain: "ui-visual",
    origin: "textbook",
    originNote: "A conventional recovery test fixture.",
    tags: ["implementation"],
    kind: "web",
    harness: { workspace: "write", web: "disabled", capabilities: ["files"] },
    setup: { instructions: "Build the supplied artifact.", fixtures: [] },
    turns: [{ id: "build", role: "prompt", content: "Build index.html." }],
    output: { kind: "web", entry: "index.html", include: ["index.html"], limits: { maxFiles: 2, maxBytes: 4096 } },
    validation: { mode: "files", checks: [{ id: "entry", type: "file-exists", required: true, description: "Entry exists.", target: "index.html" }] },
    sourcePath: "catalog/recipes/ui-visual/demo-web/recipe.json",
    recipeHash: `sha256:${"1".repeat(64)}`,
    fixtureHashes: {},
  };
  const catalog = { catalogHash: `sha256:${"2".repeat(64)}`, recipes: [recipe], variants: [selectedVariant] };
  await json(path.join(attemptDir, "requested.json"), {
    schemaVersion: 1,
    attemptId: ATTEMPT_ID,
    startedAt: "2026-08-14T20:09:23.790Z",
    recipe: { id: recipe.id, version: recipe.version, hash: recipe.recipeHash, fixtureHashes: {} },
    identity: {
      variantId: selectedVariant.id,
      provider: selectedVariant.provider,
      model: selectedVariant.model,
      harness: selectedVariant.harness,
      reasoningEffort: selectedVariant.reasoningEffort,
      serviceTier: selectedVariant.serviceTier,
      personality: selectedVariant.personality,
      configHash: selectedVariant.configHash,
    },
    execution: { profileId: selectedVariant.executionProfile.id, label: selectedVariant.executionProfile.label },
  });
  await json(path.join(attemptDir, "execution.json"), {
    cliVersion: "codex-cli 0.145.0",
    threadId: THREAD_ID,
    failure: null,
    turns: [{
      turnId: "build",
      argv: fastAlias ? ["codex", "-c", 'service_tier="fast"', "--enable", "fast_mode"] : undefined,
      eventsPath: "raw/turns/001-build/stdout.jsonl",
      stderrPath: "raw/turns/001-build/stderr.txt",
      finalPath: "raw/turns/001-build/final.txt",
      usage: { input_tokens: 7, output_tokens: 3 },
    }],
  });
  await json(path.join(attemptDir, "state.json"), fastAlias
    ? { status: "failed", stage: "execution", message: "Effective Codex identity mismatch: tier requested fast, observed priority" }
    : { status: "failed", stage: "publication", message: "Public artifact scan failed: trace.json (absolute path)" });
  return { root, attemptDir, workspace, rawFinal, recipe, selectedVariant, catalog };
}

test("sanitizer rewrites only exact selected workspace files and fails closed otherwise", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "taste-sanitize-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = path.join(root, "workspace");
  await mkdir(workspace);
  const selected = path.join(workspace, "index.html");
  const raw = `See [the artifact](${selected}).`;
  assert.equal(sanitizePublicResponse(raw, { workspace, selectedFiles: ["index.html"] }), "See [the artifact](artifact/index.html).");
  assert.equal(raw.includes(selected), true, "raw evidence is not mutated");
  for (const unsafe of [
    `${workspace}/fixtures/input.json`,
    `${selected}.backup`,
    `file://${selected}`,
    "/etc/passwd",
    "~/secret.txt",
    "../private/result.txt",
    "private/runtime/result.txt",
  ]) {
    assert.throws(() => sanitizePublicResponse(unsafe, { workspace, selectedFiles: ["index.html"] }), /Public artifact scan failed/);
  }
});

test("fast-tier identity recovery requires exact argv proof, preserves both tiers, and invokes no model", async (t) => {
  const f = await recoveryFixture({ fastAlias: true });
  t.after(() => rm(f.root, { recursive: true, force: true }));
  const poison = path.join(f.root, "codex-must-not-run");
  await writeFile(poison, "not executable");
  const result = await recoverAttempt({
    repoRoot: f.root,
    catalog: f.catalog,
    attemptId: ATTEMPT_ID,
    env: { ...process.env, TASTE_CODEX_EXECUTABLE: poison },
  });
  const dish = JSON.parse(await readFile(path.join(result.dishDirectory, "dish.json"), "utf8"));
  assert.equal(dish.identity.requestedServiceTier, "fast");
  assert.equal(dish.identity.observedServiceTier, "priority");
  assert.equal(dish.identity.serviceTier, "priority");
  const observed = JSON.parse(await readFile(path.join(f.attemptDir, "observed.json"), "utf8"));
  assert.equal(observed.requestedServiceTier, "fast");
  assert.equal(observed.observedServiceTier, "priority");
  const receipt = JSON.parse(await readFile(path.join(f.attemptDir, "recovery.json"), "utf8"));
  assert.equal(receipt.modelInvoked, false);
  assert.equal(await pathExists(`${poison}.invoked`), false);
});

test("fast-tier identity recovery refuses missing argv proof and other observed identity", async (t) => {
  const nearMessage = await recoveryFixture({ fastAlias: true });
  t.after(() => rm(nearMessage.root, { recursive: true, force: true }));
  await json(path.join(nearMessage.attemptDir, "state.json"), {
    status: "failed",
    stage: "execution",
    message: "Effective Codex identity mismatch: tier requested fast, observed priority.",
  });
  await assert.rejects(recoverAttempt({ repoRoot: nearMessage.root, catalog: nearMessage.catalog, attemptId: ATTEMPT_ID }), /did not fail specifically/);

  const noProof = await recoveryFixture({ fastAlias: true });
  t.after(() => rm(noProof.root, { recursive: true, force: true }));
  const executionFile = path.join(noProof.attemptDir, "execution.json");
  const execution = JSON.parse(await readFile(executionFile, "utf8"));
  execution.turns[0].argv = ["codex", "-c", 'service_tier="fast"'];
  await json(executionFile, execution);
  await assert.rejects(recoverAttempt({ repoRoot: noProof.root, catalog: noProof.catalog, attemptId: ATTEMPT_ID }), /lacks exact fast invocation proof/);

  const wrongModel = await recoveryFixture({ fastAlias: true, observedModel: "gpt-5.6-sol" });
  t.after(() => rm(wrongModel.root, { recursive: true, force: true }));
  await assert.rejects(recoverAttempt({ repoRoot: wrongModel.root, catalog: wrongModel.catalog, attemptId: ATTEMPT_ID }), /model requested gpt-5\.6-luna/);

  const wrongTier = await recoveryFixture({ fastAlias: true, observedTier: "flex" });
  t.after(() => rm(wrongTier.root, { recursive: true, force: true }));
  await assert.rejects(recoverAttempt({ repoRoot: wrongTier.root, catalog: wrongTier.catalog, attemptId: ATTEMPT_ID }), /tier requested fast, observed flex/);
});

test("recovery reconstructs preserved evidence, invokes no model, and publishes through the shared finalizer", async (t) => {
  const f = await recoveryFixture();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  const poison = path.join(f.root, "codex-must-not-run");
  await writeFile(poison, "not executable");
  const result = await recoverAttempt({
    repoRoot: f.root,
    catalog: f.catalog,
    attemptId: ATTEMPT_ID,
    now: new Date("2026-08-15T01:02:03.000Z"),
    env: { ...process.env, TASTE_CODEX_EXECUTABLE: poison },
  });
  assert.equal(result.status, "accepted");
  assert.equal(result.recovered, true);
  const dish = JSON.parse(await readFile(path.join(result.dishDirectory, "dish.json"), "utf8"));
  assert.equal(dish.executedAt, "2026-08-14T20:09:23.790Z");
  assert.equal(dish.finalizedAt, "2026-08-15T01:02:03.000Z");
  const trace = await readFile(path.join(result.dishDirectory, "trace.json"), "utf8");
  assert.match(trace, /artifact\/index\.html/);
  assert.equal(trace.includes(f.workspace), false);
  assert.equal(await readFile(path.join(f.attemptDir, "raw/turns/001-build/final.txt"), "utf8"), f.rawFinal);
  assert.equal(JSON.parse(await readFile(path.join(f.attemptDir, "recovery.json"), "utf8")).modelInvoked, false);
  assert.equal(await pathExists(path.join(f.attemptDir, "validation.recovery.json")), true);
  assert.equal(await pathExists(`${poison}.invoked`), false);
});

test("recovery uses the frozen configuration when the current configuration changes", async (t) => {
  const f = await recoveryFixture();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  await freezeConfigurationRevision(f.root, f.selectedVariant);
  f.catalog.variants = [];
  const result = await recoverAttempt({ repoRoot: f.root, catalog: f.catalog, attemptId: ATTEMPT_ID });
  assert.equal(result.status, "accepted");
  const dish = JSON.parse(await readFile(path.join(result.dishDirectory, "dish.json"), "utf8"));
  assert.equal(dish.identity.requestedModel, "gpt-5.6-sol");
});

test("Cursor publication recovery reconstructs stream identity without invoking a model", async (t) => {
  const f = await recoveryFixture();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  const selected = cursorVariant();
  f.catalog.variants = [selected];
  const requestedFile = path.join(f.attemptDir, "requested.json");
  const requested = JSON.parse(await readFile(requestedFile, "utf8"));
  requested.identity = { variantId: selected.id, provider: selected.provider, model: selected.model, harness: selected.harness, reasoningEffort: selected.reasoningEffort, serviceTier: selected.serviceTier, personality: selected.personality, configHash: selected.configHash };
  requested.execution = { profileId: selected.executionProfile.id, label: selected.executionProfile.label };
  await json(requestedFile, requested);
  const eventsPath = path.join(f.attemptDir, "raw/turns/001-build/stdout.jsonl");
  await writeFile(eventsPath, [
    { type: "system", subtype: "init", session_id: THREAD_ID, model: "Composer 2.5" },
    { type: "result", subtype: "success", is_error: false, result: "Finished", session_id: THREAD_ID },
  ].map(JSON.stringify).join("\n") + "\n");
  const executionFile = path.join(f.attemptDir, "execution.json");
  const execution = JSON.parse(await readFile(executionFile, "utf8"));
  execution.cliVersion = "cursor-agent fake";
  await json(executionFile, execution);
  const publication = await recoverAttempt({ repoRoot: f.root, catalog: f.catalog, attemptId: ATTEMPT_ID });
  assert.equal(publication.status, "accepted");
  const observed = JSON.parse(await readFile(path.join(f.attemptDir, "observed.json"), "utf8"));
  assert.equal(observed.model, "Composer 2.5");
  assert.equal(JSON.parse(await readFile(path.join(f.attemptDir, "recovery.json"), "utf8")).modelInvoked, false);
});

test("recovery refuses unsafe IDs, non-publication failures, drift, incomplete turns, and existing dishes", async (t) => {
  await assert.rejects(recoverAttempt({ repoRoot: "/tmp", catalog: {}, attemptId: "../attempt_escape" }), /Unsafe attempt id/);

  const wrongStage = await recoveryFixture();
  t.after(() => rm(wrongStage.root, { recursive: true, force: true }));
  await json(path.join(wrongStage.attemptDir, "state.json"), { status: "failed", stage: "execution", message: "model failed" });
  await assert.rejects(recoverAttempt({ repoRoot: wrongStage.root, catalog: wrongStage.catalog, attemptId: ATTEMPT_ID }), /did not fail specifically/);

  const drift = await recoveryFixture();
  t.after(() => rm(drift.root, { recursive: true, force: true }));
  drift.recipe.recipeHash = `sha256:${"9".repeat(64)}`;
  await assert.rejects(recoverAttempt({ repoRoot: drift.root, catalog: drift.catalog, attemptId: ATTEMPT_ID }), /recipe hash/);

  const incomplete = await recoveryFixture();
  t.after(() => rm(incomplete.root, { recursive: true, force: true }));
  const executionFile = path.join(incomplete.attemptDir, "execution.json");
  const execution = JSON.parse(await readFile(executionFile, "utf8"));
  execution.turns = [];
  await json(executionFile, execution);
  await assert.rejects(recoverAttempt({ repoRoot: incomplete.root, catalog: incomplete.catalog, attemptId: ATTEMPT_ID }), /every scripted turn/);

  const existing = await recoveryFixture();
  t.after(() => rm(existing.root, { recursive: true, force: true }));
  await mkdir(path.join(existing.root, "dishes", ATTEMPT_ID.replace(/^attempt_/, "dish_")), { recursive: true });
  await assert.rejects(recoverAttempt({ repoRoot: existing.root, catalog: existing.catalog, attemptId: ATTEMPT_ID }), /Dish already exists/);
});
