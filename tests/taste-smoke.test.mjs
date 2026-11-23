import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { pathExists } from "../lib/taste/files.mjs";
import { loadDishes } from "../lib/taste/registry.mjs";
import { insidePrivateTree, smokeRecipe } from "../lib/taste/smoke.mjs";
import { loadToolchains, renderToolchainPin } from "../lib/taste/toolchains.mjs";

// A fake docker that runs the in-image command on the host, with the mounted
// directories substituted, so the smoke's routing can be tested without an image.
const FAKE_DOCKER = `#!/usr/bin/env node
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
if (args[0] === "image") { console.log(process.env.FAKE_TOOLCHAIN_HASH); process.exit(0); }
const mounts = {};
let i = 1;
for (; i < args.length; i++) {
  if (args[i] === "--volume") { const [host, target] = args[++i].split(":"); mounts[target] = host; }
  else if (["--network", "--memory", "--cpus", "--shm-size", "--user", "--workdir", "--env"].includes(args[i])) i++;
  else if (args[i] !== "--rm") break;
}
if (process.env.FAKE_DOCKER_LOG) fs.appendFileSync(process.env.FAKE_DOCKER_LOG, JSON.stringify({ command: args.slice(i + 1), mounts }) + "\\n");
const command = args.slice(i + 1).map((value) => Object.entries(mounts).reduce((text, [target, host]) => text.startsWith(target) ? host + text.slice(target.length) : text, value));
if (command[0] === "cat") { console.log("fake toolchain 1"); process.exit(0); }
if (command.some((value) => value.endsWith("smoke/playback.mjs"))) {
  fs.writeFileSync(path.join(mounts["/evidence"], "playback.json"), JSON.stringify({ checks: [{ name: "film plays", passed: true, detail: "fake" }], served: Object.keys(mounts).filter((target) => target.startsWith("/serve/")).map((target) => path.basename(target)) }));
  process.exit(0);
}
try { execFileSync(command[0], command.slice(1), { cwd: mounts["/work"], stdio: "inherit" }); } catch (error) { process.exit(error.status ?? 1); }
`;

async function json(filename, value) {
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, `${JSON.stringify(value, null, 2)}\n`);
}

function filmRecipe(id, extra = {}) {
  return {
    schemaVersion: 1, id, version: "0.1.0", status: "draft", title: id, summary: "A film.", cuisines: ["film"], origin: "hybrid", originNote: "Synthetic.", tags: ["motion"], kind: "web",
    harness: { workspace: "write", web: "disabled", capabilities: ["files", "shell"] },
    setup: { instructions: "Make the film.", fixtures: [
      { id: "brief", path: "fixtures/brief.md", mountAs: "fixtures/brief.md", public: true, mediaType: "text/markdown" },
      { id: "check", path: "validation/check.mjs", mountAs: "validation/check.mjs", public: true, mediaType: "text/javascript" },
      { id: "toolchain", path: "fixtures/toolchain.json", mountAs: "fixtures/toolchain.json", public: true, mediaType: "application/json" },
      ...(extra.privateFixture ? [{ id: "excerpt", path: "excerpt.txt", mountAs: "inputs/excerpt.txt", public: false, mediaType: "text/plain" }] : []),
    ] },
    toolchain: { id: "film-v1" },
    turns: extra.turns ?? [{ id: "make", role: "prompt", content: "Make it." }],
    output: { kind: "web", entry: "index.html", include: ["index.html", "evidence.json"], limits: { maxFiles: 10, maxBytes: 65536 } },
    validation: { mode: "files", checks: [{ id: "contract", type: "command", required: true, description: "Delivery check.", argv: ["node", "validation/check.mjs"] }] },
    presentation: { profile: "static-web-v1", semanticRuntime: null },
    ...(extra.visibility ? { visibility: extra.visibility } : {}),
  };
}

