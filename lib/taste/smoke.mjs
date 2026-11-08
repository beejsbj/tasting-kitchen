import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { computeConfigHash, fixtureSourceFile, loadCatalog } from "./catalog.mjs";
import { copyTree, describeTree, pathExists, within, writeJsonAtomic } from "./files.mjs";
import { finalizeAttempt } from "./publication.mjs";
import { buildRegistry } from "./registry.mjs";
import { dockerExecutable, mountToolchainEngine, runInToolchain } from "./toolchains.mjs";

/**
 * A toolchain smoke proves a film Recipe's equipment without a model: a
 * Kitchen-made reference is rendered inside the pinned image, judged by the
 * Recipe's own required checks in that image, published through the real
 * publication path into a scratch Kitchen, staged (or, for a private Recipe,
 * withheld) by the real registry build, and played back in the gallery's
 * sandbox inside the image. Nothing it makes enters `dishes/` or the gallery.
 */
export const SMOKE_CONFIGURATION = Object.freeze({
  id: "kitchen-smoke-no-model",
  label: "Kitchen smoke reference · no model",
  provider: "none",
  model: "none",
  harness: "none",
  reasoningEffort: "none",
  serviceTier: "default",
  personality: "none",
  capabilities: ["files", "shell"],
  executionProfile: { id: "kitchen-smoke-v1", label: "Kitchen smoke · toolchain image", runtime: "toolchain-image", sandbox: "container", approvalPolicy: "never", nativeWeb: "disabled", networkPolicy: "none", filesystemBoundary: "container" },
});

function stampOf(now) {
  return now.toISOString().replace(/[-:.TZ]/g, "");
}

function capture(argv, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(argv[0], argv.slice(1), { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout }));
  });
}

async function mountFixtures(repoRoot, recipe, workspace) {
  const recipeDirectory = path.dirname(path.join(repoRoot, recipe.sourcePath));
  for (const fixture of recipe.setup.fixtures) {
    await copyTree(fixtureSourceFile(repoRoot, recipeDirectory, recipe, fixture), within(workspace, fixture.mountAs, `fixture mount ${fixture.id}`));
  }
}

/**
 * A scratch Kitchen: a copy of the catalog in which the Recipe is shown as
 * if accepted (status is display metadata and does not move the recipe hash),
 * the toolchain sources, and the private fixtures by link.
 */
async function scratchKitchen(repoRoot, recipe, scratch) {
  await cp(path.join(repoRoot, "catalog"), path.join(scratch, "catalog"), { recursive: true });
  await symlink(path.join(repoRoot, "toolchains"), path.join(scratch, "toolchains"));
  await mkdir(path.join(scratch, "dishes"), { recursive: true });
  if (await pathExists(path.join(repoRoot, "private", "fixtures"))) {
    await mkdir(path.join(scratch, "private"), { recursive: true, mode: 0o700 });
    await symlink(path.join(repoRoot, "private", "fixtures"), path.join(scratch, "private", "fixtures"));
  }
  const source = path.join(scratch, recipe.sourcePath);
  const definition = JSON.parse(await readFile(source, "utf8"));
  await writeFile(source, `${JSON.stringify({ ...definition, status: "ready" }, null, 2)}\n`);
  return loadCatalog(scratch);
}

