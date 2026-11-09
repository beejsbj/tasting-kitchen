import assert from "node:assert/strict";
import { chmod, cp, mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

import { computeConfigHash, computeRecipeHash, hashCanonical, sha256 } from "../lib/taste/catalog.mjs";
import { collectSetupChildren, collectSetupDirectory, collectSetupFile, createSetupBudget, setupDigest, writeSetupFiles } from "../lib/taste/environments.mjs";
import { pathExists } from "../lib/taste/files.mjs";
import { OPTIONAL_PROFILE_KEYS } from "../lib/taste/harness-adapters.mjs";
import { cook } from "../lib/taste/index.mjs";
import { finalizeAttempt } from "../lib/taste/publication.mjs";
import { configurationFromRequest } from "../lib/taste/recovery.mjs";
import { requestedManifest } from "../lib/taste/runner.mjs";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const profile = { id: "codex-linux-host-unsandboxed-v1", label: "via Codex CLI · host-unsandboxed fallback", runtime: "linux-host", sandbox: "danger-full-access", approvalPolicy: "never", nativeWeb: "disabled", networkPolicy: "not-enforced", filesystemBoundary: "not-a-secrecy-boundary" };

function configuration(extra = {}) {
  const value = { id: "codex-personal", provider: "openai", model: "gpt-5.6-sol", harness: "codex-cli", reasoningEffort: "high", serviceTier: "default", personality: "none", capabilities: ["files", "shell"], executionProfile: { ...profile, ...extra } };
  return { ...value, configHash: computeConfigHash(value) };
}

async function recipeFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "taste-environment-"));
  const recipeDir = path.join(root, "catalog/recipes/conversation/demo");
  await mkdir(path.join(recipeDir, "fixtures"), { recursive: true });
  await writeFile(path.join(recipeDir, "fixtures/context.txt"), "public context\n");
  const recipe = {
    schemaVersion: 1, id: "demo-session", version: "1.0.0", status: "ready", title: "A demo session recipe",
    summary: "A sufficiently detailed demo for environment routing tests.", domain: "conversation", origin: "textbook",
    originNote: "A conventional routing test.", tags: ["presence"], kind: "session",
    harness: { workspace: "read", web: "disabled", capabilities: [] },
    setup: { instructions: "Read the mounted public context.", fixtures: [{ id: "context", path: "fixtures/context.txt", mountAs: "inputs/context.txt", public: true, mediaType: "text/plain" }] },
    turns: [{ id: "opening", role: "prompt", content: "Respond once." }],
    output: { kind: "session", entry: "output/session.json", include: ["output/session.json"], limits: { maxFiles: 2, maxBytes: 32768 } },
    validation: { mode: "completeness", checks: [{ id: "entry", type: "file-exists", required: true, description: "The transcript exists.", target: "output/session.json" }] },
    sourcePath: "catalog/recipes/conversation/demo/recipe.json",
    fixtureHashes: { context: sha256("public context\n") },
  };
  recipe.recipeHash = computeRecipeHash(recipe, recipe.fixtureHashes);
  return { root, recipe, catalog: { catalogHash: `sha256:${"4".repeat(64)}`, recipes: [recipe] } };
}

async function finalize(f, variant, attemptId, options = {}) {
  const attemptDir = path.join(f.root, "private/runtime/attempts", attemptId);
  const workspace = path.join(attemptDir, "workspace");
  await mkdir(path.join(workspace, "inputs"), { recursive: true });
  await mkdir(path.join(workspace, "output"), { recursive: true });
  await writeFile(path.join(workspace, "inputs/context.txt"), "public context\n");
  return finalizeAttempt({
    repoRoot: f.root, catalog: f.catalog, recipe: { ...f.recipe, fixtureIntegrityRequired: true }, variant, attemptId, attemptDir, workspace,
    result: { cliVersion: "codex-cli 9.9.9-fake", turns: [{ finalMessage: "An answer." }] },
    observed: { model: variant.model, provider: "openai", reasoningEffort: "high", serviceTier: "default", verifiedBy: "test" },
    executedAt: "2026-11-08T12:00:00.000Z", finalizedAt: new Date("2026-11-08T12:01:00.000Z"), ...options,
  });
}

const DIGEST = `sha256:${"a".repeat(64)}`;
const toggles = { memory: "on", connections: "off" };
const snapshotSetup = (variant, digest = DIGEST) => ({ environment: "snapshot", harnessProfile: variant.executionProfile.harnessProfile, memory: variant.executionProfile.memory, connections: variant.executionProfile.connections, digest, entries: [] });

