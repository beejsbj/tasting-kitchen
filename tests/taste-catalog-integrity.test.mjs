import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const projectRoot = path.resolve(import.meta.dirname, "..");
const validator = path.join(projectRoot, "scripts/validate-catalog.mjs");

async function makeValidationRepository() {
  const root = await mkdtemp(path.join(os.tmpdir(), "taste-integrity-"));
  await cp(path.join(projectRoot, "catalog"), path.join(root, "catalog"), { recursive: true });
  await cp(path.join(projectRoot, "dishes"), path.join(root, "dishes"), { recursive: true });
  await cp(path.join(projectRoot, "reviews"), path.join(root, "reviews"), { recursive: true });
  return root;
}

function validate(root, args = ["--public-checkout"]) {
  return spawnSync(process.execPath, [validator, ...args], {
    cwd: projectRoot,
    encoding: "utf8",
    env: { ...process.env, TASTE_CATALOG_ROOT: root },
  });
}

// Synthetic records exercise the strict contract without copying private evidence.
async function writeSyntheticProvenance(root) {
  const directory = path.join(root, "private/provenance");
  await mkdir(directory, { recursive: true });
  const recipes = (await readdir(path.join(root, "catalog/recipes"), { recursive: true }))
    .filter((filename) => path.basename(filename) === "recipe.json");
  const files = [];
  for (const filename of recipes) {
    const recipe = JSON.parse(await readFile(path.join(root, "catalog/recipes", filename), "utf8"));
    const target = path.join(directory, `${recipe.id}.json`);
    await writeFile(target, JSON.stringify({
      schemaVersion: 1,
      recipeId: recipe.id,
      lineage: recipe.origin,
      strangerTest: "Synthetic test fixture; no authentic source material.",
      privacyReview: "Synthetic provenance for validator testing only.",
    }));
    files.push(target);
  }
  return files;
}

test("public checkout passes without provenance; the default requires it", async (t) => {
  const root = await makeValidationRepository();
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(readFile(path.join(root, "private/provenance")), { code: "ENOENT" });

  const publicResult = validate(root);
  assert.equal(publicResult.status, 0, publicResult.stderr);
  assert.match(publicResult.stdout, /private provenance skipped \(--public-checkout\)/);
  assert.doesNotMatch(publicResult.stdout, /provenance records checked/);

  const strictResult = validate(root, []);
  assert.equal(strictResult.status, 1, strictResult.stderr);
  assert.match(strictResult.stderr, /missing private\/provenance\/[^\s]+\.json/);
});

test("strict validation checks synthetic provenance; public mode always skips it", async (t) => {
  const root = await makeValidationRepository();
  t.after(() => rm(root, { recursive: true, force: true }));
  const files = await writeSyntheticProvenance(root);
  assert.ok(files.length > 0);
  const baseline = validate(root, []);
  assert.equal(baseline.status, 0, baseline.stderr);
  assert.ok(baseline.stdout.includes(`${files.length} private provenance records checked`));
  assert.doesNotMatch(baseline.stdout, /provenance skipped/);

  const original = JSON.parse(await readFile(files[0], "utf8"));
  for (const [name, contents, expected] of [
    ["invalid JSON", "{", /private\/provenance\//],
    ["invalid record", JSON.stringify({ ...original, strangerTest: "" }), /strangerTest must be meaningful/],
    ["mismatched lineage", JSON.stringify({ ...original, lineage: original.lineage === "textbook" ? "hybrid" : "textbook" }), /does not match recipe origin/],
  ]) {
    await t.test(name, async () => {
      await writeFile(files[0], contents);
      const strictResult = validate(root, []);
      assert.equal(strictResult.status, 1, strictResult.stderr);
      assert.match(strictResult.stderr, expected);
      const publicResult = validate(root);
      assert.equal(publicResult.status, 0, publicResult.stderr);
      assert.match(publicResult.stdout, /private provenance skipped/);
    });
  }
});

test("validator rejects unknown arguments instead of weakening validation", () => {
  for (const args of [["--public"], ["--public-checkout", "--typo"], ["--public-checkout", "--public-checkout"]]) {
    const result = validate(projectRoot, args);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /Usage: node scripts\/validate-catalog\.mjs \[--public-checkout\]/);
    assert.equal(result.stdout, "");
  }
});

