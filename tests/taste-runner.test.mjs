import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, readlink, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { computeRecipeHash, sha256 } from "../lib/taste/catalog.mjs";
import { executePlan, executeRecipe, prepareWorkspace } from "../lib/taste/runner.mjs";
import { otherFilesystem } from "./support/filesystems.mjs";

test("a workspace has an output/ folder only when the Recipe's contract delivers into it", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  const prepare = async (name, output) => {
    const workspace = path.join(f.root, name);
    await prepareWorkspace(f.root, { ...f.recipe, output: { ...f.recipe.output, ...output } }, workspace, null);
    return (await readdir(workspace)).sort();
  };
  // Collected from the workspace root: only the fixtures are there, so nothing suggests another place to deliver.
  assert.deepEqual(await prepare("root", { kind: "web", entry: "index.html", include: ["index.html", "assets/**"] }), ["inputs"]);
  assert.deepEqual(await prepare("project", { kind: "code", entry: "project/src/index.mjs", include: ["project/src/**"] }), ["inputs"]);
  assert.deepEqual(await prepare("lookalike", { kind: "document", entry: "output.md", include: ["output.md", "outputs/**"] }), ["inputs"]);
  assert.deepEqual(await prepare("glob", { kind: "document", entry: "notes.md", include: ["**"] }), ["inputs"]);
  assert.deepEqual(await prepare("file", { kind: "document", entry: "output", include: ["output"] }), ["inputs"]);
  // The contract names output/: the folder is ready and empty, as before.
  assert.deepEqual(await prepare("session", {}), ["inputs", "output"]);
  assert.deepEqual(await readdir(path.join(f.root, "session/output")), []);
  assert.deepEqual(await prepare("note", { kind: "code", entry: "project/src/index.mjs", include: ["project/src/**", "output/completion.md"] }), ["inputs", "output"]);
});

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
    fixtureHashes: { context: sha256("public context\n") },
  };
  recipe.recipeHash = computeRecipeHash(recipe, recipe.fixtureHashes);
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
  let usedWorkspace;
  let usedEnv;
  let during;
  const result = await executeRecipe({
    repoRoot: f.root,
    catalog: f.catalog,
    recipe: f.recipe,
    variant: f.variant,
    now: new Date("2026-08-14T12:00:00.000Z"),
    nonce: "fixed",
    authPath: f.authPath,
    runSession: async ({ codexHome, workspace, env }) => {
      usedCodexHome = codexHome;
      usedWorkspace = workspace;
      usedEnv = env;
      during = { home: await readdir(codexHome), link: await readlink(path.join(codexHome, "auth.json")), mode: (await stat(codexHome)).mode & 0o777 };
      return fakeSession();
    },
    verifyIdentity: observed,
  });

  assert.equal(result.status, "accepted", result.error);
  // The model works in an opaque cook directory under the runtime root, outside the repo.
  const cookDirectory = path.dirname(usedWorkspace);
  assert.equal(path.dirname(cookDirectory), process.env.TASTE_RUNTIME_ROOT);
  assert.match(path.basename(cookDirectory), /^[a-f0-9]{16}$/u);
  assert.equal(usedCodexHome, path.join(cookDirectory, "codex-home"));
  assert.equal(path.relative(f.root, usedWorkspace).startsWith(".."), true);
  for (const name of [f.recipe.id, f.variant.id, f.variant.model]) assert.equal(usedWorkspace.includes(name), false, `workspace path names ${name}`);
  assert.deepEqual(during, { home: ["auth.json"], link: f.authPath, mode: 0o700 });
  // The harness's temp files live in the cook directory too.
  assert.equal(usedEnv.TMPDIR, path.join(cookDirectory, "tmp"));
  // Published: the cook directory and its owner record are gone.
  await assert.rejects(stat(cookDirectory), /ENOENT/);
  await assert.rejects(stat(path.join(path.dirname(cookDirectory), ".owners", `${path.basename(cookDirectory)}.json`)), /ENOENT/);
  const requested = JSON.parse(await readFile(path.join(f.root, "private/runtime/attempts", result.attemptId, "requested.json"), "utf8"));
  assert.equal(requested.cookDirectory, cookDirectory);
  assert.deepEqual(requested.execution, {
    profileId: "codex-linux-host-unsandboxed-v1",
    label: "via Codex CLI · host-unsandboxed fallback",
    sandbox: "danger-full-access",
    approvalPolicy: "never",
    runtime: "linux-host",
    workspace: "fresh-copy",
    codexHome: "fresh-per-attempt",
    home: "inherited",
    nativeWeb: "disabled",
    networkEnforcement: "not-technically-enforced",
    hostFilesystem: "not-a-secrecy-boundary",
  });
  const dish = JSON.parse(await readFile(path.join(result.dishDirectory, "dish.json"), "utf8"));
  assert.equal(dish.identity.observedModel, "gpt-5.6-sol");
  assert.equal(dish.identity.serviceTier, "default");
  assert.equal(dish.identity.requestedServiceTier, "default");
  assert.equal("observedServiceTier" in dish.identity, false);
  assert.equal(dish.artifact.entry, "artifact/output/session.json");
  assert.deepEqual(dish.artifact.files.map((file) => file.path), ["artifact/output/session.json"]);
  assert.match(dish.dishHash, /^sha256:[a-f0-9]{64}$/);
  const transcript = JSON.parse(await readFile(path.join(result.dishDirectory, dish.artifact.entry), "utf8"));
  assert.equal(transcript.turns.length, 2);
  assert.equal(transcript.turns[1].response, "More direct answer.");
  await assert.rejects(readFile(path.join(result.dishDirectory, "raw/turns/001-opening/stdout.jsonl")), /ENOENT/);
  assert.equal(JSON.parse(await readFile(path.join(result.dishDirectory, "validation.json"), "utf8")).passed, true);
});

