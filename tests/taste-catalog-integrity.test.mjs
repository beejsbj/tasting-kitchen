import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const projectRoot = path.resolve(import.meta.dirname, "..");
const validator = path.join(projectRoot, "scripts/validate-catalog.mjs");

async function makeValidationRepository() {
  const root = await mkdtemp(path.join(os.tmpdir(), "taste-integrity-"));
  await cp(path.join(projectRoot, "catalog"), path.join(root, "catalog"), { recursive: true });
  await cp(path.join(projectRoot, "private/provenance"), path.join(root, "private/provenance"), { recursive: true });
  await cp(path.join(projectRoot, "dishes"), path.join(root, "dishes"), { recursive: true });
  await cp(path.join(projectRoot, "reviews"), path.join(root, "reviews"), { recursive: true });
  return root;
}

function validate(root) {
  return spawnSync(process.execPath, [validator], {
    cwd: projectRoot,
    encoding: "utf8",
    env: { ...process.env, TASTE_CATALOG_ROOT: root },
  });
}

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
      name: "recipe hash",
      mutate: (dish) => { dish.recipe.hash = `sha256:${"0".repeat(64)}`; },
      expected: /recipe\.hash: does not match the current catalog recipe hash/,
    },
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
