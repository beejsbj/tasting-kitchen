import assert from "node:assert/strict";
import test from "node:test";
import { observationContextGroups, observationsInScope } from "../src/lib/observation-panel.ts";
import { observationDisagreements } from "../src/lib/registry.ts";

function observation(id, kind, levelId, hash = "current", context = {}) {
  return {
    id, axisSet: { hash }, source: { kind },
    context: { kind: "recipe", id: "journal", revisionHash: "revision-1", ...context },
    axes: [{ axisId: "care", levelId }],
  };
}

const disagreements = (shown) => observationContextGroups(shown).flatMap(observationDisagreements);

test("selected rubric notice excludes historical rubrics and cross-context pairs", () => {
  const selected = [
    observation("human", "human", "specific"),
    observation("jev", "jev", "specific"),
    observation("menu", "jev", "detached", "current", { kind: "menu" }),
    observation("other-id", "jev", "detached", "current", { id: "other" }),
    observation("old-revision", "jev", "detached", "current", { revisionHash: "revision-0" }),
  ];
  const historical = [observation("old-human", "human", "specific", "old"), observation("old-jev", "jev", "detached", "old")];
  const all = [...selected, ...historical];
  assert.equal(disagreements(all.filter((item) => item.axisSet.hash === "current")).length, 0);
  assert.equal(disagreements(historical).length, 1);
  assert.equal(disagreements([...selected, observation("conflict", "jev", "detached")]).length, 1);
});

test("floating latest scope excludes other rubrics and context kinds, ids and revisions", () => {
  const latest = observation("latest", "human", "specific");
  const peer = observation("peer", "jev", "specific");
  const all = [latest, peer,
    observation("old", "jev", "detached", "old"),
    observation("menu", "jev", "detached", "current", { kind: "menu" }),
    observation("other", "jev", "detached", "current", { id: "other" }),
    observation("revision", "jev", "detached", "current", { revisionHash: "revision-0" }),
  ];
  const scope = observationsInScope(all, latest);
  assert.deepEqual(scope.map((item) => item.id), ["latest", "peer"]);
  assert.equal(observationDisagreements(scope).length, 0);
  assert.equal(observationDisagreements(observationsInScope([...all, observation("conflict", "jev", "detached")], latest)).length, 1);
});
