import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { computeRecipeHash, loadCatalog } from "../lib/taste/catalog.mjs";
import { runChecks } from "../lib/taste/checks.mjs";
import {
  loadToolchains,
  mountToolchainEngine,
  renderToolchainPin,
  toolchainArgv,
  toolchainPinFindings,
} from "../lib/taste/toolchains.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const film = JSON.parse(await readFile(path.join(repoRoot, "catalog/toolchains/film/toolchain.json"), "utf8"));
const lyricSkill = path.join(repoRoot, "catalog/skills/lyric-music-video/files");

test("the film Dockerfile builds exactly what toolchain.json pins", async () => {
  const dockerfile = await readFile(path.join(repoRoot, film.dockerfile), "utf8");
  assert.match(dockerfile, new RegExp(`^FROM ${film.base.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}$`, "mu"), "base image pinned by digest");
  assert.match(film.base, /@sha256:[a-f0-9]{64}$/u);
  assert.match(dockerfile, new RegExp(`^ARG DEBIAN_SNAPSHOT=${film.debianSnapshot}$`, "mu"));
  assert.match(dockerfile, new RegExp(`^ARG BUN_VERSION=${film.bun.replaceAll(".", "\\.")}$`, "mu"));
  assert.match(dockerfile, /require\('\/opt\/kitchen\/toolchain\.json'\)\.packages/u, "packages come from the pin");
  for (const tool of ["chromium", "ffmpeg", "python3"]) assert(film.packages.includes(tool), `${tool} is in the image`);
  assert.equal(film.chromePath, "/usr/bin/chromium");
  // The build context is an allowlist; every file the Dockerfile copies must be in it.
  const ignore = await readFile(path.join(repoRoot, "catalog/toolchains/film/Dockerfile.dockerignore"), "utf8");
  for (const copied of dockerfile.matchAll(/^COPY (\S+) /gmu)) {
    const source = copied[1];
    assert(ignore.split("\n").some((line) => line === `!${source}` || line === `!${source}/**`), `${source} is in the build context`);
  }
});

test("the lyric engine pin matches the skill's own engine.patch and brand bytes", async () => {
  const engine = film.lyricEngine;
  assert.equal(engine.patch.skill, "lyric-music-video");
  assert.equal(sha256(await readFile(path.join(lyricSkill, engine.patch.path))), engine.patch.sha256, "engine.patch moved: re-pin catalog/toolchains/film/toolchain.json");
  assert.match(engine.commit, /^[a-f0-9]{40}$/u);
  // The skill's setup script names the upstream commit its patch was made against.
  const setup = await readFile(path.join(lyricSkill, "scripts/new-project.sh"), "utf8");
  assert.equal(setup.match(/^BASE=([a-f0-9]+)/mu)?.[1], engine.commit.slice(0, 7));
  assert.match(setup, new RegExp(`UPSTREAM=${engine.repository.replaceAll(".", "\\.")}$`, "mu"));
  const brand = await readFile(path.join(lyricSkill, engine.brand.path), "utf8");
  assert.equal(sha256(brand), engine.brand.sha256);
  const overlay = await readFile(path.join(repoRoot, engine.brand.overlay), "utf8");
  const changed = overlay.split("\n").filter((line, index) => line !== brand.split("\n")[index]);
  assert.deepEqual(changed, ["export const X_HANDLE = '';", "export const TG_HANDLE = '';"], "the overlay only clears the watermark handles");
  for (const font of engine.fonts.files) assert.match(font.sha256, /^[a-f0-9]{64}$/u);
});

test("a toolchain hash binds its pin and every build file", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "taste-toolchain-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "catalog/toolchains/film"), { recursive: true });
  await writeFile(path.join(root, "catalog/toolchains/film/toolchain.json"), JSON.stringify({ schemaVersion: 1, id: "film-v1", image: "kitchen/film:v1" }));
  await writeFile(path.join(root, "catalog/toolchains/film/Dockerfile"), "FROM scratch\n");
  const [first] = await loadToolchains(root);
  assert.equal(first.id, "film-v1");
  await writeFile(path.join(root, "catalog/toolchains/film/Dockerfile"), "FROM scratch\nRUN true\n");
  const [second] = await loadToolchains(root);
  assert.notEqual(second.toolchainHash, first.toolchainHash);
  assert(!renderToolchainPin(second).includes(root), "the pin carries no host path");
});

test("naming a toolchain moves the recipe hash; recipes without one keep theirs", () => {
  const recipe = {
    kind: "web", harness: { workspace: "write", web: "disabled", capabilities: ["shell", "files"] },
    setup: { instructions: "Make it.", fixtures: [] }, turns: [{ id: "t", role: "prompt", content: "Go." }],
    output: { kind: "web", entry: "index.html", include: ["index.html"] }, validation: { mode: "files", checks: [] },
  };
  const plain = computeRecipeHash(recipe, {});
  assert.equal(computeRecipeHash({ ...recipe, toolchain: undefined }, {}), plain);
  const pinned = computeRecipeHash({ ...recipe, toolchain: { id: "film-v1" } }, {});
  assert.notEqual(pinned, plain);
  assert.notEqual(computeRecipeHash({ ...recipe, toolchain: { id: "film-v1", engineMount: "engine" } }, {}), pinned);
});

