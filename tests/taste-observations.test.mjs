import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  adaptObservationEvidence,
  axisSetsForContext,
  computeAxisSetHash,
  evaluateDishWithJev,
  loadAxisSets,
  loadObservations,
  questionsForAxisSet,
} from "../lib/taste/observations.mjs";

function axisSet(overrides = {}) {
  const value = {
    schemaVersion: 1,
    id: "conversation-care",
    version: "1.0.0",
    status: "active",
    title: "Conversation care",
    purpose: "Inspect a bounded response without changing its Dish.",
    adapter: { shape: "conversation", maxBytes: 4096 },
    contexts: [{ kind: "recipe", id: "talk-once" }],
    axes: [{
      id: "attention",
      label: "Attention",
      question: "How directly does the response meet the supplied message?",
      levels: [
        { id: "detached", label: "Detached", description: "Could answer an unrelated message." },
        { id: "partial", label: "Partial", description: "Names the topic without using its particulars." },
        { id: "specific", label: "Specific", description: "Uses particulars to shape the response." },
      ],
      consequentialDistance: 2,
    }],
    ...overrides,
  };
  value.rubricHash = computeAxisSetHash(value);
  return value;
}

function dish(shape = "session") {
  return {
    schemaVersion: 1,
    id: "dish_talk-once_fixture",
    recipe: { id: "talk-once", version: "1.0.0", hash: `sha256:${"1".repeat(64)}` },
    executedAt: "2026-09-20T10:00:00.000Z",
    finalizedAt: "2026-09-20T10:01:00.000Z",
    identity: {},
    status: "accepted",
    artifact: {
      kind: shape,
      entry: "artifact/output/session.json",
      treeHash: `sha256:${"2".repeat(64)}`,
      files: [{ path: "artifact/output/session.json", sha256: "3".repeat(64), bytes: 2 }],
    },
    validation: { passed: true, report: "validation.json" },
    publicTrace: "trace.json",
    dishHash: `sha256:${"4".repeat(64)}`,
  };
}

test("axis sets are versioned, explicitly selectable, and compile independent Jev questions", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "taste-axis-sets-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "catalog/axis-sets"), { recursive: true });
  const first = axisSet();
  const second = axisSet({ version: "1.1.0", status: "candidate", revisionNote: "Clarifies what particular evidence means." });
  second.rubricHash = computeAxisSetHash(second);
  await Promise.all([
    writeFile(path.join(root, "catalog/axis-sets/conversation-care--1.0.0.json"), JSON.stringify(first)),
    writeFile(path.join(root, "catalog/axis-sets/conversation-care--1.1.0.json"), JSON.stringify(second)),
  ]);
  const loaded = await loadAxisSets(root);
  assert.deepEqual(loaded.map(({ id, version, status }) => ({ id, version, status })), [
    { id: "conversation-care", version: "1.0.0", status: "active" },
    { id: "conversation-care", version: "1.1.0", status: "candidate" },
  ]);
  assert.equal(axisSetsForContext(loaded, { kind: "recipe", id: "talk-once" }).length, 2);
  assert.deepEqual(questionsForAxisSet(first).attention, {
    type: "score",
    instructions: first.axes[0].question,
    criteria: first.axes[0].levels.map((level) => level.description),
  });
});

test("public evidence adapters exercise conversation, journaling, and agentic shapes", () => {
  const manifest = dish();
  const artifact = { turns: [{ id: "one", role: "prompt", prompt: "I keep circling back.", response: "What stays unfinished?", actions: [] }] };
  const trace = { turns: [{ id: "one", response: "Used the supplied record.", actions: [{ type: "read" }] }] };
  const conversation = adaptObservationEvidence({ shape: "conversation", dish: manifest, artifact, trace });
  const journal = adaptObservationEvidence({ shape: "journal", dish: manifest, artifact, trace });
  const agentic = adaptObservationEvidence({ shape: "agentic", dish: manifest, artifact, trace });
  assert.equal(conversation.state.shape, "conversation");
  assert.equal(journal.state.turns[0].prompt, "I keep circling back.");
  assert.deepEqual(agentic.state.turns, trace.turns);
  assert.deepEqual(agentic.evidence.map((item) => item.path), ["artifact/output/session.json", "trace.json"]);
});