test("snapshot and live Dishes land in private/dishes unless the Cook publishes them deliberately; clean and legacy Dishes stay public", async (t) => {
  const f = await recipeFixture();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  const snapshot = configuration({ environment: "snapshot", harnessProfile: "rose", ...toggles });
  const live = configuration({ environment: "live", ...toggles });

  const kept = await finalize(f, snapshot, "attempt_kept_private", { setup: snapshotSetup(snapshot) });
  assert.equal(kept.dishDirectory, path.join(f.root, "private/dishes", kept.dishId));
  const keptDish = JSON.parse(await readFile(path.join(kept.dishDirectory, "dish.json"), "utf8"));
  assert.equal(keptDish.visibility, "private");
  assert.equal(keptDish.identity.setupDigest, DIGEST, "the digest is part of the immutable manifest");
  assert.equal(JSON.parse(await readFile(path.join(kept.dishDirectory, "receipt.json"), "utf8")).setup.digest, DIGEST);
  assert.equal(await pathExists(path.join(f.root, "dishes", kept.dishId)), false);
  const liveKept = await finalize(f, live, "attempt_live_private", { setup: { environment: "live", memory: "on", connections: "off", home: "real", digestAtStart: DIGEST } });
  assert.equal(liveKept.dishDirectory, path.join(f.root, "private/dishes", liveKept.dishId));
  assert.equal(JSON.parse(await readFile(path.join(liveKept.dishDirectory, "dish.json"), "utf8")).identity.setupDigest, undefined, "live never groups by digest");

  const published = await finalize(f, snapshot, "attempt_published", { publishPersonal: true, setup: snapshotSetup(snapshot) });
  assert.equal(published.dishDirectory, path.join(f.root, "dishes", published.dishId));
  assert.equal("visibility" in JSON.parse(await readFile(path.join(published.dishDirectory, "dish.json"), "utf8")), false);

  // A snapshot without its setup record, or with one for a different configuration, cannot publish.
  await assert.rejects(finalize(f, snapshot, "attempt_no_setup"), /must record its setup/);
  await assert.rejects(finalize(f, snapshot, "attempt_wrong_setup", { setup: { ...snapshotSetup(snapshot), memory: "off" } }), /memory does not match/);

  // The publish choice is meaningless for anything but snapshot and live.
  for (const [name, extra] of [["clean", { environment: "clean" }], ["legacy", {}]]) {
    const result = await finalize(f, configuration(extra), `attempt_${name}`);
    assert.equal(result.dishDirectory, path.join(f.root, "dishes", result.dishId), name);
  }
});

test("cook refuses --publish-personal and --allow-connections where they mean nothing, as usage errors", async () => {
  // The real catalog's first configuration is legacy Codex (no environment), so it is neither personal nor connected.
  const config = JSON.parse(await readFile(path.join(repoRoot, "catalog/configurations.json"), "utf8"));
  const id = (config.configurations ?? config.variants ?? config)[0].id;
  const base = { config: id, configurationId: id, variantId: id, intent: "fill-missing" };
  await assert.rejects(cook(repoRoot, { ...base, publishPersonal: true }), (error) => error.code === "INVALID_ARGUMENT" && /--publish-personal applies only to .*snapshot or live/.test(error.message));
  await assert.rejects(cook(repoRoot, { ...base, allowConnections: true }), (error) => error.code === "INVALID_ARGUMENT" && /--allow-connections applies only/.test(error.message));

  const { stdout, stderr } = await execFileAsync("node", ["bin/taste.mjs", "cook", "--config", id, "--intent", "fill-missing", "--publish-personal", "--json"], { cwd: repoRoot }).catch((error) => error);
  assert.equal(stdout ?? "", "");
  assert.match(JSON.parse(stderr).error.message, /--publish-personal/);
  assert.equal(JSON.parse(stderr).error.code, "INVALID_ARGUMENT");
});