test("both film recipes are on film-v1 with a current pin, and the catalog resolves the image", async () => {
  const catalog = await loadCatalog(repoRoot);
  const toolchains = await loadToolchains(repoRoot);
  const recipes = catalog.recipes.filter((recipe) => ["heavy-little-suitcase", "lyric-video-section"].includes(recipe.id));
  assert.equal(recipes.length, 2);
  for (const recipe of recipes) {
    assert.equal(recipe.toolchain.id, "film-v1");
    assert.equal(recipe.toolchainRuntime.image, film.image);
    assert.equal(recipe.status, "draft", "readiness does not accept the benchmark shape");
  }
  assert.equal(recipes.find((recipe) => recipe.id === "lyric-video-section").toolchain.engineMount, "engine");
  assert.deepEqual(await toolchainPinFindings(repoRoot, recipes, toolchains), []);
  const stale = recipes.map((recipe) => ({ ...recipe, setup: { ...recipe.setup, fixtures: recipe.setup.fixtures.map((fixture) => fixture.id === "toolchain" ? { ...fixture, path: "fixtures/brief.md" } : fixture) } }));
  assert.equal((await toolchainPinFindings(repoRoot, stale, toolchains)).length, 2);
});

async function fakeDocker(t, script) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "taste-docker-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const executable = path.join(directory, "docker");
  await writeFile(executable, `#!/bin/sh\nprintf '%s\\n' "$@" > "${directory}/argv"\n${script}\n`);
  await chmod(executable, 0o755);
  return { env: { ...process.env, TASTE_DOCKER: executable }, argv: async () => (await readFile(path.join(directory, "argv"), "utf8")).trim().split("\n") };
}

test("toolchain recipes run their command checks inside the image, offline and read-only", async (t) => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "taste-toolchain-ws-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const docker = await fakeDocker(t, "echo 'PASS in image'");
  const recipe = {
    id: "film", toolchainRuntime: { id: "film-v1", image: "kitchen/film:v1" },
    validation: { checks: [{ id: "film-contract", type: "command", required: true, description: "Film.", argv: ["node", "validation/film.mjs"] }] },
  };
  const result = await runChecks(recipe, workspace, { env: docker.env });
  assert.equal(result.passed, true);
  assert.match(result.checks[0].stdout, /PASS in image/u);
  const argv = await docker.argv();
  assert.deepEqual(argv.slice(0, 4), ["run", "--rm", "--network", "none"]);
  assert(argv.includes(`${workspace}:/work:ro`));
  assert.deepEqual(argv.slice(-3), ["kitchen/film:v1", "node", "validation/film.mjs"]);
  const failing = await fakeDocker(t, "exit 3");
  assert.equal((await runChecks(recipe, workspace, { env: failing.env })).passed, false);
});

test("toolchainArgv never mounts more than it is given", () => {
  const argv = toolchainArgv("img", ["true"], { workspace: "/tmp/ws", readOnly: false, user: "1:1", mounts: [{ source: "/tmp/r", target: "/kitchen" }], env: { A: "b" } });
  assert.deepEqual(argv.filter((value, index) => argv[index - 1] === "--volume"), ["/tmp/ws:/work", "/tmp/r:/kitchen:ro"]);
  assert(argv.includes("A=b"));
  assert.throws(() => toolchainArgv("img", []), /non-empty argv/u);
});

test("the lyric engine is copied from the image only when the image carries the pinned engine", async (t) => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "taste-toolchain-ws-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const engine = { commit: film.lyricEngine.commit, patchSha256: film.lyricEngine.patch.sha256, fontsCommit: film.lyricEngine.fonts.commit };
  const recipe = { id: "lyric", toolchain: { id: "film-v1", engineMount: "engine" }, toolchainRuntime: { id: "film-v1", image: "kitchen/film:v1", engine } };
  const good = await fakeDocker(t, `echo '${JSON.stringify(engine)}'`);
  assert.deepEqual(await mountToolchainEngine(recipe, workspace, { processEnv: good.env }), engine);
  const argv = await good.argv();
  assert(argv.includes(`${workspace}:/work`), "the engine copy writes the workspace");
  assert(argv.includes("/work/engine"));
  const drifted = await fakeDocker(t, `echo '${JSON.stringify({ ...engine, patchSha256: "0".repeat(64) })}'`);
  await assert.rejects(mountToolchainEngine(recipe, workspace, { processEnv: drifted.env }), /Rebuild the toolchain image/u);
  assert.equal(await mountToolchainEngine({ id: "plain" }, workspace, { processEnv: good.env }), null);
});
