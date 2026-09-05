import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, readlink, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { computeRecipeHash, sha256 } from "../lib/taste/catalog.mjs";
import { executeRecipe } from "../lib/taste/runner.mjs";

async function fixture({ failing = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "taste-runner-"));
  const recipeDir = path.join(root, "catalog/recipes/conversation/demo");
  await mkdir(path.join(recipeDir, "fixtures"), { recursive: true });
  await writeFile(path.join(recipeDir, "fixtures/context.txt"), "public context\n");
  const authPath = path.join(root, "source-auth.json");
  await writeFile(authPath, "{}\n", { mode: 0o600 });
  const recipe = {
    schemaVersion: 1,
    id: "demo-session",
    version: "1.0.0",
    status: "ready",
    title: "A demo session recipe",
    summary: "A sufficiently detailed demo for runner testing.",
    domain: "conversation",
    origin: "textbook",
    originNote: "A conventional runner integration test.",
    tags: ["presence"],
    kind: "session",
    harness: { workspace: "read", web: "disabled", capabilities: [] },
    setup: {
      instructions: "Read the mounted public context.",
      fixtures: [{ id: "context", path: "fixtures/context.txt", mountAs: "inputs/context.txt", public: true, mediaType: "text/plain" }],
    },
    turns: [
      { id: "opening", role: "prompt", content: "Respond once." },
      { id: "correction", role: "correction", content: "Now respond more directly." },
    ],
    output: { kind: "session", entry: "output/session.json", include: ["output/session.json"], limits: { maxFiles: 2, maxBytes: 32768 } },
    validation: {
      mode: "completeness",
      checks: [
        { id: "entry", type: "file-exists", required: true, description: "The transcript exists.", target: failing ? "output/missing.json" : "output/session.json" },
        { id: "look", type: "manual", required: false, description: "Review the conversational presence." },
      ],
    },
    sourcePath: "catalog/recipes/conversation/demo/recipe.json",
    recipeHash: `sha256:${"1".repeat(64)}`,
    fixtureHashes: { context: `sha256:${"2".repeat(64)}` },
  };
  const variant = {
    id: "codex-sol-high",
    label: "Sol high",
    provider: "openai",
    model: "gpt-5.6-sol",
    harness: "codex-cli",
    reasoningEffort: "high",
    serviceTier: "default",
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
    configHash: `sha256:${"3".repeat(64)}`,
  };
  const catalog = { catalogHash: `sha256:${"4".repeat(64)}`, recipes: [recipe] };
  return { root, recipe, variant, catalog, authPath };
}

function fakeSession() {
  return {
    threadId: "01901234-5678-7abc-8def-0123456789ab",
    cliVersion: "codex-cli 9.9.9-fake",
    failure: null,
    turns: [
      { finalMessage: "First answer.", usage: { input_tokens: 10, output_tokens: 3 }, events: [{ type: "item.completed", item: { type: "command_execution", status: "completed", exit_code: 0 } }] },
      { finalMessage: "More direct answer.", usage: { input_tokens: 14, output_tokens: 4 }, events: [] },
    ],
  };
}

const observed = async () => ({
  model: "gpt-5.6-sol",
  provider: "openai",
  reasoningEffort: "high",
  serviceTier: "default",
  verifiedBy: "test",
});

