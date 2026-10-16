import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { loadCatalog, planSelection } from "../lib/taste/catalog.mjs";
import { cook } from "../lib/taste/index.mjs";
import { buildRegistry, loadDishes, loadPrivateDishes } from "../lib/taste/registry.mjs";
import { readDishSidecars, verifyInputs } from "../lib/taste/receipts.mjs";
import { executeRecipe } from "../lib/taste/runner.mjs";
import { loadSkills, skillCompatibility } from "../lib/taste/skills.mjs";

async function json(filename, value) {
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, `${JSON.stringify(value)}\n`);
}

const configuration = {
  id: "codex-sol-high", label: "Sol high", provider: "openai", model: "gpt-5.6-sol", harness: "codex-cli", reasoningEffort: "high", serviceTier: "default", personality: "none",
  capabilities: ["files", "shell"],
  executionProfile: { id: "codex-linux-host-unsandboxed-v1", label: "via Codex CLI · host-unsandboxed fallback", runtime: "linux-host", sandbox: "danger-full-access", approvalPolicy: "never", nativeWeb: "disabled", networkPolicy: "not-enforced", filesystemBoundary: "not-a-secrecy-boundary" },
};

function recipeDefinition(id, extra = {}) {
  return {
    schemaVersion: 1, id, version: "1.0.0", status: "ready", title: `Recipe ${id}`, summary: "A film recipe used to test skill layers.", cuisines: ["talk"], origin: "hybrid", originNote: "A synthetic layered recipe.", tags: ["presence"], kind: "session",
    harness: { workspace: "write", web: "disabled", capabilities: ["files", "shell"] },
    setup: { instructions: "Read the brief; use skill/SKILL.md when mounted.", fixtures: [{ id: "brief", path: "fixtures/brief.md", mountAs: "fixtures/brief.md", public: true, mediaType: "text/markdown" }] },
    turns: [{ id: "make", role: "prompt", content: "Make the film." }],
    output: { kind: "session", entry: "output/session.json", include: ["output/session.json"], limits: { maxFiles: 2, maxBytes: 32768 } },
    validation: { mode: "completeness", checks: [{ id: "entry", type: "file-exists", required: true, description: "Transcript exists.", target: "output/session.json" }] },
    ...extra,
  };
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "taste-skills-"));
  await json(path.join(root, "catalog/cuisines.json"), { schemaVersion: 1, cuisines: [{ id: "talk", label: "Talk", description: "Conversation tests.", order: 10 }] });
  await json(path.join(root, "catalog/tags.json"), { schemaVersion: 1, tags: ["presence"] });
  await json(path.join(root, "catalog/configurations.json"), { schemaVersion: 1, configurations: [configuration] });
  await json(path.join(root, "catalog/skills.json"), { schemaVersion: 1, skills: [
    { id: "hand-drawn", label: "Hand-drawn", summary: "Whole drawings and poses.", entry: "SKILL.md", source: { repository: "https://example.invalid/tools", commit: "a".repeat(40), path: "skills/hand-drawn", license: "MIT" } },
    { id: "procedural", label: "Procedural", summary: "Beat grids and props.", entry: "SKILL.md", source: { repository: "https://example.invalid/procedural", commit: "b".repeat(40), path: ".", license: "MIT" } },
    { id: "quiet-soul", label: "Quiet soul", summary: "A shared public soul delivered in the prompt.", entry: "SOUL.md", delivery: "prompt", source: { repository: "https://example.invalid/souls", commit: "c".repeat(40), path: "quiet", license: "CC0" } },
  ] });
  await mkdir(path.join(root, "catalog/skills/quiet-soul/files"), { recursive: true });
  await writeFile(path.join(root, "catalog/skills/quiet-soul/files/SOUL.md"), "# Quiet soul\nSay less. Ask one thing.\n");
  await mkdir(path.join(root, "catalog/skills/hand-drawn/files/assets"), { recursive: true });
  await writeFile(path.join(root, "catalog/skills/hand-drawn/files/SKILL.md"), "# Hand-drawn\nDraw whole cels.\n");
  await writeFile(path.join(root, "catalog/skills/hand-drawn/files/assets/core.js"), "export const cel = 1;\n");
  await mkdir(path.join(root, "catalog/skills/procedural/files"), { recursive: true });
  await writeFile(path.join(root, "catalog/skills/procedural/files/SKILL.md"), "# Procedural\n");
  const layered = recipeDefinition("layered-film", { skills: { mountAs: "skill", optional: true, layers: ["hand-drawn"] } });
  const plain = recipeDefinition("plain-film");
  const talk = recipeDefinition("quiet-talk", { harness: { workspace: "read", web: "disabled", capabilities: [] }, skills: { optional: true, layers: ["quiet-soul"] } });
  const privateRecipe = recipeDefinition("private-song", {
    visibility: "private",
    skills: { mountAs: "skill", optional: true, layers: ["hand-drawn"] },
    setup: { instructions: "Read the private excerpt.", fixtures: [
      { id: "brief", path: "fixtures/brief.md", mountAs: "fixtures/brief.md", public: true, mediaType: "text/markdown" },
      { id: "excerpt", path: "excerpt.txt", mountAs: "inputs/excerpt.txt", public: false, mediaType: "text/plain" },
    ] },
  });
  for (const recipe of [layered, plain, talk, privateRecipe]) {
    await json(path.join(root, "catalog/recipes/talk", recipe.id, "recipe.json"), recipe);
    await mkdir(path.join(root, "catalog/recipes/talk", recipe.id, "fixtures"), { recursive: true });
    await writeFile(path.join(root, "catalog/recipes/talk", recipe.id, "fixtures/brief.md"), `# ${recipe.id}\n`);
  }
  await mkdir(path.join(root, "private/fixtures/private-song"), { recursive: true });
  await writeFile(path.join(root, "private/fixtures/private-song/excerpt.txt"), "secret song bytes\n");
  const authPath = path.join(root, "source-auth.json");
  await writeFile(authPath, "{}\n", { mode: 0o600 });
  return { root, authPath };
}