test("a required check failure creates no Dish; its plate is a public No Dish", async (t) => {
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
  // A failed attempt keeps its cook directory for recovery.
  assert.deepEqual(await readdir(homes[0]), ["auth.json"]);
  assert.deepEqual(await readdir(homes[1]), ["auth.json"]);
  assert.match(result.error, /Required validation failed/);
  assert.equal(JSON.parse(await readFile(path.join(result.attemptDir, "state.json"), "utf8")).status, "failed");
  await assert.rejects(readFile(path.join(f.root, "dishes", "dish_demo-session_codex-sol-high_20260814120000000_failed", "dish.json")), /ENOENT/);
  // A failed required check is the model's own outcome (a chef fault): it is recorded publicly, never as a Dish.
  assert.equal(result.fault.class, "chef");
  assert.equal(result.fault.code, "checks-failed");
  assert.equal(result.noDishId, "nodish_demo-session_codex-sol-high_20260814120000000_failed");
});

test("a runtime root under a directory holding AGENTS.md fails closed before credentials or the model are touched", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  const outer = await mkdtemp(path.join(os.tmpdir(), "taste-ancestor-"));
  t.after(() => rm(outer, { recursive: true, force: true }));
  await writeFile(path.join(outer, "AGENTS.md"), "# Notes about what is being tasted\n");
  let launches = 0;
  const result = await executeRecipe({
    repoRoot: f.root, catalog: f.catalog, recipe: f.recipe, variant: f.variant, nonce: "guarded", authPath: f.authPath,
    env: { TASTE_RUNTIME_ROOT: path.join(outer, "runtime") },
    runSession: async () => { launches += 1; return fakeSession(); }, verifyIdentity: observed,
  });
  assert.equal(result.status, "failed");
  assert.equal(launches, 0);
  assert.match(result.error, /Workspace is not isolated/);
  assert.ok(result.error.includes(path.join(outer, "AGENTS.md")));
  const state = JSON.parse(await readFile(path.join(result.attemptDir, "state.json"), "utf8"));
  assert.equal(state.stage, "preparation");
  const [cook] = (await readdir(path.join(outer, "runtime"))).filter((name) => /^[a-f0-9]{16}$/u.test(name));
  assert.deepEqual(await readdir(path.join(outer, "runtime", cook)), [], "no harness home or workspace was prepared");
  await assert.rejects(stat(path.join(f.root, "dishes")), /ENOENT/);
});

