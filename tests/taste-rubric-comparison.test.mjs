import assert from "node:assert/strict";
import test from "node:test";

import { computeAxisSetHash } from "../lib/taste/observations.mjs";
import { compareRubrics } from "../lib/taste/rubric-comparison.mjs";

function rubric(version, question) {
  const value = {
    schemaVersion: 1, id: "care", version, status: version === "1.0.0" ? "active" : "candidate", title: "Care", purpose: "Bounded fixture",
    adapter: { shape: "journal", maxBytes: 4096 }, contexts: [{ kind: "recipe", id: "journal" }],
    axes: [{ id: "groundedness", label: "Groundedness", question, levels: [
      { id: "detached", label: "Detached", description: "Generic" },
      { id: "partial", label: "Partial", description: "Topical" },
      { id: "specific", label: "Specific", description: "Particular" },
    ], consequentialDistance: 2 }],
    ...(version === "1.0.0" ? {} : { revisionNote: "Separates topical warmth from particular contact." }),
  };
  value.rubricHash = computeAxisSetHash(value);
  return value;
}

function observation(rubricValue, dishId, levelId, confidence) {
  const probabilities = levelId === "detached" ? [0.8, 0.15, 0.05] : levelId === "partial" ? [0.1, 0.75, 0.15] : [0.05, 0.15, 0.8];
  return {
    id: `observation_${rubricValue.version.replaceAll(".", "-")}_${dishId}`,
    dishId,
    dishHash: `sha256:${dishId.slice(-1).repeat(64)}`,
    source: { kind: "jev" },
    axisSet: { id: rubricValue.id, version: rubricValue.version, hash: rubricValue.rubricHash },
    axes: [{ axisId: "groundedness", levelId, confidence, distribution: probabilities.map((probability, index) => ({ levelId: rubricValue.axes[0].levels[index].id, probability })) }],
  };
}

function experiment() {
  const baselineAxisSet = rubric("1.0.0", "How grounded is this?");
  const candidateAxisSet = rubric("1.1.0", "Does a particular from the entry materially shape the response?");
  const label = (id, split, level) => ({ id: `label-${id}`, dishId: `dish-${id}`, dishHash: `sha256:${id.repeat(64)}`, split, provenance: { kind: "synthetic-human-fixture", description: "Hand-authored fixture expectation, not an actual tasting." }, axes: { groundedness: level } });
  const humanLabels = [label("a", "development", "specific"), label("b", "development", "detached"), label("c", "held-out", "specific"), label("d", "held-out", "partial")];
  return {
    schemaVersion: 1, id: "groundedness-fixture", baselineAxisSet, candidateAxisSet,
    revision: { axisId: "groundedness", ambiguity: "The old wording lets generic topical warmth count as grounded.", developmentLabelIds: ["label-a", "label-b"] },
    reviewPolicy: { minConfidence: 0.65 }, humanLabels,
    baselineObservations: [observation(baselineAxisSet, "dish-a", "partial", 0.8), observation(baselineAxisSet, "dish-b", "detached", 0.9), observation(baselineAxisSet, "dish-c", "partial", 0.55), observation(baselineAxisSet, "dish-d", "partial", 0.8)],
    candidateObservations: [observation(candidateAxisSet, "dish-a", "specific", 0.75), observation(candidateAxisSet, "dish-b", "detached", 0.9), observation(candidateAxisSet, "dish-c", "specific", 0.7), observation(candidateAxisSet, "dish-d", "detached", 0.8)],
  };
}

test("rubric comparison keeps development and held-out metrics, regressions, and review burden separate", () => {
  const input = experiment();
  const first = compareRubrics(input);
  const second = compareRubrics(input);
  assert.equal(first.reportHash, second.reportHash);
  assert.equal(first.status, "fixture-only-human-evidence-required");
  assert.equal(first.evidence.humanTastings, 0);
  assert.equal(first.splits.development.candidate.agreementRate, 1);
  assert.equal(first.splits["held-out"].baseline.reviewRequired, 1);
  assert.equal(first.splits["held-out"].candidate.agreementRate, 0.5);
  assert.deepEqual(first.splits["held-out"].regressions, [{ labelId: "label-d", dishId: "dish-d", axisId: "groundedness" }]);
  assert.equal(first.promotion.automatic, false);
  assert.equal(first.promotion.decision, "not-promoted");
});

test("held-out judgments cannot be cited as rubric-development evidence", () => {
  const input = experiment();
  input.revision.developmentLabelIds.push("label-c");
  assert.throws(() => compareRubrics(input), /non-development label label-c/);
});

for (const side of ["baselineObservations", "candidateObservations"]) {
  for (const confidence of [undefined, null, "0.8", NaN, Infinity, -Infinity, -0.01, 1.01]) {
    test(`${side} rejects invalid confidence ${String(confidence)} before reporting review burden`, () => {
      const input = experiment();
      input[side][0].axes[0].confidence = confidence;
      if (confidence === undefined) delete input[side][0].axes[0].confidence;
      assert.throws(() => compareRubrics(input), /axis groundedness has invalid confidence/);
    });
  }
}

test("confidence boundaries and the review threshold produce the expected burden", () => {
  const input = experiment();
  input.candidateObservations[0].axes[0].confidence = 0;
  input.candidateObservations[1].axes[0].confidence = 1;
  input.candidateObservations[2].axes[0].confidence = input.reviewPolicy.minConfidence;
  const report = compareRubrics(input);
  assert.equal(report.splits.development.candidate.reviewRequired, 1);
  assert.equal(report.splits.development.candidate.reviewBurden, 0.5);
  assert.equal(report.splits["held-out"].candidate.reviewRequired, 0);
});