test("the attempt manifest records environment, harnessProfile, toggles and the publish choice, and recovery rebuilds the same configuration hash from them", () => {
  const adapter = { requestedExecution: () => ({ codexHome: "fresh-per-attempt" }) };
  const recipe = { id: "demo", version: "1.0.0", recipeHash: "sha256:r", fixtureHashes: {}, harness: {} };
  const catalog = { catalogHash: "sha256:c" };
  for (const [extra, publish] of [[{ environment: "snapshot", harnessProfile: "rose", ...toggles }, true], [{ environment: "live", memory: "off", connections: "on" }, false], [{ environment: "clean" }, false], [{}, false]]) {
    const original = configuration(extra);
    const requested = requestedManifest(catalog, recipe, original, adapter, "attempt_x", "2026-11-08T12:00:00.000Z", null, publish);
    assert.equal(requested.publishPersonal, publish);
    for (const key of OPTIONAL_PROFILE_KEYS) assert.equal(requested.execution[key], extra[key], key);
    assert.equal("environment" in requested.execution, "environment" in extra);
    // Survive the JSON round trip, then rebuild as recovery does when the catalog no longer has the configuration.
    const rebuilt = configurationFromRequest(JSON.parse(JSON.stringify(requested)));
    assert.equal(computeConfigHash(rebuilt), original.configHash, JSON.stringify(extra));
  }
});

// A scratch copy of the public tree (no private/), so validation can be run against edited catalog files.
async function scratchCatalog(t) {
  const scratch = await mkdtemp(path.join(os.tmpdir(), "taste-validate-"));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  for (const entry of await readdir(repoRoot)) {
    if (["node_modules", ".git", "private"].includes(entry)) continue;
    await cp(path.join(repoRoot, entry), path.join(scratch, entry), { recursive: true });
  }
  const validate = (...flags) => execFileAsync("node", ["scripts/validate-catalog.mjs", ...flags], { cwd: repoRoot, env: { ...process.env, TASTE_CATALOG_ROOT: scratch } })
    .then(() => "", (error) => `${error.stdout}${error.stderr}`);
  return { scratch, validate };
}

test("validate-catalog accepts only string environment keys, and rejects any environment a profile does not declare", async (t) => {
  const { scratch, validate } = await scratchCatalog(t);
  const file = path.join(scratch, "catalog/configurations.json");
  const original = JSON.parse(await readFile(file, "utf8"));
  const withProfile = async (extra) => {
    const doc = structuredClone(original);
    Object.assign(doc.configurations[0].executionProfile, extra);
    await writeFile(file, `${JSON.stringify(doc, null, 2)}\n`);
    return validate("--public-checkout");
  };
  assert.equal(await withProfile({}), "");
  assert.match(await withProfile({ environment: 7 }), /executionProfile\.environment/);
  assert.match(await withProfile({ harnessProfile: 7 }), /executionProfile\.harnessProfile/);
  assert.match(await withProfile({ environment: "clean" }), /declares no environment/);
  assert.match(await withProfile({ environment: "snapshot", harnessProfile: "rose", ...toggles }), /declares no environment/);
  assert.match(await withProfile({ environment: "personal" }), /must be one of clean, snapshot, live/);
  assert.match(await withProfile({ memory: 1 }), /executionProfile\.memory/);
  assert.match(await withProfile({ colour: "red" }), /colour/);
});

test("owner validation accepts a private Dish of a public Recipe only when its receipt records a snapshot or live configuration, and binds a snapshot's digest", async (t) => {
  const { scratch, validate } = await scratchCatalog(t);
  const [dishId] = await readdir(path.join(scratch, "dishes"));
  const publicDirectory = path.join(scratch, "dishes", dishId);
  const privateDirectory = path.join(scratch, "private/dishes", dishId);
  // Each case starts from the untouched public Dish, so no case inherits another's edits.
  const pristine = path.join(scratch, "pristine-dish");
  await cp(publicDirectory, pristine, { recursive: true });
  const keepPrivate = async (environment, { digest, setup } = {}) => {
    await rm(path.join(scratch, "private"), { recursive: true, force: true });
    await mkdir(path.dirname(privateDirectory), { recursive: true });
    await cp(pristine, privateDirectory, { recursive: true });
    const receiptFile = path.join(privateDirectory, "receipt.json");
    const receipt = JSON.parse(await readFile(receiptFile, "utf8"));
    if (environment) Object.assign(receipt.configuration.executionProfile, { environment }, environment === "clean" ? {} : toggles);
    if (setup) receipt.setup = setup;
    receipt.configuration.configHash = computeConfigHash(receipt.configuration);
    await writeFile(receiptFile, `${JSON.stringify(receipt, null, 2)}\n`);
    const dishFile = path.join(privateDirectory, "dish.json");
    const dish = JSON.parse(await readFile(dishFile, "utf8"));
    delete dish.dishHash;
    dish.visibility = "private";
    dish.identity.configHash = receipt.configuration.configHash;
    if (digest) dish.identity.setupDigest = digest;
    await writeFile(dishFile, `${JSON.stringify({ ...dish, dishHash: hashCanonical(dish) }, null, 2)}\n`);
    await rm(publicDirectory, { recursive: true });
    const output = await validate();
    await cp(pristine, publicDirectory, { recursive: true });
    return output;
  };
  // Without the private/ tree, owner mode reports unrelated missing-provenance errors; only the storage rule matters here.
  const liveSetup = { environment: "live", memory: "on", connections: "off", digestAtStart: DIGEST };
  assert.doesNotMatch(await keepPrivate("live", { setup: liveSetup }), /Dish storage does not match Recipe visibility|setup/);
  const snapshotReceipt = { environment: "snapshot", memory: "on", connections: "off", digest: DIGEST, entries: [] };
  assert.doesNotMatch(await keepPrivate("snapshot", { digest: DIGEST, setup: snapshotReceipt }), /Dish storage does not match Recipe visibility|setup/);
  assert.match(await keepPrivate("snapshot", { setup: snapshotReceipt }), /identity\.setupDigest/);
  assert.match(await keepPrivate("snapshot", { digest: `sha256:${"b".repeat(64)}`, setup: snapshotReceipt }), /setup digest does not match identity\.setupDigest/);
  assert.match(await keepPrivate("live"), /a live Dish must record its setup/);
  assert.match(await keepPrivate("clean"), /Dish storage does not match Recipe visibility/);
  assert.match(await keepPrivate(undefined), /Dish storage does not match Recipe visibility/);
});