const session = () => ({
  threadId: "01901234-5678-7abc-8def-0123456789ab", cliVersion: "codex-cli 9.9.9-fake", failure: null,
  turns: [{ finalMessage: "Made it.", usage: { input_tokens: 1, output_tokens: 1 }, events: [] }],
});
const observed = async () => ({ model: "gpt-5.6-sol", provider: "openai", reasoningEffort: "high", serviceTier: "default", verifiedBy: "test" });

function runOptions(f, catalog, recipeId, extra = {}) {
  return {
    repoRoot: f.root, catalog, recipe: catalog.recipes.find((recipe) => recipe.id === recipeId), variant: planSelection(catalog, { configurationId: "codex-sol-high", recipeIds: [recipeId] }).variant,
    now: new Date("2026-10-15T12:00:00.000Z"), authPath: f.authPath, runSession: async () => session(), verifyIdentity: observed, ...extra,
  };
}

test("skills load from the catalog with a stable hash over source and mounted bytes", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  const skills = await loadSkills(f.root);
  assert.deepEqual(skills.map((skill) => skill.id), ["hand-drawn", "procedural", "quiet-soul"]);
  assert.equal(skills[2].delivery, "prompt");
  assert.match(skills[2].promptText, /Say less/);
  assert.match(skills[0].skillHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(skills[0].files.length, 2);
  const again = await loadSkills(f.root);
  assert.equal(again[0].skillHash, skills[0].skillHash);
  await writeFile(path.join(f.root, "catalog/skills/hand-drawn/files/SKILL.md"), "# Hand-drawn\nChanged.\n");
  assert.notEqual((await loadSkills(f.root))[0].skillHash, skills[0].skillHash);
  const catalog = await loadCatalog(f.root);
  assert.equal(catalog.skills.length, 3);
  assert.match(catalog.catalogHash, /^sha256:/);
});

