import assert from "node:assert/strict";
import { appendFile, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { playPattern, playSample, sampleSteps } from "../catalog/recipes/music-creative-code/play-a-short-set/stage.mjs";
import { loadCatalog } from "../lib/taste/catalog.mjs";
import { executeRecipe } from "../lib/taste/runner.mjs";

// The music room Recipe cooked by Kitchen's own runner, with a stand-in for the
// model: a session that plays a hand-written sample set by running the room.
const repoRoot = path.resolve(import.meta.dirname, "..");
const catalog = await loadCatalog(repoRoot);
const recipe = catalog.recipes.find((candidate) => candidate.id === "play-a-short-set");

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
const session = () => ({
  threadId: "01901234-5678-7abc-8def-0123456789ab",
  cliVersion: "codex-cli 9.9.9-fake",
  failure: null,
  turns: [{ finalMessage: "The set is played.", usage: { input_tokens: 10, output_tokens: 3 }, events: [{ type: "item.completed", item: { type: "command_execution", status: "completed", exit_code: 0 } }] }],
});
const observed = async () => ({ model: "gpt-5.6-sol", provider: "openai", reasoningEffort: "high", serviceTier: "default", verifiedBy: "test" });

// Kitchen's runner cooks on linux-host only, so these run where the Kitchen does (and in CI).
const cooks = { skip: process.platform === "linux" ? false : "the runner cooks on linux-host only" };

// A scratch Kitchen holding only this Recipe, so Dishes and private evidence never land in the checkout.
async function cook(t, nonce, perform) {
  const root = await mkdtemp(path.join(os.tmpdir(), "taste-music-room-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const recipeDirectory = path.dirname(recipe.sourcePath);
  await mkdir(path.dirname(path.join(root, recipeDirectory)), { recursive: true });
  await cp(path.join(repoRoot, recipeDirectory), path.join(root, recipeDirectory), { recursive: true });
  const authPath = path.join(root, "source-auth.json");
  await writeFile(authPath, "{}\n", { mode: 0o600 });
  return executeRecipe({
    repoRoot: root,
    catalog: { catalogHash: catalog.catalogHash, root, recipes: [recipe] },
    recipe,
    variant,
    now: new Date("2026-11-13T12:00:00.000Z"),
    nonce,
    authPath,
    // The Recipe is a draft: its benchmark shape awaits the owner, so only a test may run it.
    allowStatuses: ["draft"],
    runSession: async ({ workspace }) => { await perform(workspace); return session(); },
    verifyIdentity: observed,
  });
}

test("the music room Recipe is a draft the planner will not cook", () => {
  assert.equal(recipe.status, "draft");
  assert.deepEqual(recipe.harness, { workspace: "write", web: "disabled", capabilities: ["files", "shell"] });
  assert.match(recipe.recipeHash, /^sha256:[a-f0-9]{64}$/u);
});

test("a Run that plays the whole set through the room publishes one Dish: the recording and its player", cooks, async (t) => {
  let mounted;
  const result = await cook(t, "played", async (workspace) => {
    mounted = (await readdir(path.join(workspace, "room"))).sort();
    await playSample(workspace, "night-bus");
  });
  assert.equal(result.status, "accepted", result.error);
  assert.deepEqual(mounted, ["LICENSE", "NOTICE.md", "README.md", "player.html", "room.mjs", "strudel"]);

  const dish = JSON.parse(await readFile(path.join(result.dishDirectory, "dish.json"), "utf8"));
  assert.equal(dish.recipe.hash, recipe.recipeHash);
  assert.equal(dish.artifact.kind, "web");
  assert.equal(dish.artifact.entry, "artifact/index.html");
  // The room's working files (.room/, the model's pattern files) stay behind.
  assert.deepEqual(dish.artifact.files.map((file) => file.path), ["artifact/index.html", "artifact/recording.json", "artifact/worklets.js"]);

  const recording = JSON.parse(await readFile(path.join(result.dishDirectory, "artifact/recording.json"), "utf8"));
  assert.equal(recording.complete, true);
  assert.equal(recording.entries.filter((entry) => entry.kind === "step").length, 12);
  assert.deepEqual(recording.entries.map((entry) => entry.code), await sampleSteps("night-bus"));
  const validation = JSON.parse(await readFile(path.join(result.dishDirectory, "validation.json"), "utf8"));
  assert.equal(validation.passed, true);
  assert.equal(validation.checks.find((check) => check.id === "room-recording").passed, true);

  // The Dish carries the equipment the model was given, licence included, beside its artifact.
  const inputs = JSON.parse(await readFile(path.join(result.dishDirectory, "inputs.json"), "utf8"));
  assert.deepEqual(inputs.fixtures.map((fixture) => fixture.mountAs).sort(), recipe.setup.fixtures.map((fixture) => fixture.mountAs).sort());
  assert.match(await readFile(path.join(result.dishDirectory, "inputs/room/LICENSE"), "utf8"), /GNU AFFERO GENERAL PUBLIC LICENSE/u);
  assert.deepEqual(await readFile(path.join(result.dishDirectory, "inputs/room/strudel/worklets.js")), await readFile(path.join(result.dishDirectory, "artifact/worklets.js")));
});

test("a Run that stops before the set is whole is a No Dish, by the room's check", cooks, async (t) => {
  const result = await cook(t, "unfinished", async (workspace) => {
    for (const [index, code] of (await sampleSteps("tide")).slice(0, 4).entries()) await playPattern(workspace, `0${index + 1}`, code);
  });
  assert.equal(result.status, "failed");
  assert.match(result.error, /Required validation failed: room-recording/u);
  assert.deepEqual([result.fault.class, result.fault.code], ["chef", "checks-failed"]);
});

test("a Run that never plays leaves no Dish to select", cooks, async (t) => {
  const result = await cook(t, "silent", async () => {});
  assert.equal(result.status, "failed");
  assert.deepEqual([result.fault.class, result.fault.code], ["chef", "output-contract"]);
});

test("a Run that edits the room breaks the output contract, even if the edit would pass the check", cooks, async (t) => {
  const result = await cook(t, "edited", async (workspace) => {
    await playSample(workspace, "tide");
    await appendFile(path.join(workspace, "room/room.mjs"), "\n// tuned\n");
  });
  assert.equal(result.status, "failed");
  assert.match(result.error, /Fixture room-program changed during execution/u);
  assert.deepEqual([result.fault.class, result.fault.code], ["chef", "output-contract"]);
});