export async function smokeRecipe({
  repoRoot,
  recipeId,
  referenceDir = path.join(repoRoot, "smoke", recipeId),
  outDir,
  now = new Date(),
  processEnv = process.env,
  log = () => {},
} = {}) {
  const catalog = await loadCatalog(repoRoot);
  const recipe = catalog.recipes.find((candidate) => candidate.id === recipeId);
  if (!recipe) throw new Error(`Unknown recipe: ${recipeId}`);
  if (!recipe.toolchainRuntime) throw new Error(`${recipeId} names no toolchain; there is nothing to smoke`);
  if (recipe.missingPrivateFixtures?.length) throw new Error(`Private fixtures are absent on this machine: ${recipe.missingPrivateFixtures.join(", ")}`);
  const stamp = stampOf(now);
  const base = outDir ?? path.join(repoRoot, "private", "runtime", "smoke", recipeId, stamp);
  const workspace = path.join(base, "workspace");
  const evidence = path.join(base, "evidence");
  await mkdir(evidence, { recursive: true, mode: 0o700 });
  await mkdir(workspace, { recursive: false });
  const image = recipe.toolchainRuntime.image;
  const kitchenMount = { source: repoRoot, target: "/kitchen" };
  const receipt = {
    schemaVersion: 1,
    kind: "toolchain-smoke",
    note: "No model ran. A Kitchen-made reference stands in for a model's delivery.",
    startedAt: now.toISOString(),
    recipe: { id: recipe.id, hash: recipe.recipeHash, status: recipe.status, visibility: recipe.visibility ?? "public" },
    toolchain: { ...recipe.toolchainRuntime },
    steps: {},
  };
  const step = async (name, action) => {
    const began = Date.now();
    log(`${name}...`);
    try {
      const result = await action();
      receipt.steps[name] = { passed: true, seconds: (Date.now() - began) / 1000, ...(result ?? {}) };
    } catch (error) {
      receipt.steps[name] = { passed: false, seconds: (Date.now() - began) / 1000, error: error.message };
      throw error;
    }
  };

  try {
    await step("image", async () => {
      const inspected = await capture([dockerExecutable(processEnv), "image", "inspect", "--format", "{{.Id}}", image], processEnv);
      if (inspected.code !== 0) throw new Error(`Toolchain image ${image} is not built; see ${recipe.toolchainRuntime.id} in toolchains/`);
      const versions = await runInToolchain(image, ["cat", "/opt/kitchen/versions.txt"], { processEnv });
      return { imageId: inspected.stdout.trim(), versions: versions.stdout.trim().split("\n") };
    });
    await step("mount", async () => {
      await mountFixtures(repoRoot, recipe, workspace);
      const engine = await mountToolchainEngine(recipe, workspace, { processEnv });
      await cp(referenceDir, path.join(workspace, "source"), { recursive: true });
      return engine ? { engine } : {};
    });
    await step("render", async () => {
      const rendered = await runInToolchain(image, ["node", "source/render.mjs"], { workspace, readOnly: false, mounts: [kitchenMount], env: { PLAYWRIGHT_CORE: "/kitchen/node_modules/playwright-core/index.mjs" }, memory: "4g", processEnv, onStderr: (chunk) => log(String(chunk).trimEnd()) });
      await writeFile(path.join(evidence, "render.log"), `${rendered.stdout}\n${rendered.stderr}`);
      if (rendered.code !== 0) throw new Error(`Reference render failed (exit ${rendered.code}): ${rendered.stderr.trim().split("\n").slice(-5).join(" | ")}`);
      return { tail: rendered.stdout.trim().split("\n").slice(-1)[0] };
    });

    const scratch = path.join(base, "kitchen");
    let dish;
    await step("publication", async () => {
      const scratchCatalog = await scratchKitchen(repoRoot, recipe, scratch);
      const scratchRecipe = scratchCatalog.recipes.find((candidate) => candidate.id === recipe.id);
      if (scratchRecipe.recipeHash !== recipe.recipeHash) throw new Error("The scratch Kitchen does not reproduce the recipe hash");
      const variant = { ...SMOKE_CONFIGURATION, configHash: computeConfigHash(SMOKE_CONFIGURATION) };
      const attemptId = `attempt_${recipe.id}_kitchen-smoke_${stamp}_${randomBytes(4).toString("hex")}`;
      const attemptDir = path.join(base, "attempt");
      await mkdir(attemptDir, { recursive: true });
      const published = await finalizeAttempt({
        repoRoot: scratch, catalog: scratchCatalog, recipe: { ...scratchRecipe, fixtureIntegrityRequired: true }, variant, attemptId, attemptDir, workspace,
        result: { cliVersion: "none", turns: [{ finalMessage: "Kitchen smoke reference; no model ran.", usage: null, events: [] }] },
        observed: { model: "none", reasoningEffort: "none", serviceTier: "default" },
        executedAt: now, env: processEnv,
      });
      dish = published;
      const validation = JSON.parse(await readFile(path.join(attemptDir, "validation.raw.json"), "utf8"));
      const tree = await describeTree(path.join(published.dishDirectory, "artifact"));
      return {
        dishId: published.dishId,
        dishDirectory: path.relative(base, published.dishDirectory),
        artifactFiles: tree.files.length,
        artifactBytes: tree.files.reduce((sum, file) => sum + file.bytes, 0),
        treeHash: tree.treeHash,
        checks: validation.checks.map(({ id, required, passed, stdout, stderr, detail }) => ({ id, required, passed, detail, output: (stdout || stderr || "").trim().split("\n").slice(-1)[0] })),
      };
    });

    const isPrivate = recipe.visibility === "private";
    await step("registry", async () => {
      const { registry } = await buildRegistry({ repoRoot: scratch });
      const listed = registry.dishes.some((candidate) => candidate.id === dish.dishId);
      const staged = await pathExists(path.join(scratch, "public", "dishes", dish.dishId));
      if (isPrivate ? listed || staged : !listed || !staged) throw new Error(`${isPrivate ? "A private Dish reached" : "The Dish is missing from"} the gallery registry (listed ${listed}, staged ${staged})`);
      const book = JSON.parse(await readFile(path.join(scratch, "public", "data", "recipe-book.json"), "utf8"));
      const inBook = JSON.stringify(book).includes(`"${recipe.id}"`);
      if (isPrivate && inBook) throw new Error("A private Recipe reached the public Recipe Book");
      return { listed, staged, inRecipeBook: inBook };
    });

    await step("playback", async () => {
      // A public Dish is played from the staged gallery tree; a private one from
      // the private tree, over loopback inside an offline container.
      const serveRoot = isPrivate ? path.join(scratch, "private") : path.join(scratch, "public");
      const played = await runInToolchain(image, ["node", "/kitchen/smoke/playback.mjs", "/serve", `/dishes/${dish.dishId}/`, "/work/fixtures/contract.json", "/evidence"], {
        workspace, mounts: [kitchenMount, { source: serveRoot, target: "/serve" }, { source: evidence, target: "/evidence", readOnly: false }], processEnv,
      });
      const report = JSON.parse(await readFile(path.join(evidence, "playback.json"), "utf8").catch(() => "{}"));
      if (played.code !== 0) throw new Error(`Playback failed: ${played.stdout.trim().split("\n").filter((line) => line.startsWith("FAIL")).join("; ") || played.stderr.trim().split("\n").slice(-3).join(" | ")}`);
      return { checks: report.checks };
    });
    receipt.passed = true;
  } catch (error) {
    receipt.passed = false;
    receipt.error = error.message;
  }
  receipt.finishedAt = new Date().toISOString();
  await writeJsonAtomic(path.join(base, "smoke.json"), receipt);
  return { ...receipt, directory: base };
}