test("cooking and publication work when the workspace, private/ and dishes/ sit on different filesystems", async (t) => {
  const elsewhere = await otherFilesystem();
  if (!elsewhere) return t.skip("no second filesystem on this machine");
  const f = await fixture();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  const remote = await mkdtemp(path.join(elsewhere, "taste-private-"));
  t.after(() => rm(remote, { recursive: true, force: true }));
  // private/ is a symlink to another device, as on the host where EXDEV was seen.
  await rm(path.join(f.root, "private"), { recursive: true, force: true });
  await symlink(remote, path.join(f.root, "private"));
  const runtime = await mkdtemp(path.join(os.tmpdir(), "taste-runtime-xdev-"));
  t.after(() => rm(runtime, { recursive: true, force: true }));
  let workspaceDevice;
  const result = await executeRecipe({
    repoRoot: f.root, catalog: f.catalog, recipe: f.recipe, variant: f.variant, nonce: "xdev", authPath: f.authPath,
    env: { TASTE_RUNTIME_ROOT: runtime },
    runSession: async ({ workspace }) => { workspaceDevice = (await stat(workspace)).dev; return fakeSession(); }, verifyIdentity: observed,
  });
  assert.equal(result.status, "accepted", result.error);
  const attemptDir = path.join(f.root, "private/runtime/attempts", result.attemptId);
  assert.notEqual(workspaceDevice, (await stat(attemptDir)).dev);
  assert.notEqual((await stat(attemptDir)).dev, (await stat(result.dishDirectory)).dev);
  assert.equal(JSON.parse(await readFile(path.join(result.dishDirectory, "dish.json"), "utf8")).status, "accepted");
  assert.deepEqual((await readdir(path.join(f.root, "dishes"))).filter((name) => name.startsWith(".")), [], "no publishing leftovers");
  await assert.rejects(stat(path.join(attemptDir, "public-staging")), /ENOENT/);
});

test("Codex authentication failure happens before a session is launched", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  let launches = 0;
  const result = await executeRecipe({
    repoRoot: f.root, catalog: f.catalog, recipe: f.recipe, variant: f.variant,
    nonce: "no-auth", authPath: path.join(f.root, "missing-auth.json"),
    runSession: async () => { launches += 1; return fakeSession(); }, verifyIdentity: observed,
  });
  assert.equal(result.status, "failed");
  assert.equal(launches, 0);
  assert.match(result.error, /Codex auth source/);
});

test("direct execution refuses every planner-incompatible recipe before runtime side effects", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  for (const recipe of [
    { ...f.recipe, harness: { ...f.recipe.harness, web: "enabled" } },
    { ...f.recipe, presentation: { profile: "static-web-v1", semanticRuntime: { id: "changed", version: "1" } } },
    { ...f.recipe, status: "draft" },
  ]) {
    let launches = 0;
    await assert.rejects(executeRecipe({ repoRoot: f.root, catalog: f.catalog, recipe, variant: f.variant, nonce: `refuse-${recipe.status}-${recipe.harness.web}`, runSession: async () => { launches += 1; return fakeSession(); } }), /Unsupported recipe\/configuration/);
    assert.equal(launches, 0);
  }
  await assert.rejects(stat(path.join(f.root, "private/runtime")), /ENOENT/);
});

test("plan execution refuses a recipe whose hash moved since the plan was made", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  let launches = 0;
  const stale = { variant: f.variant, skill: null, supported: [{ recipeId: f.recipe.id, recipeHash: `sha256:${"9".repeat(64)}` }], unsupported: [] };
  await assert.rejects(
    executePlan({ repoRoot: f.root, catalog: f.catalog, plan: stale, runSession: async () => { launches += 1; return fakeSession(); } }),
    /Recipe demo-session changed since this plan was made/,
  );
  assert.equal(launches, 0);
  await assert.rejects(stat(path.join(f.root, "private/runtime")), /ENOENT/);
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
