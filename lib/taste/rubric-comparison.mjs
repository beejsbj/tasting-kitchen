import { readFile } from "node:fs/promises";
import path from "node:path";

import { hashCanonical } from "./catalog.mjs";
import { writeJsonAtomic } from "./files.mjs";

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function metric(value, total) {
  return total ? Number((value / total).toFixed(4)) : null;
}

function levelIndex(axisSet, axisId, levelId) {
  const axis = axisSet.axes.find((candidate) => candidate.id === axisId);
  requireValue(axis, `Unknown axis ${axisId}`);
  const index = axis.levels.findIndex((level) => level.id === levelId);
  requireValue(index >= 0, `Unknown level ${axisId}:${levelId}`);
  return { axis, index };
}

function observationKey(observation) {
  return `${observation.dishId}:${observation.dishHash}`;
}

function indexObservations(observations, rubric, label) {
  const index = new Map();
  for (const observation of observations) {
    requireValue(observation.source?.kind === "jev", `${label} must contain Jev observations`);
    requireValue(observation.axisSet?.id === rubric.id && observation.axisSet?.version === rubric.version && observation.axisSet?.hash === rubric.rubricHash, `${label} observation ${observation.id} does not use the declared rubric`);
    const key = observationKey(observation);
    requireValue(!index.has(key), `${label} has duplicate observation for ${key}`);
    index.set(key, observation);
  }
  return index;
}

function evaluateVersion(labels, observations, axisSet, policy) {
  const perAxis = Object.fromEntries(axisSet.axes.map((axis) => [axis.id, { labeled: 0, agreements: 0, unresolved: 0, reviewRequired: 0, consequentialErrors: 0 }]));
  const disagreements = [];
  const consequentialErrors = [];
  let labeled = 0;
  let agreements = 0;
  let unresolved = 0;
  let reviewRequired = 0;
  for (const label of labels) {
    const observation = observations.get(`${label.dishId}:${label.dishHash}`);
    for (const [axisId, expected] of Object.entries(label.axes)) {
      labeled += 1;
      perAxis[axisId].labeled += 1;
      const result = observation?.axes.find((axis) => axis.axisId === axisId);
      if (!result) {
        unresolved += 1;
        reviewRequired += 1;
        perAxis[axisId].unresolved += 1;
        perAxis[axisId].reviewRequired += 1;
        disagreements.push({ labelId: label.id, dishId: label.dishId, axisId, expected, observed: null, reason: "missing-observation" });
        continue;
      }
      const matches = result.levelId === expected;
      if (matches) {
        agreements += 1;
        perAxis[axisId].agreements += 1;
      } else {
        disagreements.push({ labelId: label.id, dishId: label.dishId, axisId, expected, observed: result.levelId, reason: "level-disagreement" });
      }
      const needsReview = result.confidence < policy.minConfidence;
      if (needsReview) {
        reviewRequired += 1;
        perAxis[axisId].reviewRequired += 1;
      }
      const expectedIndex = levelIndex(axisSet, axisId, expected).index;
      const { axis, index: observedIndex } = levelIndex(axisSet, axisId, result.levelId);
      const distance = Math.abs(expectedIndex - observedIndex);
      if (distance >= axis.consequentialDistance) {
        const error = { labelId: label.id, dishId: label.dishId, axisId, expected, observed: result.levelId, distance };
        consequentialErrors.push(error);
        perAxis[axisId].consequentialErrors += 1;
      }
    }
  }
  for (const value of Object.values(perAxis)) {
    value.agreementRate = metric(value.agreements, value.labeled);
    value.reviewBurden = metric(value.reviewRequired, value.labeled);
  }
  return {
    labeled,
    agreements,
    agreementRate: metric(agreements, labeled),
    unresolved,
    reviewRequired,
    reviewBurden: metric(reviewRequired, labeled),
    consequentialErrors,
    disagreements,
    perAxis,
  };
}

function changedOutcomes(labels, baseline, candidate) {
  const baselineDisagreements = new Set(baseline.disagreements.map((item) => `${item.labelId}:${item.axisId}`));
  const candidateDisagreements = new Set(candidate.disagreements.map((item) => `${item.labelId}:${item.axisId}`));
  const cells = labels.flatMap((label) => Object.keys(label.axes).map((axisId) => ({ labelId: label.id, dishId: label.dishId, axisId })));
  return {
    improvements: cells.filter((cell) => baselineDisagreements.has(`${cell.labelId}:${cell.axisId}`) && !candidateDisagreements.has(`${cell.labelId}:${cell.axisId}`)),
    regressions: cells.filter((cell) => !baselineDisagreements.has(`${cell.labelId}:${cell.axisId}`) && candidateDisagreements.has(`${cell.labelId}:${cell.axisId}`)),
  };
}

