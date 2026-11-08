import assert from "node:assert/strict";
import { cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

import { computeConfigHash, computeRecipeHash, hashCanonical, sha256 } from "../lib/taste/catalog.mjs";
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

test("a personal Dish lands in private/dishes unless the Cook publishes it deliberately; clean and legacy Dishes stay public", async (t) => {
  const f = await recipeFixture();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  const personal = configuration({ environment: "personal", harnessProfile: "rose" });

  const kept = await finalize(f, personal, "attempt_kept_private");
  assert.equal(kept.dishDirectory, path.join(f.root, "private/dishes", kept.dishId));
  assert.equal(JSON.parse(await readFile(path.join(kept.dishDirectory, "dish.json"), "utf8")).visibility, "private");
  assert.equal(await pathExists(path.join(f.root, "dishes", kept.dishId)), false);

  const published = await finalize(f, personal, "attempt_published", { publishPersonal: true });
  assert.equal(published.dishDirectory, path.join(f.root, "dishes", published.dishId));
  assert.equal("visibility" in JSON.parse(await readFile(path.join(published.dishDirectory, "dish.json"), "utf8")), false);

  // The publish choice is meaningless for anything but personal.
  for (const [name, extra] of [["clean", { environment: "clean" }], ["legacy", {}]]) {
    const result = await finalize(f, configuration(extra), `attempt_${name}`);
    assert.equal(result.dishDirectory, path.join(f.root, "dishes", result.dishId), name);
  }
});

test("cook refuses --publish-personal for a non-personal configuration as a usage error", async () => {
  // The real catalog's configurations are all legacy (no environment), so none is personal.
  const config = JSON.parse(await readFile(path.join(repoRoot, "catalog/configurations.json"), "utf8"));
  const id = (config.configurations ?? config.variants ?? config)[0].id;
  const base = { config: id, configurationId: id, variantId: id, intent: "fill-missing" };
  await assert.rejects(cook(repoRoot, { ...base, publishPersonal: true }), (error) => error.code === "INVALID_ARGUMENT" && /--publish-personal applies only to .*personal/.test(error.message));

  const { stdout, stderr } = await execFileAsync("node", ["bin/taste.mjs", "cook", "--config", id, "--intent", "fill-missing", "--publish-personal", "--json"], { cwd: repoRoot }).catch((error) => error);
  assert.equal(stdout ?? "", "");
  assert.match(JSON.parse(stderr).error.message, /--publish-personal/);
  assert.equal(JSON.parse(stderr).error.code, "INVALID_ARGUMENT");
});

test("the attempt manifest records environment, harnessProfile and the publish choice, and recovery rebuilds the same configuration hash from them", () => {
  const adapter = { requestedExecution: () => ({ codexHome: "fresh-per-attempt" }) };
  const recipe = { id: "demo", version: "1.0.0", recipeHash: "sha256:r", fixtureHashes: {}, harness: {} };
  const catalog = { catalogHash: "sha256:c" };
  for (const [extra, publish] of [[{ environment: "personal", harnessProfile: "rose" }, true], [{ environment: "personal" }, false], [{ environment: "clean" }, false], [{}, false]]) {
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
  assert.match(await withProfile({ environment: "personal", harnessProfile: "rose" }), /declares no environment/);
  assert.match(await withProfile({ colour: "red" }), /colour/);
});

test("owner validation accepts a private Dish of a public Recipe only when its receipt records a personal configuration", async (t) => {
  const { scratch, validate } = await scratchCatalog(t);
  const [dishId] = await readdir(path.join(scratch, "dishes"));
  const publicDirectory = path.join(scratch, "dishes", dishId);
  const privateDirectory = path.join(scratch, "private/dishes", dishId);
  const keepPrivate = async (environment) => {
    await rm(path.join(scratch, "private"), { recursive: true, force: true });
    await mkdir(path.dirname(privateDirectory), { recursive: true });
    await cp(publicDirectory, privateDirectory, { recursive: true });
    const receiptFile = path.join(privateDirectory, "receipt.json");
    const receipt = JSON.parse(await readFile(receiptFile, "utf8"));
    if (environment) receipt.configuration.executionProfile.environment = environment;
    receipt.configuration.configHash = computeConfigHash(receipt.configuration);
    await writeFile(receiptFile, `${JSON.stringify(receipt, null, 2)}\n`);
    const dishFile = path.join(privateDirectory, "dish.json");
    const dish = JSON.parse(await readFile(dishFile, "utf8"));
    delete dish.dishHash;
    dish.visibility = "private";
    dish.identity.configHash = receipt.configuration.configHash;
    await writeFile(dishFile, `${JSON.stringify({ ...dish, dishHash: hashCanonical(dish) }, null, 2)}\n`);
    await rm(publicDirectory, { recursive: true });
    const output = await validate();
    await cp(privateDirectory, publicDirectory, { recursive: true });
    return output;
  };
  // Without the private/ tree, owner mode reports unrelated missing-provenance errors; only the storage rule matters here.
  assert.doesNotMatch(await keepPrivate("personal"), /Dish storage does not match Recipe visibility/);
  assert.match(await keepPrivate("clean"), /Dish storage does not match Recipe visibility/);
  assert.match(await keepPrivate(undefined), /Dish storage does not match Recipe visibility/);
});