test("fill-missing counts a snapshot cell covered only by a Dish that saw his setup as it is now; Repeats need the same digest", async (t) => {
  const { scratch } = await scratchCatalog(t);
  const setupRoot = await mkdtemp(path.join(os.tmpdir(), "taste-fill-setup-"));
  t.after(() => rm(setupRoot, { recursive: true, force: true }));
  // A stand-in ~/.claude: the real one is never read here.
  const home = path.join(setupRoot, "dot-claude");
  const memory = path.join(setupRoot, "memory");
  await mkdir(path.join(home, "skills", "tdd"), { recursive: true });
  await mkdir(memory);
  await writeFile(path.join(home, "CLAUDE.md"), "# Prime\n");
  await writeFile(path.join(home, "skills", "tdd", "SKILL.md"), "Red, green.\n");
  await writeFile(path.join(memory, "MEMORY.md"), "- one memory\n");
  const env = { TASTE_CLAUDE_PERSONAL_HOME: home, TASTE_CLAUDE_MEMORY_SOURCE: memory, TASTE_CLAUDE_GLOBAL_CONFIG: path.join(setupRoot, "claude.json") };
  const id = "claude-code-opus-5-5-high-snapshot";
  const fill = () => cook(scratch, { config: id, configurationId: id, variantId: id, intent: "fill-missing", env });

  const first = await fill();
  assert.equal(first.mode, "dry-run");
  assert.match(first.setupDigest, /^sha256:[a-f0-9]{64}$/);
  assert.ok(first.planned.length > 0);
  const [cell] = first.planned;
  const writeDish = async (dishId, setupDigest) => {
    const directory = path.join(scratch, "private/dishes", dishId);
    await mkdir(directory, { recursive: true });
    const dish = {
      schemaVersion: 1, id: dishId, recipe: { id: cell.recipeId, version: "1.0.0", hash: cell.recipeHash }, visibility: "private",
      executedAt: "2026-11-08T12:00:00.000Z", finalizedAt: "2026-11-08T12:01:00.000Z", status: "accepted",
      identity: { variantId: id, configHash: first.plan.variant.configHash, ...(setupDigest ? { setupDigest } : {}) },
    };
    await writeFile(path.join(directory, "dish.json"), JSON.stringify(dish));
  };

  // A Dish of an older setup leaves the cell uncovered, as an edited brief would.
  await writeDish("dish_older_setup", `sha256:${"0".repeat(64)}`);
  assert.equal((await fill()).skipped.some((item) => item.recipeId === cell.recipeId), false);
  // A Dish that saw today's setup covers it.
  await writeDish("dish_current_setup", first.setupDigest);
  const covered = await fill();
  assert.ok(covered.skipped.some((item) => item.recipeId === cell.recipeId));
  // His setup changes: the same Dish no longer covers the cell.
  await writeFile(path.join(memory, "MEMORY.md"), "- one memory, revised\n");
  const changed = await fill();
  assert.notEqual(changed.setupDigest, first.setupDigest);
  assert.equal(changed.skipped.some((item) => item.recipeId === cell.recipeId), false);
});