test("planning refuses layers a recipe does not offer and keeps the brief hash independent of offered layers", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  const catalog = await loadCatalog(f.root);
  const none = planSelection(catalog, { configurationId: "codex-sol-high", recipeIds: ["layered-film", "plain-film"] });
  assert.equal(none.skill, null);
  assert.deepEqual(none.supported.map((item) => item.recipeId), ["layered-film", "plain-film"]);
  const handDrawn = planSelection(catalog, { configurationId: "codex-sol-high", recipeIds: ["layered-film", "plain-film"], skillId: "hand-drawn" });
  assert.equal(handDrawn.skill.id, "hand-drawn");
  assert.deepEqual(handDrawn.supported.map((item) => item.recipeId), ["layered-film"]);
  assert.match(handDrawn.unsupported[0].reasons.join(" "), /accepts no skill layer/);
  const procedural = planSelection(catalog, { configurationId: "codex-sol-high", recipeIds: ["layered-film"], skillId: "procedural" });
  assert.match(procedural.unsupported[0].reasons.join(" "), /does not list skill layer procedural/);
  assert.throws(() => planSelection(catalog, { configurationId: "codex-sol-high", recipeIds: ["layered-film"], skillId: "missing" }), /Unknown skill id/);
  const recipe = catalog.recipes.find((item) => item.id === "layered-film");
  assert.deepEqual(skillCompatibility({ ...recipe, skills: { ...recipe.skills, optional: false } }, null), ["recipe requires a skill layer; none was requested"]);
  // Offering another layer later must not change the recipe hash models already saw.
  const widened = await loadCatalog(f.root).then(async () => {
    const definition = JSON.parse(await readFile(path.join(f.root, "catalog/recipes/talk/layered-film/recipe.json"), "utf8"));
    definition.skills.layers.push("procedural");
    await json(path.join(f.root, "catalog/recipes/talk/layered-film/recipe.json"), definition);
    return loadCatalog(f.root);
  });
  assert.equal(widened.recipes.find((item) => item.id === "layered-film").recipeHash, recipe.recipeHash);
  // Declaring layers on a recipe that had none is also not a brief change.
  const plain = catalog.recipes.find((item) => item.id === "plain-film");
  const declared = await (async () => {
    const definition = JSON.parse(await readFile(path.join(f.root, "catalog/recipes/talk/plain-film/recipe.json"), "utf8"));
    definition.skills = { optional: true, layers: ["hand-drawn"] };
    await json(path.join(f.root, "catalog/recipes/talk/plain-film/recipe.json"), definition);
    return loadCatalog(f.root);
  })();
  assert.equal(declared.recipes.find((item) => item.id === "plain-film").recipeHash, plain.recipeHash);
});

test("a layered run mounts the exact skill bytes and records the layer on the dish and in its receipt", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  const catalog = await loadCatalog(f.root);
  const skill = catalog.skills[0];
  let seenWorkspace;
  const result = await executeRecipe(runOptions(f, catalog, "layered-film", {
    skill, nonce: "layer",
    runSession: async ({ workspace }) => {
      seenWorkspace = workspace;
      assert.equal(await readFile(path.join(workspace, "skill/SKILL.md"), "utf8"), "# Hand-drawn\nDraw whole cels.\n");
      assert.deepEqual((await readdir(path.join(workspace, "skill"))).sort(), ["SKILL.md", "assets"]);
      await json(path.join(workspace, "output/session.json"), { ok: true });
      return session();
    },
  }));
  assert.equal(result.status, "accepted", result.error);
  assert.match(result.dishId, /^dish_layered-film_codex-sol-high_hand-drawn_/);
  const dish = JSON.parse(await readFile(path.join(result.dishDirectory, "dish.json"), "utf8"));
  assert.deepEqual(dish.skill, { id: "hand-drawn", hash: skill.skillHash });
  assert.equal("visibility" in dish, false);
  const requested = JSON.parse(await readFile(path.join(path.dirname(seenWorkspace), "requested.json"), "utf8"));
  assert.equal(requested.skill.hash, skill.skillHash);
  assert.equal(requested.skill.mountAs, "skill");
  const { inputs, receipt } = await readDishSidecars(result.dishDirectory);
  assert.deepEqual(receipt.skill, { id: "hand-drawn", hash: skill.skillHash, source: skill.source, entry: "SKILL.md", treeHash: skill.treeHash });
  assert.equal(receipt.configuration.configHash, dish.identity.configHash);
  assert.equal(receipt.configuration.model, "gpt-5.6-sol");
  assert.equal(inputs.recipe.hash, dish.recipe.hash);
  assert.deepEqual(inputs.fixtures.map((fixture) => [fixture.id, fixture.mountAs, fixture.bytes]), [["brief", "fixtures/brief.md", "# layered-film\n".length]]);
  assert.equal(await readFile(path.join(result.dishDirectory, "inputs/fixtures/brief.md"), "utf8"), "# layered-film\n");
  assert.deepEqual(await verifyInputs(result.dishDirectory, inputs), []);
  // Receipts sit beside the manifest, not inside it, and nothing is frozen into the catalog.
  assert.equal("receipt" in dish || "inputs" in dish, false);
  await assert.rejects(readdir(path.join(f.root, "catalog/revisions")), /ENOENT/);

  const unlayered = await executeRecipe(runOptions(f, catalog, "layered-film", {
    nonce: "plain",
    runSession: async ({ workspace }) => {
      await assert.rejects(readdir(path.join(workspace, "skill")), /ENOENT/);
      await json(path.join(workspace, "output/session.json"), { ok: true });
      return session();
    },
  }));
  assert.equal(unlayered.status, "accepted", unlayered.error);
  const plainDish = JSON.parse(await readFile(path.join(unlayered.dishDirectory, "dish.json"), "utf8"));
  assert.equal("skill" in plainDish, false);
  assert.notEqual(plainDish.dishHash, dish.dishHash);

  const registry = (await buildRegistry({ repoRoot: f.root })).registry;
  assert.equal(registry.skills.length, 3);
  assert.equal(registry.skillRevisions, undefined);
  assert.equal(registry.dishes.length, 2);
  const layered = registry.dishes.find((item) => item.skill);
  assert.equal(layered.receipt.skill.hash, skill.skillHash);
  assert.equal(layered.inputs.fixtures[0].url, `/dishes/${layered.id}/inputs/fixtures/brief.md`);
  assert.deepEqual(registry.dishes.find((item) => !item.skill).receipt.skill, null);
});