async function kitchen(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "taste-smoke-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await json(path.join(root, "catalog/cuisines.json"), { schemaVersion: 1, cuisines: [{ id: "film", label: "Film", description: "Films.", order: 10 }] });
  await json(path.join(root, "catalog/tags.json"), { schemaVersion: 1, tags: ["motion"] });
  await json(path.join(root, "catalog/configurations.json"), { schemaVersion: 1, configurations: [] });
  await json(path.join(root, "catalog/toolchains/film/toolchain.json"), { schemaVersion: 1, id: "film-v1", image: "kitchen/film:test" });
  const [toolchain] = await loadToolchains(root);
  for (const recipe of [filmRecipe("public-film"), filmRecipe("private-film", { visibility: "private", privateFixture: true })]) {
    const directory = path.join(root, "catalog/recipes/film", recipe.id);
    await json(path.join(directory, "recipe.json"), recipe);
    await mkdir(path.join(directory, "fixtures"), { recursive: true });
    await writeFile(path.join(directory, "fixtures/brief.md"), "# Film\n");
    await writeFile(path.join(directory, "fixtures/toolchain.json"), renderToolchainPin(toolchain));
    await mkdir(path.join(directory, "validation"), { recursive: true });
    await writeFile(path.join(directory, "validation/check.mjs"), "import { readFileSync } from 'node:fs'; if (!readFileSync('index.html', 'utf8').includes('film')) process.exit(1); console.log('PASS film');\n");
    await mkdir(path.join(root, "smoke", recipe.id), { recursive: true });
    await writeFile(path.join(root, "smoke", recipe.id, "render.mjs"), "import { writeFileSync } from 'node:fs'; writeFileSync('index.html', '<!doctype html><title>film</title>'); writeFileSync('evidence.json', '{}'); console.log('rendered');\n");
  }
  await mkdir(path.join(root, "private/fixtures/private-film"), { recursive: true });
  await writeFile(path.join(root, "private/fixtures/private-film/excerpt.txt"), "private bytes\n");
  // The pieces of Kitchen a smoke container may see (SMOKE_EQUIPMENT).
  await mkdir(path.join(root, "node_modules/playwright-core"), { recursive: true });
  await writeFile(path.join(root, "node_modules/playwright-core/index.mjs"), "export const chromium = null;\n");
  await writeFile(path.join(root, "smoke/playback.mjs"), "// fake playback\n");
  await json(path.join(root, "vercel.json"), { headers: [] });
  const docker = path.join(root, "fake-docker");
  await writeFile(docker, FAKE_DOCKER);
  await chmod(docker, 0o755);
  const dockerLog = path.join(root, "docker.log");
  return { root, dockerLog, env: { ...process.env, TASTE_DOCKER: docker, FAKE_TOOLCHAIN_HASH: toolchain.toolchainHash, FAKE_DOCKER_LOG: dockerLog } };
}