function validateLabels(experiment, baselineAxisSet, candidateAxisSet) {
  requireValue(Array.isArray(experiment.humanLabels) && experiment.humanLabels.length > 0, "Experiment requires humanLabels");
  const ids = new Set();
  const baselineAxes = baselineAxisSet.axes.map((axis) => axis.id).join("\0");
  requireValue(candidateAxisSet.axes.map((axis) => axis.id).join("\0") === baselineAxes, "Rubric comparison requires stable axis identities; revise meanings and levels under a new rubric, not the comparison keys");
  for (const label of experiment.humanLabels) {
    requireValue(typeof label.id === "string" && !ids.has(label.id), `Duplicate or missing label id: ${label.id}`);
    ids.add(label.id);
    requireValue(["development", "held-out"].includes(label.split), `Label ${label.id} has invalid split`);
    requireValue(label.provenance?.kind === "human-tasting" || label.provenance?.kind === "synthetic-human-fixture", `Label ${label.id} has invalid provenance`);
    requireValue(typeof label.provenance.description === "string" && label.provenance.description.length > 0, `Label ${label.id} is missing provenance detail`);
    requireValue(label.axes && Object.keys(label.axes).join("\0") === baselineAxes, `Label ${label.id} must cover every axis in rubric order`);
    for (const [axisId, levelId] of Object.entries(label.axes)) {
      levelIndex(baselineAxisSet, axisId, levelId);
      levelIndex(candidateAxisSet, axisId, levelId);
    }
  }
  requireValue(experiment.humanLabels.some((label) => label.split === "development"), "Experiment requires development labels");
  requireValue(experiment.humanLabels.some((label) => label.split === "held-out"), "Experiment requires held-out labels");
  const developmentIds = new Set(experiment.humanLabels.filter((label) => label.split === "development").map((label) => label.id));
  const heldOutIds = new Set(experiment.humanLabels.filter((label) => label.split === "held-out").map((label) => label.id));
  requireValue(Array.isArray(experiment.revision.developmentLabelIds) && experiment.revision.developmentLabelIds.length > 0, "Rubric revision must cite development labels");
  for (const id of experiment.revision.developmentLabelIds) {
    requireValue(developmentIds.has(id), `Rubric revision cites non-development label ${id}`);
    requireValue(!heldOutIds.has(id), `Held-out label leaked into rubric revision: ${id}`);
  }
}

export function compareRubrics(experiment) {
  requireValue(experiment?.schemaVersion === 1, "Rubric experiment schemaVersion must be 1");
  const { baselineAxisSet, candidateAxisSet } = experiment;
  requireValue(baselineAxisSet?.id === candidateAxisSet?.id, "Baseline and candidate must refine the same axis-set identity");
  requireValue(baselineAxisSet.rubricHash !== candidateAxisSet.rubricHash && baselineAxisSet.version !== candidateAxisSet.version, "Candidate rubric requires a new version and identity hash");
  requireValue(typeof experiment.revision?.axisId === "string" && typeof experiment.revision?.ambiguity === "string" && experiment.revision.ambiguity.length > 0, "Rubric revision must name the axis ambiguity it addresses");
  requireValue(candidateAxisSet.axes.some((axis) => axis.id === experiment.revision.axisId), "Rubric revision names an unknown axis");
  requireValue(typeof experiment.reviewPolicy?.minConfidence === "number" && experiment.reviewPolicy.minConfidence >= 0 && experiment.reviewPolicy.minConfidence <= 1, "reviewPolicy.minConfidence is invalid");
  validateLabels(experiment, baselineAxisSet, candidateAxisSet);
  const baselineIndex = indexObservations(experiment.baselineObservations, baselineAxisSet, "baselineObservations");
  const candidateIndex = indexObservations(experiment.candidateObservations, candidateAxisSet, "candidateObservations");
  const provenance = {};
  for (const label of experiment.humanLabels) (provenance[label.provenance.kind] ??= []).push(label);
  const report = {
    schemaVersion: 1,
    experimentId: experiment.id,
    status: provenance["synthetic-human-fixture"]?.length ? "fixture-only-human-evidence-required" : "human-evidence-present-review-required",
    axisSetId: baselineAxisSet.id,
    baseline: { version: baselineAxisSet.version, hash: baselineAxisSet.rubricHash },
    candidate: { version: candidateAxisSet.version, hash: candidateAxisSet.rubricHash },
    revision: experiment.revision,
    evidence: {
      humanTastings: provenance["human-tasting"]?.length ?? 0,
      syntheticHumanFixtures: provenance["synthetic-human-fixture"]?.length ?? 0,
      development: experiment.humanLabels.filter((label) => label.split === "development").length,
      heldOut: experiment.humanLabels.filter((label) => label.split === "held-out").length,
    },
    reviewPolicy: experiment.reviewPolicy,
    splits: {},
    promotion: { automatic: false, decision: "not-promoted", reason: "Rubric changes require human review; fixture labels cannot establish Burooj's taste." },
  };
  for (const split of ["development", "held-out"]) {
    const labels = experiment.humanLabels.filter((label) => label.split === split);
    const baseline = evaluateVersion(labels, baselineIndex, baselineAxisSet, experiment.reviewPolicy);
    const candidate = evaluateVersion(labels, candidateIndex, candidateAxisSet, experiment.reviewPolicy);
    report.splits[split] = { baseline, candidate, ...changedOutcomes(labels, baseline, candidate) };
  }
  return { ...report, reportHash: hashCanonical(report) };
}

export async function compareRubricsFromFile(experimentFile, { output } = {}) {
  const absolute = path.resolve(experimentFile);
  const experiment = JSON.parse(await readFile(absolute, "utf8"));
  const report = compareRubrics(experiment);
  if (output) await writeJsonAtomic(path.resolve(output), report);
  return report;
}