test("a run that edits the mounted skill fails validation and leaves no dish", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  const catalog = await loadCatalog(f.root);
  const result = await executeRecipe(runOptions(f, catalog, "layered-film", {
    skill: catalog.skills[0], nonce: "tamper",
    runSession: async ({ workspace }) => {
      await writeFile(path.join(workspace, "skill/SKILL.md"), "# Rewritten by the model\n");
      await json(path.join(workspace, "output/session.json"), { ok: true });
      return session();
    },
  }));
  assert.equal(result.status, "failed");
  assert.match(result.error, /Skill layer hand-drawn changed during execution/);
  assert.equal((await loadDishes(f.root)).length, 0);
  // A layer the recipe does not offer is refused before any runtime side effect.
  await assert.rejects(executeRecipe(runOptions(f, catalog, "plain-film", { skill: catalog.skills[0], nonce: "refused" })), /accepts no skill layer/);
});

test("fill-missing treats each skill layer as its own coverage cell", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  const catalog = await loadCatalog(f.root);
  const make = (nonce, skill) => executeRecipe(runOptions(f, catalog, "layered-film", {
    skill, nonce,
    runSession: async ({ workspace }) => { await json(path.join(workspace, "output/session.json"), { ok: true }); return session(); },
  }));
  assert.equal((await make("none-1", null)).status, "accepted");
  const withSkill = await cook(f.root, { configurationId: "codex-sol-high", recipeIds: ["layered-film"], skillId: "hand-drawn", intent: "fill-missing" });
  assert.deepEqual(withSkill.planned.map((item) => item.recipeId), ["layered-film"]);
  assert.deepEqual(withSkill.skipped, []);
  const without = await cook(f.root, { configurationId: "codex-sol-high", recipeIds: ["layered-film"], intent: "fill-missing" });
  assert.deepEqual(without.planned, []);
  assert.deepEqual(without.skipped.map((item) => item.recipeId), ["layered-film"]);
});

