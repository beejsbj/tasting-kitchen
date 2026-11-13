import { spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { hashCanonical } from "./catalog.mjs";
import { describeTree, pathExists } from "./files.mjs";

/**
 * A toolchain is the pinned execution image a Recipe is made, validated and
 * played back in. Its source lives in `catalog/toolchains/<name>/` beside a
 * `toolchain.json` pin; the toolchain hash binds the pin and every build file.
 * A Recipe names its toolchain in `toolchain.id` and carries the generated pin
 * as a fixture, so the pin's bytes enter the recipe hash and the model can read
 * exactly what it was given.
 */
export const TOOLCHAINS_DIRECTORY = path.join("catalog", "toolchains");
export const TOOLCHAIN_FIXTURE_ID = "toolchain";
const TOOLCHAIN_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export function computeToolchainHash(toolchain, treeHash) {
  return hashCanonical({ id: toolchain.id, image: toolchain.image, treeHash });
}

/** Load every `catalog/toolchains/<name>/toolchain.json` and hash its build directory. */
export async function loadToolchains(repoRoot) {
  const root = path.join(repoRoot, TOOLCHAINS_DIRECTORY);
  if (!await pathExists(root)) return [];
  const entries = (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  const toolchains = [];
  for (const name of entries) {
    const directory = path.join(root, name);
    const filename = path.join(directory, "toolchain.json");
    if (!await pathExists(filename)) continue;
    const pin = JSON.parse(await readFile(filename, "utf8"));
    if (pin.schemaVersion !== 1 || typeof pin.id !== "string" || !TOOLCHAIN_ID.test(pin.id)) throw new Error(`${TOOLCHAINS_DIRECTORY}/${name}/toolchain.json needs schemaVersion 1 and a kebab-case id`);
    if (typeof pin.image !== "string" || pin.image.length === 0) throw new Error(`Toolchain ${pin.id} needs an image tag`);
    if (toolchains.some((toolchain) => toolchain.id === pin.id)) throw new Error(`Duplicate toolchain id: ${pin.id}`);
    const described = await describeTree(directory);
    toolchains.push({ ...pin, directory, treeHash: described.treeHash, toolchainHash: computeToolchainHash(pin, described.treeHash) });
  }
  return toolchains;
}

/** What Kitchen needs at run time: the image, its hash and the engine it must carry. */
export function toolchainRuntime(toolchain) {
  const engine = toolchain.lyricEngine;
  return {
    id: toolchain.id,
    image: toolchain.image,
    toolchainHash: toolchain.toolchainHash,
    ...(engine ? { engine: { commit: engine.commit, patchSha256: engine.patch.sha256, fontsCommit: engine.fonts.commit } } : {}),
  };
}

export function resolveToolchain(toolchains, id) {
  const toolchain = toolchains.find((candidate) => candidate.id === id);
  if (!toolchain) throw new Error(`Unknown toolchain id: ${id}`);
  return toolchain;
}

/** The exact bytes a Recipe's `toolchain` fixture must hold for the current pin. */
export function renderToolchainPin(toolchain) {
  const pin = { ...toolchain };
  delete pin.directory;
  return `${JSON.stringify(pin, null, 2)}\n`;
}

/** Recipes whose toolchain fixture no longer matches the toolchain source. */
export async function toolchainPinFindings(repoRoot, recipes, toolchains) {
  const findings = [];
  for (const recipe of recipes) {
    if (!recipe.toolchain) continue;
    const toolchain = toolchains.find((candidate) => candidate.id === recipe.toolchain.id);
    if (!toolchain) { findings.push(`${recipe.id}: unknown toolchain ${recipe.toolchain.id}`); continue; }
    const fixture = recipe.setup.fixtures.find((candidate) => candidate.id === TOOLCHAIN_FIXTURE_ID);
    if (!fixture || fixture.public === false) { findings.push(`${recipe.id}: needs a public "${TOOLCHAIN_FIXTURE_ID}" fixture holding the pin`); continue; }
    const filename = path.join(repoRoot, path.dirname(recipe.sourcePath), fixture.path);
    const actual = await readFile(filename, "utf8").catch(() => null);
    if (actual !== renderToolchainPin(toolchain)) findings.push(`${recipe.id}: ${fixture.path} is stale; run node scripts/pin-toolchain.mjs`);
  }
  return findings;
}

/**
 * argv that runs a command inside a toolchain image: no network, the caller's
 * uid, a bounded envelope, and only the given mounts. The workspace is /work.
 */
export function toolchainArgv(image, command, {
  workspace,
  readOnly = true,
  mounts = [],
  env = {},
  user = typeof process.getuid === "function" ? `${process.getuid()}:${process.getgid()}` : undefined,
  memory = "3g",
  cpus = "3",
} = {}) {
  if (!Array.isArray(command) || command.length === 0) throw new TypeError("command must be a non-empty argv");
  const argv = ["run", "--rm", "--network", "none", "--memory", memory, "--cpus", cpus, "--shm-size", "1g"];
  if (user) argv.push("--user", user);
  if (workspace) argv.push("--volume", `${path.resolve(workspace)}:/work${readOnly ? ":ro" : ""}`, "--workdir", "/work");
  for (const mount of mounts) argv.push("--volume", `${path.resolve(mount.source)}:${mount.target}${mount.readOnly === false ? "" : ":ro"}`);
  for (const [key, value] of Object.entries(env)) argv.push("--env", `${key}=${value}`);
  argv.push(image, ...command);
  return argv;
}

/** The label binding a built image to the toolchain hash it was built from. */
export const TOOLCHAIN_LABEL = "kitchen.toolchain-hash";

/**
 * Refuse an image whose label does not name the current toolchain hash: a
 * stale local build keeps its tag after the pin moves, and must not judge or
 * equip a Run recorded against the new hash.
 */
export async function assertToolchainImage(runtime, { processEnv = process.env } = {}) {
  const inspected = await new Promise((resolve, reject) => {
    const child = spawn(dockerExecutable(processEnv), ["image", "inspect", "--format", `{{ index .Config.Labels "${TOOLCHAIN_LABEL}" }}`, runtime.image], { env: processEnv, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout }));
  });
  if (inspected.code !== 0) throw new Error(`Toolchain image ${runtime.image} is not built; run node scripts/build-toolchain.mjs ${runtime.id}`);
  const label = inspected.stdout.trim();
  if (label !== runtime.toolchainHash) {
    throw new Error(`Image ${runtime.image} was built from toolchain ${label && label !== "<no value>" ? label : "(unlabelled)"}; the pin is ${runtime.toolchainHash}. Run node scripts/build-toolchain.mjs ${runtime.id} to rebuild it.`);
  }
  return label;
}

export function dockerExecutable(env = process.env) {
  return env.TASTE_DOCKER || "docker";
}

/** Run argv inside the image; output is kept to the last 64 KiB like any check. */
export function runInToolchain(image, command, options = {}) {
  const env = options.processEnv ?? process.env;
  const argv = toolchainArgv(image, command, options);
  return new Promise((resolve, reject) => {
    const child = spawn(dockerExecutable(env), argv, { env, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const append = (current, chunk) => `${current}${chunk}`.slice(-65536);
    child.stdout.on("data", (chunk) => { stdout = append(stdout, chunk); options.onStdout?.(chunk); });
    child.stderr.on("data", (chunk) => { stderr = append(stderr, chunk); options.onStderr?.(chunk); });
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

/**
 * Shell run inside the image to supply the engine at "$1". Upstream ships
 * another song's recording in audio/ and its analysis in data/, and the engine
 * silently falls back to data/*.approx.json, so both are emptied: a Recipe's own
 * inputs are the only song the engine can find.
 */
export const ENGINE_MOUNT_SCRIPT = 'cp -a "$KITCHEN_ENGINE" "$1" && rm -rf "$1/audio" "$1/data" && mkdir "$1/audio" "$1/data" && cat "$KITCHEN_ENGINE/../engine.json"';

/**
 * Copy the toolchain's engine into a workspace at the Recipe's engine mount.
 * The copy happens inside the image, so the bytes are the image's own, and
 * the image's engine.json must still name the pinned commit and patch.
 */
export async function mountToolchainEngine(recipe, workspace, { processEnv = process.env } = {}) {
  const mount = recipe.toolchain?.engineMount;
  if (!mount) return null;
  const runtime = recipe.toolchainRuntime;
  const image = runtime?.image;
  if (!image) throw new Error(`Recipe ${recipe.id} has no toolchain image to supply ${mount}/`);
  await assertToolchainImage(runtime, { processEnv });
  const target = path.posix.join("/work", mount);
  const result = await runInToolchain(image, ["sh", "-c", ENGINE_MOUNT_SCRIPT, "mount-engine", target], { workspace, readOnly: false, processEnv });
  if (result.code !== 0) throw new Error(`Cannot supply ${mount}/ from ${image}: ${result.stderr.trim() || `exit ${result.code}`}`);
  const assembled = JSON.parse(result.stdout);
  const pinned = runtime.engine;
  if (!pinned || assembled.commit !== pinned.commit || assembled.patchSha256 !== pinned.patchSha256 || assembled.fontsCommit !== pinned.fontsCommit) {
    throw new Error(`Image ${image} carries engine ${assembled.commit} with patch ${assembled.patchSha256}; the pin is ${pinned?.commit} with ${pinned?.patchSha256}. Rebuild the toolchain image.`);
  }
  return assembled;
}
