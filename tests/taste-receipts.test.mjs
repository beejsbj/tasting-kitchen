import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { sha256 } from "../lib/taste/catalog.mjs";
import { describeTree } from "../lib/taste/files.mjs";
import { buildRegistry } from "../lib/taste/registry.mjs";
import { readDishSidecars, validateSkillReceipt } from "../lib/taste/receipts.mjs";
import { computeSkillHash } from "../lib/taste/skills.mjs";

async function json(root, file, value) {
  const target = path.join(root, file);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(value));
}
async function temporary(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "taste-receipts-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

for (const change of ["tamper", "delete", "undeclared", "private", "manifest-missing", "bad-receipt"]) {
  test(`reader and registry reject ${change} of public input bytes`, async (t) => {
    const root = await temporary(t);
    // A synthetic catalog keeps this regression independent of accepted Dishes.
    await json(root, "catalog/cuisines.json", { schemaVersion: 1, cuisines: [] });
    await json(root, "catalog/tags.json", { schemaVersion: 1, tags: [] });
    await json(root, "catalog/configurations.json", { schemaVersion: 1, configurations: [] });
    await json(root, "catalog/recipes/talk/once/recipe.json", {
      id: "once", status: "ready", title: "Once", summary: "Talk once", cuisines: [], tags: [],
      kind: "session", harness: { workspace: "read", web: "disabled", capabilities: [] },
      validation: { mode: "completeness", checks: [] },
      setup: { instructions: "Respond", fixtures: [] }, turns: [{ id: "ask", role: "prompt", content: "Hello" }],
      output: { kind: "session", entry: "output/session.json", include: ["output/session.json"] },
    });
    const directory = path.join(root, "dishes/dish_once");
    await json(root, "dishes/dish_once/dish.json", {
      id: "dish_once", status: "accepted", recipe: { id: "once", hash: `sha256:${"1".repeat(64)}` },
      identity: { configHash: `sha256:${"2".repeat(64)}` },
      artifact: { kind: "session", entry: "artifact/output/session.json", files: [] },
    });
    await json(root, "dishes/dish_once/artifact/output/session.json", { turns: [] });
    const original = Buffer.from('import "../../source.js"; // verbatim approved fixture\n');
    await json(root, "dishes/dish_once/inputs.json", { fixtures: [
      { id: "source", public: true, mountAs: "source.txt", sha256: sha256(original), bytes: original.length },
      { id: "private", public: false, mountAs: "private-source.txt", sha256: sha256(original), bytes: original.length },
    ] });
    await mkdir(path.join(directory, "inputs"));
    const input = path.join(directory, "inputs/source.txt");
    await writeFile(input, original);
    assert.equal((await readDishSidecars(directory)).inputs.fixtures.length, 2);
    const output = path.join(root, "public/data/registry.json");
    await buildRegistry({ repoRoot: root });
    const published = await readFile(output, "utf8");
    const publicRoot = path.join(root, "public");
    const publishedTree = await describeTree(publicRoot);
    const publicInput = path.join(publicRoot, "dishes/dish_once/inputs/source.txt");
    assert.deepEqual(await readFile(publicInput), original, "declared public input stays verbatim");
    let error;
    if (change === "tamper") { await writeFile(input, "modified fixture"); error = /source: bytes do not match recorded hash/; }
    if (change === "delete") { await rm(input); error = /source: file missing/; }
    if (change === "undeclared" || change === "private") {
      const filename = change === "private" ? "private-source.txt" : "undeclared.txt";
      await writeFile(path.join(directory, "inputs", filename), "/home/synthetic/private/notes.txt");
      error = /undeclared public input file/;
    }
    if (change === "manifest-missing") { await rm(path.join(directory, "inputs.json")); error = /undeclared public input file/; }
    if (change === "bad-receipt") { await writeFile(path.join(directory, "receipt.json"), "{"); error = /JSON|Unexpected|Expected/; }
    await assert.rejects(readDishSidecars(directory), error);
    await assert.rejects(buildRegistry({ repoRoot: root }), error);
    assert.equal(await readFile(output, "utf8"), published, "failed build must not publish a new registry");
    assert.deepEqual(await describeTree(publicRoot), publishedTree, "rejected build preserves every published file byte-for-byte");
    assert.deepEqual(await readFile(publicInput), original, "rejected build preserves published input bytes");
    await rm(path.join(directory, "inputs.json"), { force: true });
    await rm(path.join(directory, "receipt.json"), { force: true });
    await rm(path.join(directory, "inputs"), { recursive: true, force: true });
    assert.deepEqual(await readDishSidecars(directory), { inputs: null, receipt: null });
    const legacy = await buildRegistry({ repoRoot: root });
    assert.equal(legacy.registry.dishes[0].inputs, undefined);
  });
}

function skill(delivery = "workspace") {
  const value = {
    id: "historical", source: { repository: "https://github.com/example/workflows", commit: "a".repeat(40), path: "skills/history", license: "MIT" },
    entry: "SKILL.md", treeHash: `sha256:${"b".repeat(64)}`, delivery,
    ...(delivery === "workspace" ? { mountAs: "guidance/history" } : {}),
  };
  return { ...value, hash: computeSkillHash(value, value.treeHash) };
}
const dishSkill = (value) => ({ id: value.id, hash: value.hash });

test("historical pinned receipts remain valid after the catalog moves", () => {
  const historical = skill();
  const current = { ...historical, source: { ...historical.source, commit: "c".repeat(40) } };
  assert.notEqual(computeSkillHash(current, current.treeHash), historical.hash);
  assert.deepEqual(validateSkillReceipt(historical, dishSkill(historical)), historical);
  const legacy = { ...historical };
  delete legacy.delivery;
  assert.equal(validateSkillReceipt(legacy, dishSkill(historical)).delivery, "workspace");
  const prompt = skill("prompt");
  assert.deepEqual(validateSkillReceipt(prompt, dishSkill(prompt)), prompt);
  const unlicensed = skill();
  delete unlicensed.source.license;
  unlicensed.hash = computeSkillHash(unlicensed, unlicensed.treeHash);
  assert.doesNotThrow(() => validateSkillReceipt(unlicensed, dishSkill(unlicensed)));
});

for (const [label, mutate] of Object.entries({
  id: (s) => { s.id = "another"; },
  hash: (s) => { s.hash = `sha256:${"c".repeat(64)}`; },
  source: (s) => { s.source.commit = "c".repeat(40); },
  entry: (s) => { s.entry = "OTHER.md"; },
  tree: (s) => { s.treeHash = `sha256:${"c".repeat(64)}`; },
  delivery: (s) => { s.delivery = "prompt"; delete s.mountAs; },
})) {
  test(`rejects tampered ${label} against the immutable Dish`, () => {
    const original = skill();
    const changed = structuredClone(original);
    mutate(changed);
    assert.throws(() => validateSkillReceipt(changed, dishSkill(original)));
  });
}

for (const [label, mutate] of Object.entries({
  repository: (s) => { s.source.repository = "http://example.com/owner/repo"; },
  credentials: (s) => { s.source.repository = "https://user@github.com/owner/repo"; },
  commit: (s) => { s.source.commit = "main"; },
  sourcePath: (s) => { s.source.path = "../outside"; },
  entry: (s) => { s.entry = "/SKILL.md"; },
  windowsEntry: (s) => { s.entry = "C:/SKILL.md"; },
  treeHash: (s) => { s.treeHash = "not-a-digest"; },
  delivery: (s) => { s.delivery = "other"; },
  nullDelivery: (s) => { s.delivery = null; },
  mountMissing: (s) => { delete s.mountAs; },
  mountTraversal: (s) => { s.mountAs = "guidance/../../outside"; },
  mountWindows: (s) => { s.mountAs = "C:/outside"; },
  license: (s) => { s.source.license = ""; },
})) {
  test(`rejects invalid ${label} even when its hash matches`, () => {
    const value = skill();
    mutate(value);
    value.hash = computeSkillHash(value, value.treeHash);
    assert.throws(() => validateSkillReceipt(value, dishSkill(value)));
  });
}

test("prompt mounts are forbidden; safe workspace mounts do not change skill identity", () => {
  const prompt = { ...skill("prompt"), mountAs: "skill" };
  assert.throws(() => validateSkillReceipt(prompt, dishSkill(prompt)), /must not have mountAs/);
  const workspace = skill();
  workspace.mountAs = "another/safe/mount";
  assert.equal(computeSkillHash(workspace, workspace.treeHash), workspace.hash);
  assert.doesNotThrow(() => validateSkillReceipt(workspace, dishSkill(workspace)));
});
