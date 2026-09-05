import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  canonicalJson,
  computeConfigHash,
  computeRecipeHash,
  hashCanonical,
  listRecipes,
  loadCatalog,
  planSelection,
  resolveVariant,
  sha256
} from "../lib/taste/catalog.mjs";

const projectRoot = path.resolve(import.meta.dirname, "..");

function recipe(id, overrides = {}) {
  return {
    schemaVersion: 1,
    id,
    version: "1.0.0",
    status: "ready",
    title: `Recipe ${id}`,
    summary: `A sufficiently descriptive summary for ${id}.`,
    domain: "first-domain",
    origin: "textbook",
    originNote: "A conventional test fixture for the catalog tests.",
    tags: ["one"],
    kind: "session",
    harness: { workspace: "read", web: "disabled", capabilities: [] },
    setup: { instructions: "Use only the supplied material.", fixtures: [] },
    turns: [{ id: "ask", role: "prompt", content: `Perform ${id}.` }],
    output: {
      kind: "session",
      entry: "output/session.json",
      include: ["output/session.json"],
      limits: { maxFiles: 2, maxBytes: 4096 }
    },
    validation: {
      mode: "completeness",
      checks: [{ id: "entry", type: "file-exists", required: true, description: "Output exists.", target: "output/session.json" }]
    },
    ...overrides
  };
}

async function writeJson(filename, value) {
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, `${JSON.stringify(value, null, 2)}\n`);
}

async function makeRepository() {
  const root = await mkdtemp(path.join(os.tmpdir(), "taste-catalog-"));
  await writeJson(path.join(root, "catalog/domains.json"), {
    schemaVersion: 1,
    domains: [
      { id: "first-domain", label: "First", description: "The first test domain.", order: 10 },
      { id: "second-domain", label: "Second", description: "The second test domain.", order: 20 }
    ]
  });
  await writeJson(path.join(root, "catalog/tags.json"), { schemaVersion: 1, tags: ["one", "two"] });
  await writeJson(path.join(root, "catalog/variants.json"), {
    schemaVersion: 1,
    variants: [{
      id: "exact-variant",
      label: "Exact variant label",
      provider: "test-provider",
      model: "model-1",
      harness: "test-harness",
      reasoningEffort: "high",
      serviceTier: "fast",
      personality: "none",
      capabilities: ["shell", "files"]
    }]
  });

  await writeJson(path.join(root, "catalog/recipes/second-domain/beta/recipe.json"), recipe("beta", {
    domain: "second-domain",
    origin: "mothers",
    tags: ["one", "two"],
    kind: "image",
    harness: { workspace: "write", web: "disabled", capabilities: ["files", "image-generation"] },
    setup: {
      instructions: "Use the supplied notes.",
      fixtures: [{ id: "notes", path: "fixtures/notes.txt", mountAs: "inputs/notes.txt", public: true, mediaType: "text/plain" }]
    },
    output: { kind: "image", entry: "result.png", include: ["result.png"], limits: { maxFiles: 2, maxBytes: 4096 } }
  }));
  await mkdir(path.join(root, "catalog/recipes/second-domain/beta/fixtures"), { recursive: true });
  await writeFile(path.join(root, "catalog/recipes/second-domain/beta/fixtures/notes.txt"), "fixture version one\n");

  await writeJson(path.join(root, "catalog/recipes/first-domain/alpha/recipe.json"), recipe("alpha"));
  await writeJson(path.join(root, "catalog/recipes/first-domain/draft-item/recipe.json"), recipe("draft-item", {
    status: "draft",
    tags: ["two"]
  }));
  return root;
}

test("canonical JSON and hashes are deterministic and reject non-JSON inputs", () => {
  const left = { z: [3, { b: true, a: null }], a: "hello" };
  const right = { a: "hello", z: [3, { a: null, b: true }] };
  assert.equal(canonicalJson(left), '{"a":"hello","z":[3,{"a":null,"b":true}]}');
  assert.equal(hashCanonical(left), hashCanonical(right));
  assert.match(sha256("hello"), /^sha256:[a-f0-9]{64}$/);
  assert.throws(() => canonicalJson({ nope: undefined }), /does not support/);
  const circular = {};
  circular.self = circular;
  assert.throws(() => canonicalJson(circular), /circular/);
});

