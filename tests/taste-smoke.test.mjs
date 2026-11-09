import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { loadDishes } from "../lib/taste/registry.mjs";
import { smokeRecipe } from "../lib/taste/smoke.mjs";
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
const command = args.slice(i + 1).map((value) => Object.entries(mounts).reduce((text, [target, host]) => text.startsWith(target) ? host + text.slice(target.length) : text, value));
if (command[0] === "cat") { console.log("fake toolchain 1"); process.exit(0); }
if (command.some((value) => value.endsWith("smoke/playback.mjs"))) {
  fs.writeFileSync(path.join(mounts["/evidence"], "playback.json"), JSON.stringify({ checks: [{ name: "film plays", passed: true, detail: "fake" }], served: fs.readdirSync(path.join(mounts["/serve"], "dishes")) }));
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
    turns: [{ id: "make", role: "prompt", content: "Make it." }],
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
  const docker = path.join(root, "fake-docker");
  await writeFile(docker, FAKE_DOCKER);
  await chmod(docker, 0o755);
  return { root, env: { ...process.env, TASTE_DOCKER: docker, FAKE_TOOLCHAIN_HASH: toolchain.toolchainHash } };
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