async function dockerRuns(dockerLog) {
  return (await readFile(dockerLog, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
}

test("a public film smoke publishes, lists and plays a Dish only inside its scratch Kitchen", async (t) => {
  const { root, env } = await kitchen(t);
  const result = await smokeRecipe({ repoRoot: root, recipeId: "public-film", processEnv: env, now: new Date("2026-11-09T00:00:00Z") });
  assert.equal(result.passed, true, result.error);
  assert.deepEqual(Object.keys(result.steps), ["image", "mount", "render", "publication", "registry", "playback"]);
  assert.equal(result.steps.publication.checks.find((check) => check.id === "contract").output, "PASS film");
  assert.equal(result.steps.registry.listed, true);
  assert.equal(result.recipe.status, "draft", "the smoke never changes the real Recipe");
  assert.deepEqual(await loadDishes(root), [], "no Dish enters the real dishes/");
  assert(result.directory.startsWith(path.join(root, "private", "runtime", "smoke")));
  const receipt = JSON.parse(await readFile(path.join(result.directory, "smoke.json"), "utf8"));
  assert.equal(receipt.passed, true);
  const dish = JSON.parse(await readFile(path.join(result.directory, result.steps.publication.dishDirectory, "dish.json"), "utf8"));
  assert.equal(dish.identity.provider, "none", "the Dish says no model ran");
});

test("a private film smoke keeps its Dish out of the registry and plays it from the private tree", async (t) => {
  const { root, env } = await kitchen(t);
  const result = await smokeRecipe({ repoRoot: root, recipeId: "private-film", processEnv: env });
  assert.equal(result.passed, true, result.error);
  assert.equal(result.steps.registry.listed, false);
  assert.equal(result.steps.registry.staged, false);
  assert.match(result.steps.publication.dishDirectory, /^kitchen\/private\/dishes\//u);
  const playback = JSON.parse(await readFile(path.join(result.directory, "evidence", "playback.json"), "utf8"));
  assert.deepEqual(playback.served, [result.steps.publication.dishId]);
  const inputs = JSON.parse(await readFile(path.join(result.directory, result.steps.publication.dishDirectory, "inputs.json"), "utf8"));
  assert(!JSON.stringify(inputs).includes("private bytes"));
  assert.deepEqual(await readdir(path.join(result.directory, result.steps.publication.dishDirectory, "inputs", "fixtures")).then((names) => names.sort()), ["brief.md", "toolchain.json"]);
});

test("a staged Recipe's reference carries Kitchen's smoke kit and a note for every turn", async (t) => {
  const { root, env } = await kitchen(t);
  const staged = filmRecipe("staged-film", { turns: [{ id: "first", role: "prompt", content: "Part one." }, { id: "second", role: "follow-up", content: "Part two." }] });
  staged.output.include.push("source/**");
  await json(path.join(root, "catalog/recipes/film/staged-film/recipe.json"), staged);
  for (const file of ["fixtures/brief.md", "fixtures/toolchain.json", "validation/check.mjs"]) {
    await mkdir(path.dirname(path.join(root, "catalog/recipes/film/staged-film", file)), { recursive: true });
    await writeFile(path.join(root, "catalog/recipes/film/staged-film", file), await readFile(path.join(root, "catalog/recipes/film/public-film", file)));
  }
  await mkdir(path.join(root, "smoke/kit"), { recursive: true });
  await writeFile(path.join(root, "smoke/kit/page.mjs"), "export const page = '<!doctype html><title>film from the kit</title>';\n");
  await mkdir(path.join(root, "smoke/staged-film"), { recursive: true });
  await writeFile(path.join(root, "smoke/staged-film/render.mjs"), "import { writeFileSync } from 'node:fs'; import { page } from './kit/page.mjs'; writeFileSync('index.html', page); writeFileSync('evidence.json', '{}');\n");
  const result = await smokeRecipe({ repoRoot: root, recipeId: "staged-film", processEnv: env });
  assert.equal(result.passed, true, result.error);
  const dish = path.join(result.directory, result.steps.publication.dishDirectory);
  assert.equal(await readFile(path.join(dish, "artifact/source/kit/page.mjs"), "utf8").then((text) => text.includes("film from the kit")), true, "the kit travels in source/");
  const trace = JSON.parse(await readFile(path.join(dish, "trace.json"), "utf8"));
  assert.deepEqual(trace.turns.map((turn) => [turn.id, turn.response]), [["first", "Kitchen smoke reference; no model ran."], ["second", "Kitchen smoke reference; no model ran."]]);
});

test("a smoke refuses an image built from another toolchain pin", async (t) => {
  const { root, env } = await kitchen(t);
  const result = await smokeRecipe({ repoRoot: root, recipeId: "public-film", processEnv: { ...env, FAKE_TOOLCHAIN_HASH: "sha256:older" } });
  assert.equal(result.passed, false);
  assert.match(result.steps.image.error, /built from toolchain sha256:older/u);
  assert.equal(result.steps.render, undefined);
});

test("a failing delivery check stops the smoke before publication", async (t) => {
  const { root, env } = await kitchen(t);
  await writeFile(path.join(root, "smoke/public-film/render.mjs"), "import { writeFileSync } from 'node:fs'; writeFileSync('index.html', 'nothing'); writeFileSync('evidence.json', '{}');\n");
  const result = await smokeRecipe({ repoRoot: root, recipeId: "public-film", processEnv: env });
  assert.equal(result.passed, false);
  assert.match(result.steps.publication.error, /Required validation failed: contract/u);
  assert.equal(result.steps.registry, undefined);
});

test("resuming refuses another Recipe's smoke directory and leaves its results alone", async (t) => {
  const { root, env } = await kitchen(t);
  const other = await smokeRecipe({ repoRoot: root, recipeId: "private-film", processEnv: env });
  assert.equal(other.passed, true, other.error);
  const survivor = path.join(other.directory, "kitchen");
  await assert.rejects(smokeRecipe({ repoRoot: root, recipeId: "public-film", processEnv: env, resume: other.directory }), /is a smoke of private-film, not public-film/u);
  assert.equal(await pathExists(survivor), true, "the other smoke's Kitchen tree is not deleted");
  await rm(path.join(other.directory, "smoke.json"));
  await assert.rejects(smokeRecipe({ repoRoot: root, recipeId: "private-film", processEnv: env, resume: other.directory }), /no readable smoke\.json/u);
  assert.equal(await pathExists(survivor), true);
});

test("resuming refuses a smoke made under a different Recipe hash and leaves its results alone", async (t) => {
  const { root, env } = await kitchen(t);
  const first = await smokeRecipe({ repoRoot: root, recipeId: "public-film", processEnv: env });
  assert.equal(first.passed, true, first.error);
  const receiptPath = path.join(first.directory, "smoke.json");
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  for (const hash of ["0".repeat(64), undefined]) {
    await writeFile(receiptPath, JSON.stringify({ ...receipt, recipe: { ...receipt.recipe, hash } }));
    await assert.rejects(smokeRecipe({ repoRoot: root, recipeId: "public-film", processEnv: env, resume: first.directory }), /Recipe changed since that smoke/u);
    assert.equal(await pathExists(path.join(first.directory, "kitchen")), true, "the earlier Kitchen tree is not deleted");
  }
});

test("resuming a smoke of the same Recipe repeats every step after the render", async (t) => {
  const { root, env } = await kitchen(t);
  const first = await smokeRecipe({ repoRoot: root, recipeId: "public-film", processEnv: env });
  const again = await smokeRecipe({ repoRoot: root, recipeId: "public-film", processEnv: env, resume: first.directory });
  assert.equal(again.passed, true, again.error);
  assert.equal(again.steps.render.reused, true);
});

test("no smoke container can see the checkout's private/ tree: only the workspace and named equipment are mounted", async (t) => {
  const { root, dockerLog, env } = await kitchen(t);
  // A private file of another Recipe, which no container of this smoke should reach.
  await mkdir(path.join(root, "private/fixtures/someone-else"), { recursive: true });
  await writeFile(path.join(root, "private/fixtures/someone-else/secret.txt"), "not yours\n");
  for (const recipeId of ["public-film", "private-film"]) {
    await rm(dockerLog, { force: true });
    const result = await smokeRecipe({ repoRoot: root, recipeId, processEnv: env });
    assert.equal(result.passed, true, result.error);
    const runs = await dockerRuns(dockerLog);
    const render = runs.find((run) => run.command.includes("source/render.mjs"));
    const playback = runs.find((run) => run.command.some((value) => value.endsWith("smoke/playback.mjs")));
    assert(render && playback, "the render and playback ran in containers");
    const allowed = new Set([
      path.join(result.directory, "workspace"),
      path.join(result.directory, "evidence"),
      path.join(root, "node_modules/playwright-core"),
      path.join(root, "smoke/playback.mjs"),
      path.join(root, "vercel.json"),
    ]);
    for (const run of runs) {
      for (const [target, source] of Object.entries(run.mounts)) {
        if (target.startsWith("/serve/dishes/")) {
          assert.equal(path.basename(source), result.steps.publication.dishId, "only this Dish is served");
          continue;
        }
        assert(allowed.has(source), `${run.command.join(" ")} mounts ${source} at ${target}`);
        assert.notEqual(source, root, "the checkout root is never mounted");
      }
    }
    // The private Recipe's own declared private fixture reaches its workspace, and nothing else of private/fixtures does.
    const workspaceFiles = await readdir(path.join(result.directory, "workspace"), { recursive: true });
    assert.equal(workspaceFiles.includes(path.join("inputs", "excerpt.txt")), recipeId === "private-film");
    assert(!workspaceFiles.some((file) => file.endsWith("secret.txt")));
  }
});

test("a smoke refuses to write outside the private/ tree unless told it may", async (t) => {
  const { root, env } = await kitchen(t);
  const outside = await mkdtemp(path.join(os.tmpdir(), "taste-smoke-out-"));
  t.after(() => rm(outside, { recursive: true, force: true }));
  // private/ itself is not below it, and a path that climbs back out is judged where it lands.
  for (const outDir of [path.join(outside, "film"), path.join(root, "smoke-out"), path.join(root, "private"), `${root}/private/../dishes`]) {
    await assert.rejects(smokeRecipe({ repoRoot: root, recipeId: "private-film", processEnv: env, outDir }), /outside .*private.*--out-outside-private/su);
  }
  // A link inside private/ that leads back into the repo is judged where it lands.
  await symlink(path.join(root, "catalog"), path.join(root, "private", "back-into-repo"));
  await assert.rejects(smokeRecipe({ repoRoot: root, recipeId: "private-film", processEnv: env, outDir: path.join(root, "private", "back-into-repo", "film") }), /outside .*private/su);
  assert.equal(await pathExists(path.join(outside, "film")), false, "nothing is created before the refusal");
  assert.equal(await pathExists(path.join(root, "smoke-out")), false);
  await assert.rejects(smokeRecipe({ repoRoot: root, recipeId: "private-film", processEnv: env, resume: path.join(outside, "film") }), /outside .*private/su);
  const inside = await smokeRecipe({ repoRoot: root, recipeId: "private-film", processEnv: env, outDir: path.join(root, "private", "..my-smoke") });
  assert.equal(inside.passed, true, inside.error);
  // private/ may itself be a link (a worktree borrowing the main checkout's): its real path counts as inside.
  const linked = await mkdtemp(path.join(os.tmpdir(), "taste-smoke-linked-"));
  t.after(() => rm(linked, { recursive: true, force: true }));
  await symlink(path.join(root, "private"), path.join(linked, "private"));
  assert.equal(await insidePrivateTree(linked, path.join(root, "private", "x")), true);
  assert.equal(await insidePrivateTree(linked, path.join(linked, "private", "x")), true);
  assert.equal(await insidePrivateTree(linked, path.join(linked, "x")), false);
  const allowed = await smokeRecipe({ repoRoot: root, recipeId: "public-film", processEnv: env, outDir: path.join(outside, "film"), allowOutsidePrivate: true });
  assert.equal(allowed.passed, true, allowed.error);
  assert.equal(allowed.directory, path.join(outside, "film"));
});
