import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildRegistry } from "../lib/taste/registry.mjs";

async function json(filename, value) {
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, `${JSON.stringify(value)}\n`);
}

test("builds the gallery registry without private runtime data", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "taste-registry-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await json(path.join(root, "catalog/domains.json"), { schemaVersion: 1, domains: [{ id: "talk", label: "Talk", description: "Conversation tests.", order: 10 }] });
  await json(path.join(root, "catalog/tags.json"), { schemaVersion: 1, tags: ["presence"] });
  await json(path.join(root, "catalog/variants.json"), { schemaVersion: 1, variants: [{ id: "v", label: "V", provider: "openai", model: "m", harness: "codex-cli", reasoningEffort: "high", serviceTier: "default", personality: "none", capabilities: [] }] });
  const recipe = {
    schemaVersion: 1, id: "talk-once", version: "1.0.0", status: "ready", title: "Talk once clearly", summary: "Respond clearly to one conversational prompt.", domain: "talk", origin: "textbook", originNote: "A conventional conversation test.", tags: ["presence"], kind: "session",
    harness: { workspace: "read", web: "disabled", capabilities: [] }, setup: { instructions: "Respond.", fixtures: [] }, turns: [{ id: "ask", role: "prompt", content: "Hello." }],
    output: { kind: "session", entry: "output/session.json", include: ["output/session.json"], limits: { maxFiles: 2, maxBytes: 4096 } },
    validation: { mode: "completeness", checks: [{ id: "entry", type: "file-exists", required: true, description: "Transcript exists.", target: "output/session.json" }] },
  };
  await json(path.join(root, "catalog/recipes/talk/talk-once/recipe.json"), recipe);
  const dishId = "dish_talk-once_v_one";
  await mkdir(path.join(root, "dishes", dishId, "artifact/output"), { recursive: true });
  await json(path.join(root, "dishes", dishId, "artifact/output/session.json"), { turns: [] });
  await json(path.join(root, "dishes", dishId, "validation.json"), { passed: true });
  await json(path.join(root, "dishes", dishId, "trace.json"), { turns: [] });
  await json(path.join(root, "dishes", dishId, "dish.json"), {
    schemaVersion: 1, id: dishId, recipe: { id: "talk-once", version: "1.0.0", hash: `sha256:${"1".repeat(64)}` }, executedAt: "2026-08-14T12:00:00.000Z",
    identity: { variantId: "v", provider: "openai", requestedModel: "m", observedModel: "m", harness: "codex-cli", harnessVersion: "fake", reasoningEffort: "high", serviceTier: "default", configHash: `sha256:${"2".repeat(64)}` }, status: "accepted",
    artifact: { kind: "session", entry: "artifact/output/session.json", files: [{ path: "artifact/output/session.json", sha256: "0".repeat(64), bytes: 13 }], treeHash: `sha256:${"3".repeat(64)}` }, validation: { passed: true, report: "validation.json" }, publicTrace: "trace.json", dishHash: `sha256:${"4".repeat(64)}`,
  });
  const reviewId = "review_talk-once_v_mobile";
  const reviewFile = path.join(root, "reviews", `${reviewId}.json`);
  const review = {
    schemaVersion: 1,
    id: reviewId,
    dishId,
    dishHash: `sha256:${"4".repeat(64)}`,
    reviewer: "Test reviewer",
    reviewerKind: "agent",
    reviewedAt: "2026-08-14T12:30:00.000Z",
    probes: [{
      id: "mobile",
      device: "Mobile browser emulation",
      viewport: { width: 390, height: 844, deviceScaleFactor: 1 },
      verdict: "issue",
      finding: "An agent observer found clipped content at this viewport.",
      details: { method: "Browser visual inspection", path: "artifact/output/session.json" },
    }],
  };
  await json(reviewFile, review);
  await mkdir(path.join(root, "private/runtime"), { recursive: true });
  await writeFile(path.join(root, "private/runtime/secret.txt"), "never publish");

  const { output, registry } = await buildRegistry({ repoRoot: root, now: new Date("2026-08-14T12:00:00.000Z") });
  assert.equal(registry.basePath, "/model-tasting/");
  assert.match(registry.variants[0].configHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(registry.recipes[0].recipeDir, "catalog/recipes/talk/talk-once");
  assert.equal(registry.dishes[0].artifactBase, `/model-tasting/dishes/${dishId}/`);
  assert.deepEqual(registry.reviews, [review]);
  const artifactUrl = `${registry.dishes[0].artifactBase}${registry.dishes[0].artifact.entry}`;
  assert.equal(artifactUrl, `/model-tasting/dishes/${dishId}/artifact/output/session.json`);
  assert.deepEqual(
    JSON.parse(await readFile(path.join(root, "public", artifactUrl.replace("/model-tasting/", "")), "utf8")),
    { turns: [] },
  );
  assert.equal(JSON.stringify(registry).includes("private/runtime"), false);
  assert.deepEqual(JSON.parse(await readFile(output, "utf8")), registry);

  await json(reviewFile, { ...review, dishHash: `sha256:${"5".repeat(64)}` });
  await assert.rejects(() => buildRegistry({ repoRoot: root }), /does not match immutable dish hash/);
});