test("config hashes preserve exact behavior identity while ignoring display labels", () => {
  const variant = {
    id: "first-id",
    label: "First label",
    provider: "provider",
    model: "model",
    harness: "harness",
    reasoningEffort: "high",
    serviceTier: "fast",
    personality: "none",
    capabilities: ["shell", "files"]
  };
  assert.equal(
    computeConfigHash(variant),
    computeConfigHash({ ...variant, id: "display-id-changed", label: "Different label", capabilities: ["files", "shell"] })
  );
  assert.notEqual(computeConfigHash(variant), computeConfigHash({ ...variant, reasoningEffort: "low" }));
  assert.notEqual(computeConfigHash(variant), computeConfigHash({ ...variant, model: "model-2" }));
  assert.notEqual(computeConfigHash(variant), computeConfigHash({ ...variant, executionProfile: { id: "host-unsandboxed" } }));
  const profile = { id: "host-unsandboxed", label: "Public label", sandbox: "danger-full-access" };
  assert.equal(
    computeConfigHash({ ...variant, executionProfile: profile }),
    computeConfigHash({ ...variant, executionProfile: { ...profile, label: "Renamed label" } }),
  );
});

test("loadCatalog hashes fixture bytes, separates execution and display identity, and filters deterministically", async (t) => {
  const root = await makeRepository();
  t.after(() => rm(root, { recursive: true, force: true }));

  const first = await loadCatalog(root);
  assert.match(first.catalogHash, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(first.recipes.map((item) => item.id), ["alpha", "beta", "draft-item"]);
  assert.deepEqual(listRecipes(first).map((item) => item.id), ["alpha", "draft-item", "beta"]);
  assert.deepEqual(listRecipes(first, { domain: "first-domain", status: "ready" }).map((item) => item.id), ["alpha"]);
  assert.deepEqual(listRecipes(first, { tags: ["one", "two"] }).map((item) => item.id), ["beta"]);
  assert.deepEqual(listRecipes(first, { tags: ["one", "two"], matchAnyTag: true }).map((item) => item.id), ["alpha", "draft-item", "beta"]);

  const beta = first.recipes.find((item) => item.id === "beta");
  assert.match(beta.recipeHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(beta.fixtureHashes.notes, /^sha256:[a-f0-9]{64}$/);

  const alphaFile = path.join(root, "catalog/recipes/first-domain/alpha/recipe.json");
  const renamed = recipe("alpha", { title: "A display-only renamed recipe" });
  await writeJson(alphaFile, renamed);
  const displayChanged = await loadCatalog(root);
  assert.equal(
    displayChanged.recipes.find((item) => item.id === "alpha").recipeHash,
    first.recipes.find((item) => item.id === "alpha").recipeHash
  );
  assert.notEqual(displayChanged.catalogHash, first.catalogHash);

  renamed.cuisines = ["second-domain"];
  await writeJson(alphaFile, renamed);
  const cuisineChanged = await loadCatalog(root);
  assert.equal(
    cuisineChanged.recipes.find((item) => item.id === "alpha").recipeHash,
    first.recipes.find((item) => item.id === "alpha").recipeHash
  );

  const fixtureFile = path.join(root, "catalog/recipes/second-domain/beta/fixtures/notes.txt");
  await writeFile(fixtureFile, "fixture version two\n");
  const fixtureChanged = await loadCatalog(root);
  assert.notEqual(
    fixtureChanged.recipes.find((item) => item.id === "beta").recipeHash,
    displayChanged.recipes.find((item) => item.id === "beta").recipeHash
  );
  assert.notEqual(fixtureChanged.catalogHash, displayChanged.catalogHash);
});

test("recipe hashes include required execution inputs but not optional review checks", () => {
  const base = recipe("hash-test");
  const first = computeRecipeHash(base);
  const withOptionalReview = {
    ...base,
    validation: {
      ...base.validation,
      checks: [...base.validation.checks, { id: "look", type: "manual", required: false, description: "Review the tone." }]
    }
  };
  assert.equal(computeRecipeHash(withOptionalReview), first);
  assert.notEqual(computeRecipeHash({ ...base, turns: [{ ...base.turns[0], content: "A changed prompt." }] }), first);
  assert.notEqual(computeRecipeHash({ ...base, presentation: { profile: "static-web-v1", semanticRuntime: null } }), first);
});

test("planSelection returns exact variant identity and explicit capability/status reasons", async (t) => {
  const root = await makeRepository();
  t.after(() => rm(root, { recursive: true, force: true }));
  const catalog = await loadCatalog(root);

  const variant = resolveVariant(catalog, "exact-variant");
  assert.deepEqual(variant, {
    id: "exact-variant",
    label: "Exact variant label",
    provider: "test-provider",
    model: "model-1",
    harness: "test-harness",
    reasoningEffort: "high",
    serviceTier: "fast",
    personality: "none",
    capabilities: ["shell", "files"],
    configHash: computeConfigHash(variant)
  });

  const plan = planSelection(catalog, {
    variantId: "exact-variant",
    flight: ["beta", "alpha", "draft-item"]
  });
  assert.equal(plan.catalogHash, catalog.catalogHash);
  assert.deepEqual(plan.items.map((item) => item.recipeId), ["beta", "alpha", "draft-item"]);
  assert.deepEqual(plan.supported.map((item) => item.recipeId), ["alpha"]);
  assert.deepEqual(plan.unsupported.map((item) => item.recipeId), ["beta", "draft-item"]);
  assert.deepEqual(plan.items[0].missingCapabilities, ["image-generation"]);
  assert.match(plan.items[0].reasons[0], /image-generation/);
  assert.match(plan.items[2].reasons[0], /draft/);
  assert.deepEqual(plan.selection, { type: "recipes", recipeIds: ["beta", "alpha", "draft-item"] });
  assert.throws(() => planSelection(catalog, { variantId: "missing" }), /Unknown configuration/);
  assert.throws(() => planSelection(catalog, { variantId: "exact-variant", flight: ["missing"] }), /Unknown recipe/);
});

test("the lean motion and design-system patch is represented as three ready recipes and one revision", async () => {
  const catalog = await loadCatalog(projectRoot);
  assert.ok(catalog.tags.includes("design-system"));
  const byId = new Map(catalog.recipes.map((item) => [item.id, item]));
  const expected = [
    ["extend-design-system-without-flattening-it", "ui-visual", "hybrid", "web"],
    ["circular-phrase-sequencer", "music-creative-code", "mothers", "web"],
    ["choreograph-motion-as-feedback", "ux-interaction", "hybrid", "web"],
  ];
  for (const [id, cuisine, origin, kind] of expected) {
    const item = byId.get(id);
    assert.ok(item, `missing ${id}`);
    assert.equal(item.status, "ready");
    assert.deepEqual(item.cuisines, [cuisine]);
    assert.equal(item.origin, origin);
    assert.equal(item.kind, kind);
    assert.ok(item.tags.length <= 6);
  }
  assert.deepEqual(byId.get("extend-design-system-without-flattening-it").tags, ["design-system", "visual-language", "implementation", "correction-recovery", "surgical-change"]);
  assert.deepEqual(byId.get("circular-phrase-sequencer").tags, ["audio", "direct-manipulation", "state-modeling", "motion", "visual-language", "accessibility"]);
  const drum = byId.get("notation-led-drum-instrument");
  assert.equal(drum.version, "1.1.0");
  assert.ok(drum.tags.includes("motion"));
  assert.ok(drum.tags.includes("accessibility"));
  assert.match(drum.turns[0].content, /attack, weight, and decay/);
  assert.ok(drum.validation.checks.some((check) => check.id === "sound-motion-review" && check.type === "manual"));
});