test("publishes only selected output plus sanitized receipts as an immutable dish", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  let usedCodexHome;
  const result = await executeRecipe({
    repoRoot: f.root,
    catalog: f.catalog,
    recipe: f.recipe,
    variant: f.variant,
    now: new Date("2026-08-14T12:00:00.000Z"),
    nonce: "fixed",
    authPath: f.authPath,
    runSession: async ({ codexHome }) => {
      usedCodexHome = codexHome;
      return fakeSession();
    },
    verifyIdentity: observed,
  });

  assert.equal(result.status, "accepted");
  assert.match(usedCodexHome, /attempts\/attempt_[^/]+\/codex-home$/);
  assert.deepEqual(await readdir(usedCodexHome), ["auth.json"]);
  assert.equal(await readlink(path.join(usedCodexHome, "auth.json")), f.authPath);
  assert.equal((await stat(usedCodexHome)).mode & 0o777, 0o700);
  const requested = JSON.parse(await readFile(path.join(path.dirname(usedCodexHome), "requested.json"), "utf8"));
  assert.deepEqual(requested.execution, {
    profileId: "codex-linux-host-unsandboxed-v1",
    label: "via Codex CLI · host-unsandboxed fallback",
    sandbox: "danger-full-access",
    approvalPolicy: "never",
    runtime: "linux-host",
    workspace: "fresh-copy",
    codexHome: "fresh-per-attempt",
    nativeWeb: "disabled",
    networkEnforcement: "not-technically-enforced",
    hostFilesystem: "not-a-secrecy-boundary",
  });
  const dish = JSON.parse(await readFile(path.join(result.dishDirectory, "dish.json"), "utf8"));
  assert.equal(dish.identity.observedModel, "gpt-5.6-sol");
  assert.equal(dish.artifact.entry, "artifact/output/session.json");
  assert.deepEqual(dish.artifact.files.map((file) => file.path), ["artifact/output/session.json"]);
  assert.match(dish.dishHash, /^sha256:[a-f0-9]{64}$/);
  const transcript = JSON.parse(await readFile(path.join(result.dishDirectory, dish.artifact.entry), "utf8"));
  assert.equal(transcript.turns.length, 2);
  assert.equal(transcript.turns[1].response, "More direct answer.");
  await assert.rejects(readFile(path.join(result.dishDirectory, "raw/turns/001-opening/stdout.jsonl")), /ENOENT/);
  assert.equal(JSON.parse(await readFile(path.join(result.dishDirectory, "validation.json"), "utf8")).passed, true);
});

test("a required check failure remains private and creates no dish", async (t) => {
  const f = await fixture({ failing: true });
  t.after(() => rm(f.root, { recursive: true, force: true }));
  const homes = [];
  const run = (nonce) => executeRecipe({
    repoRoot: f.root,
    catalog: f.catalog,
    recipe: f.recipe,
    variant: f.variant,
    now: new Date("2026-08-14T12:00:00.000Z"),
    nonce,
    authPath: f.authPath,
    runSession: async ({ codexHome }) => {
      homes.push(codexHome);
      return fakeSession();
    },
    verifyIdentity: observed,
  });
  const result = await run("failed");
  const retry = await run("retry");
  assert.equal(result.status, "failed");
  assert.equal(retry.status, "failed");
  assert.notEqual(homes[0], homes[1]);
  assert.deepEqual(await readdir(homes[0]), ["auth.json"]);
  assert.deepEqual(await readdir(homes[1]), ["auth.json"]);
  assert.match(result.error, /Required validation failed/);
  assert.equal(JSON.parse(await readFile(path.join(result.attemptDir, "state.json"), "utf8")).status, "failed");
  await assert.rejects(readFile(path.join(f.root, "dishes", "dish_demo-session_codex-sol-high_20260814120000000_failed", "dish.json")), /ENOENT/);
});

test("frozen fixtures reject mutation unless that exact fixture is declared editable", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  const source = path.join(f.root, "catalog/recipes/conversation/demo/fixtures/context.txt");
  f.catalog.root = f.root;
  f.recipe.fixtureHashes = { context: sha256(await readFile(source)) };
  f.recipe.recipeHash = computeRecipeHash(f.recipe, f.recipe.fixtureHashes);
  const mutatingSession = async ({ workspace }) => {
    await writeFile(path.join(workspace, "inputs/context.txt"), "model changed supplied context\n");
    return fakeSession();
  };
  const immutable = await executeRecipe({
    repoRoot: f.root, catalog: f.catalog, recipe: f.recipe, variant: f.variant,
    now: new Date("2026-08-14T12:00:00.000Z"), nonce: "immutable", authPath: f.authPath,
    runSession: mutatingSession, verifyIdentity: observed,
  });
  assert.equal(immutable.status, "failed");
  assert.match(immutable.error, /Fixture context changed during execution/);

  await writeFile(source, "public context\n");
  f.recipe.setup.fixtures[0].editable = true;
  f.recipe.fixtureHashes = { context: sha256(await readFile(source)) };
  f.recipe.recipeHash = computeRecipeHash(f.recipe, f.recipe.fixtureHashes);
  const editable = await executeRecipe({
    repoRoot: f.root, catalog: f.catalog, recipe: f.recipe, variant: f.variant,
    now: new Date("2026-08-14T12:00:00.000Z"), nonce: "editable", authPath: f.authPath,
    runSession: mutatingSession, verifyIdentity: observed,
  });
  assert.equal(editable.status, "accepted");
});