test("connections on cooks only with --allow-connections; a dry run says so and spends nothing", async (t) => {
  const setupRoot = await mkdtemp(path.join(os.tmpdir(), "taste-connections-setup-"));
  t.after(() => rm(setupRoot, { recursive: true, force: true }));
  const env = { TASTE_CLAUDE_PERSONAL_HOME: path.join(setupRoot, "dot-claude"), TASTE_CLAUDE_MEMORY_SOURCE: path.join(setupRoot, "memory"), TASTE_CLAUDE_GLOBAL_CONFIG: path.join(setupRoot, "claude.json"), TASTE_ALLOW_MODEL_RUNS: "1" };
  const id = "claude-code-opus-5-5-high-snapshot-connections";
  const base = { config: id, configurationId: id, variantId: id, intent: "repeat", recipeIds: ["answer-one-exact-question"], env };
  const dry = await cook(repoRoot, base);
  assert.equal(dry.mode, "dry-run");
  assert.equal(dry.connections, "on");
  let ran = false;
  const executePlan = async () => { ran = true; return { results: [], accepted: [], failed: [] }; };
  await assert.rejects(cook(repoRoot, { ...base, execute: true, executePlan }), (error) => error.code === "INVALID_ARGUMENT" && /--allow-connections/.test(error.message));
  assert.equal(ran, false, "refused before any model process");
  // With the flag, the plan reaches the runner, which repeats the check itself.
  let allowed;
  // The stub stops before cook rebuilds the registry, so this test writes nothing into the checkout.
  await assert.rejects(cook(repoRoot, { ...base, execute: true, allowConnections: true, executePlan: async (options) => { allowed = options.allowConnections; throw new Error("stop before the registry"); } }), /stop before the registry/);
  assert.equal(allowed, true);
});

test("setup collection leaves volatile files and credential-looking files out at any depth, and keeps a script's exec bit", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "taste-setup-collect-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const skill = path.join(root, "skills", "sample");
  const write = async (relative, text, mode) => {
    await mkdir(path.dirname(path.join(skill, relative)), { recursive: true });
    await writeFile(path.join(skill, relative), text, { mode });
  };
  await write("SKILL.md", "skill");
  await write("scripts/run.sh", "#!/bin/sh\n", 0o755);
  for (const noise of ["__pycache__/x.pyc", "sub/y.pyc", ".last-complete-round", ".staging/1/part", "node_modules/a/index.js", ".env", ".env.local", "auth.json", "sub/credentials.json", "keys/server.pem", "id_ed25519"]) await write(noise, "noise");
  await write(".env.example", "kept");

  const collect = () => collectSetupChildren(path.join(root, "skills"), "skills");
  const files = await collect();
  assert.deepEqual(files.map((file) => file.path).sort(), ["skills/sample/.env.example", "skills/sample/SKILL.md", "skills/sample/scripts/run.sh"]);
  assert.equal(files.find((file) => file.path.endsWith("run.sh")).executable, true);
  const digest = setupDigest(files);

  await write(".last-complete-round", "another session id");
  await write("__pycache__/x.pyc", "other bytecode");
  assert.equal(setupDigest(await collect()), digest, "volatile files cannot move the digest");
  await write("scripts/run.sh", "#!/bin/sh\n", 0o644);
  await chmod(path.join(skill, "scripts/run.sh"), 0o644);
  assert.notEqual(setupDigest(await collect()), digest, "losing the exec bit is a different setup");

  const home = path.join(root, "home");
  await mkdir(home);
  await writeSetupFiles(home, files);
  assert.equal((await stat(path.join(home, "skills/sample/scripts/run.sh"))).mode & 0o777, 0o700);
  assert.equal((await stat(path.join(home, "skills/sample/SKILL.md"))).mode & 0o777, 0o600);
});

test("one snapshot budget caps files as they are read, across every collection", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "taste-setup-budget-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "a"));
  await writeFile(path.join(root, "a", "one.txt"), "x");
  const budget = createSetupBudget();
  budget.files = 5000;
  await assert.rejects(collectSetupDirectory(root, "a", budget), /more than 5000 files/);
  budget.files = 0;
  budget.bytes = 64 * 1024 * 1024;
  await assert.rejects(collectSetupFile(path.join(root, "a", "one.txt"), "one.txt", budget), /bytes/);
});

test("the environments module loads first without the catalog having loaded", async () => {
  const { stdout } = await promisify(execFile)(process.execPath, ["--input-type=module", "-e", `import("${path.resolve("lib/taste/environments.mjs")}").then((module) => console.log(module.ENVIRONMENT_TOGGLES.join(",")))`]);
  assert.equal(stdout.trim(), "memory,connections");
});