test("public checkout still rejects catalog and skill tampering", async (t) => {
  const root = await makeValidationRepository();
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [filename, mutate, expected] of [
    ["tags.json", (doc) => { doc.tags.push(doc.tags[0]); }, /duplicate value/],
    ["skills.json", (doc) => { doc.skills[0].source.commit = "unpinned"; }, /source\.commit: has an invalid format/],
    ["skills.json", (doc) => { doc.skills[0].entry = "missing-entry.md"; }, /entry missing-entry\.md is not among the mounted files/],
  ]) {
    const target = path.join(root, "catalog", filename);
    const original = await readFile(target, "utf8");
    const doc = JSON.parse(original);
    mutate(doc);
    await writeFile(target, JSON.stringify(doc));
    const result = validate(root);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, expected);
    await writeFile(target, original);
  }
});

test("official catalog validation rejects tampered publication hashes", async (t) => {
  const root = await makeValidationRepository();
  t.after(() => rm(root, { recursive: true, force: true }));

  const baseline = validate(root);
  assert.equal(baseline.status, 0, baseline.stderr);

  const [dishId] = (await readdir(path.join(root, "dishes"))).sort();
  const manifestPath = path.join(root, "dishes", dishId, "dish.json");
  const original = JSON.parse(await readFile(manifestPath, "utf8"));

  const cases = [
    {
      name: "artifact tree hash",
      mutate: (dish) => { dish.artifact.treeHash = `sha256:${"1".repeat(64)}`; },
      expected: /artifact\.treeHash: does not match the published artifact tree/,
    },
    {
      name: "dish hash",
      mutate: (dish) => { dish.dishHash = `sha256:${"2".repeat(64)}`; },
      expected: /dishHash: does not match the canonical dish manifest/,
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const tampered = structuredClone(original);
      scenario.mutate(tampered);
      await writeFile(manifestPath, `${JSON.stringify(tampered, null, 2)}\n`);
      const result = validate(root);
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, scenario.expected);
      await writeFile(manifestPath, `${JSON.stringify(original, null, 2)}\n`);
    });
  }
});

test("official catalog validation requires an honest artifact reviewer kind", async (t) => {
  const root = await makeValidationRepository();
  t.after(() => rm(root, { recursive: true, force: true }));

  const [filename] = (await readdir(path.join(root, "reviews"))).sort();
  const reviewPath = path.join(root, "reviews", filename);
  const original = JSON.parse(await readFile(reviewPath, "utf8"));

  for (const [name, mutate, expected] of [
    ["missing reviewer kind", (review) => { delete review.reviewerKind; }, /missing reviewerKind/],
    ["invalid reviewer kind", (review) => { review.reviewerKind = "automated"; }, /reviewerKind: invalid value "automated"/],
  ]) {
    await t.test(name, async () => {
      const tampered = structuredClone(original);
      mutate(tampered);
      await writeFile(reviewPath, `${JSON.stringify(tampered, null, 2)}\n`);
      const result = validate(root);
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, expected);
    });
  }
});

test("a Dish whose configuration or brief changed since it was cooked still validates", async (t) => {
  const root = await makeValidationRepository();
  t.after(() => rm(root, { recursive: true, force: true }));
  const [dishId] = (await readdir(path.join(root, "dishes"))).sort();
  const dish = JSON.parse(await readFile(path.join(root, "dishes", dishId, "dish.json"), "utf8"));
  const configurationsPath = path.join(root, "catalog", "configurations.json");
  const configurations = JSON.parse(await readFile(configurationsPath, "utf8"));
  const current = configurations.configurations.find((configuration) => configuration.id === dish.identity.variantId);
  current.personality = "historical-test";
  await writeFile(configurationsPath, `${JSON.stringify(configurations, null, 2)}\n`);
  const result = validate(root);
  assert.equal(result.status, 0, result.stderr);
});

test("official catalog validation checks Dish sidecars against the Dish", async (t) => {
  const root = await makeValidationRepository();
  t.after(() => rm(root, { recursive: true, force: true }));
  const dishId = "dish_fresh-interaction-paper-echo_codex-luna-xhigh_20260906231527851_67821e90";
  const directory = path.join(root, "dishes", dishId);
  const inputs = JSON.parse(await readFile(path.join(directory, "inputs.json"), "utf8"));
  const receipt = JSON.parse(await readFile(path.join(directory, "receipt.json"), "utf8"));
  const publicInput = inputs.fixtures.find((fixture) => fixture.public);
  const inputFile = path.join(directory, "inputs", publicInput.mountAs);
  const originalBytes = await readFile(inputFile);

  await writeFile(inputFile, `${originalBytes}tampered`);
  let result = validate(root);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /bytes do not match recorded hash/);
  await writeFile(inputFile, originalBytes);

  await writeFile(path.join(directory, "receipt.json"), `${JSON.stringify({ ...receipt, configuration: { ...receipt.configuration, model: "someone-else" } })}\n`);
  result = validate(root);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /configuration does not reproduce identity\.configHash/);
});
