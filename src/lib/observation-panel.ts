import type { TasteObservation } from "../types";

function contextKey(observation: TasteObservation) {
  const { kind, id, revisionHash } = observation.context;
  return JSON.stringify([observation.axisSet.hash, kind, id, revisionHash]);
}

export function observationsInScope(observations: TasteObservation[], anchor: TasteObservation) {
  return observations.filter((observation) => contextKey(observation) === contextKey(anchor));
}

// A rubric can be used in several contexts; compare only within each context.
export function observationContextGroups(observations: TasteObservation[]) {
  const groups = new Map<string, TasteObservation[]>();
  for (const observation of observations) {
    const key = contextKey(observation);
    const group = groups.get(key) ?? [];
    group.push(observation);
    groups.set(key, group);
  }
  return [...groups.values()];
}