test("repeated Jev evaluations append observations without changing Dish identity", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "taste-observations-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const manifest = dish();
  const rubric = axisSet();
  await mkdir(path.join(root, "catalog/axis-sets"), { recursive: true });
  await mkdir(path.join(root, "dishes", manifest.id, "artifact/output"), { recursive: true });
  const artifact = { turns: [{ id: "one", prompt: "A bounded prompt", response: "A particular response", actions: [] }] };
  await Promise.all([
    writeFile(path.join(root, "catalog/axis-sets/conversation-care--1.0.0.json"), JSON.stringify(rubric)),
    writeFile(path.join(root, "dishes", manifest.id, "dish.json"), JSON.stringify(manifest)),
    writeFile(path.join(root, "dishes", manifest.id, "artifact/output/session.json"), JSON.stringify(artifact)),
    writeFile(path.join(root, "dishes", manifest.id, "trace.json"), JSON.stringify(artifact)),
    writeFile(path.join(root, "dishes", manifest.id, "validation.json"), JSON.stringify({ passed: true })),
  ]);
  const originalDish = await readFile(path.join(root, "dishes", manifest.id, "dish.json"), "utf8");
  const run = async () => ({
    ok: true,
    data: {
      model: "typesafe/jev-fixture",
      answers: { attention: { type: "score", score: 1.7, confidence: 0.7, probabilities: { 0: 0.05, 1: 0.2, 2: 0.75 } } },
      usage: { input_tokens: 100, output_tokens: 10 },
    },
  });
  const options = {
    dishId: manifest.id,
    axisSetId: rubric.id,
    axisSetVersion: rubric.version,
    context: { kind: "recipe", id: "talk-once", revisionHash: manifest.recipe.hash },
    evaluatorProvider: "fixture-provider",
    execute: true,
    run,
    toolVersion: "0.8.0-fixture",
  };
  const first = await evaluateDishWithJev(root, { ...options, now: new Date("2026-09-20T11:00:00.000Z") });
  const second = await evaluateDishWithJev(root, { ...options, now: new Date("2026-09-20T11:05:00.000Z") });
  assert.notEqual(first.observation.id, second.observation.id);
  assert.equal(first.observation.dishHash, manifest.dishHash);
  assert.equal(first.observation.axisSet.hash, rubric.rubricHash);
  assert.equal(first.observation.axes[0].distribution.length, 3);
  assert.equal(await readFile(path.join(root, "dishes", manifest.id, "dish.json"), "utf8"), originalDish);
  const loaded = await loadObservations(root, { dishes: [manifest], axisSets: [rubric] });
  assert.equal(loaded.length, 2);
});

test("oversized evidence is rejected rather than invisibly split", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "taste-observation-size-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const manifest = dish();
  const rubric = axisSet({ adapter: { shape: "conversation", maxBytes: 1024 } });
  rubric.rubricHash = computeAxisSetHash(rubric);
  await mkdir(path.join(root, "catalog/axis-sets"), { recursive: true });
  await mkdir(path.join(root, "dishes", manifest.id, "artifact/output"), { recursive: true });
  await Promise.all([
    writeFile(path.join(root, "catalog/axis-sets/conversation-care--1.0.0.json"), JSON.stringify(rubric)),
    writeFile(path.join(root, "dishes", manifest.id, "dish.json"), JSON.stringify(manifest)),
    writeFile(path.join(root, "dishes", manifest.id, "artifact/output/session.json"), JSON.stringify({ turns: [{ prompt: "x".repeat(1100), response: "y" }] })),
    writeFile(path.join(root, "dishes", manifest.id, "trace.json"), "{}"),
    writeFile(path.join(root, "dishes", manifest.id, "validation.json"), "{}"),
  ]);
  await assert.rejects(evaluateDishWithJev(root, {
    dishId: manifest.id,
    axisSetId: rubric.id,
    axisSetVersion: rubric.version,
    context: { kind: "recipe", id: "talk-once", revisionHash: manifest.recipe.hash },
  }), /exceeds axis-set maxBytes/);
});