test("a private recipe keeps its bytes and dishes outside the public tree", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  const catalog = await loadCatalog(f.root);
  const recipe = catalog.recipes.find((item) => item.id === "private-song");
  assert.match(recipe.recipeHash, /^sha256:/);
  assert.equal(recipe.missingPrivateFixtures, undefined);
  const result = await executeRecipe(runOptions(f, catalog, "private-song", {
    skill: catalog.skills[0], nonce: "private",
    runSession: async ({ workspace }) => {
      assert.equal(await readFile(path.join(workspace, "inputs/excerpt.txt"), "utf8"), "secret song bytes\n");
      await json(path.join(workspace, "output/session.json"), { ok: true });
      return session();
    },
  }));
  assert.equal(result.status, "accepted", result.error);
  assert.match(result.dishDirectory, /[\\/]private[\\/]dishes[\\/]/);
  assert.equal((await loadDishes(f.root)).length, 0);
  const privateDishes = await loadPrivateDishes(f.root);
  assert.equal(privateDishes.length, 1);
  assert.equal(privateDishes[0].visibility, "private");
  assert.equal(privateDishes[0].skill.id, "hand-drawn");
  // Private fixtures appear by hash only: no bytes anywhere in the Dish directory.
  const { inputs } = await readDishSidecars(result.dishDirectory);
  const excerpt = inputs.fixtures.find((item) => item.id === "excerpt");
  assert.equal(excerpt.public, false);
  assert.match(excerpt.sha256, /^sha256:/);
  assert.equal(excerpt.bytes, "secret song bytes\n".length);
  await assert.rejects(readFile(path.join(result.dishDirectory, "inputs/inputs/excerpt.txt")), /ENOENT/);
  assert.ok(!JSON.stringify(inputs).includes("secret song bytes"));
  assert.deepEqual(await verifyInputs(result.dishDirectory, inputs), []);
  const registry = (await buildRegistry({ repoRoot: f.root })).registry;
  assert.deepEqual(registry.recipes.map((item) => item.id), []);
  assert.deepEqual(registry.dishes, []);
  // The same recipe is covered for fill-missing, so a Repeat has to be explicit.
  const again = await cook(f.root, { configurationId: "codex-sol-high", recipeIds: ["private-song"], skillId: "hand-drawn", intent: "fill-missing" });
  assert.deepEqual(again.skipped.map((item) => item.recipeId), ["private-song"]);
  // Without the private bytes, the recipe loads but cannot be planned.
  await rm(path.join(f.root, "private/fixtures/private-song/excerpt.txt"));
  const absent = await loadCatalog(f.root);
  const missing = absent.recipes.find((item) => item.id === "private-song");
  assert.equal(missing.recipeHash, null);
  assert.deepEqual(missing.missingPrivateFixtures, ["excerpt"]);
  const plan = planSelection(absent, { configurationId: "codex-sol-high", recipeIds: ["private-song"] });
  assert.match(plan.unsupported[0].reasons.join(" "), /private fixtures are absent/);
});

test("a prompt-delivered skill rides inside the first turn, mounts nothing, and is recorded like any layer", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  const catalog = await loadCatalog(f.root);
  const soul = catalog.skills.find((skill) => skill.id === "quiet-soul");
  let seenTurn;
  const result = await executeRecipe(runOptions(f, catalog, "quiet-talk", {
    skill: soul, nonce: "soul",
    runSession: async ({ recipe, workspace }) => {
      seenTurn = recipe.turns[0].content;
      await assert.rejects(readdir(path.join(workspace, "skill")), /ENOENT/);
      await json(path.join(workspace, "output/session.json"), { ok: true });
      return session();
    },
  }));
  assert.equal(result.status, "accepted", result.error);
  assert.match(seenTurn, /^A skill layer is supplied with this task/);
  assert.match(seenTurn, /Say less\. Ask one thing\./);
  assert.match(seenTurn, /Make the film\.$/);
  const dish = JSON.parse(await readFile(path.join(result.dishDirectory, "dish.json"), "utf8"));
  assert.deepEqual(dish.skill, { id: "quiet-soul", hash: soul.skillHash });
  assert.equal(dish.recipe.hash, catalog.recipes.find((recipe) => recipe.id === "quiet-talk").recipeHash);
  const trace = JSON.parse(await readFile(path.join(result.dishDirectory, "trace.json"), "utf8"));
  assert.match(trace.turns[0].prompt, /Say less/);
  const requested = JSON.parse(await readFile(path.join(f.root, "private/runtime/attempts", result.attemptId, "requested.json"), "utf8"));
  assert.equal(requested.skill.delivery, "prompt");
  assert.equal("mountAs" in requested.skill, false);
  const bare = await executeRecipe(runOptions(f, catalog, "quiet-talk", {
    nonce: "bare",
    runSession: async ({ recipe, workspace }) => { assert.equal(recipe.turns[0].content, "Make the film."); await json(path.join(workspace, "output/session.json"), { ok: true }); return session(); },
  }));
  assert.equal(bare.status, "accepted", bare.error);
});
