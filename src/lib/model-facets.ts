import type { Configuration } from "../types";
import { isFreeModel, makerLabel, modelMaker } from "./configuration-label.ts";
import { modelFamily } from "./registry.ts";

export type FamilyOption = { id: string; label: string; group: string; badge?: string; terms: string };

/** Model families with their maker and whether any of their configurations is free, in catalog order. */
export function familyOptions(configurations: readonly Configuration[]): FamilyOption[] {
  const families = new Map<string, FamilyOption>();
  for (const config of configurations) {
    const id = modelFamily(config.model);
    const current = families.get(id) ?? { id, label: id, group: makerLabel(modelMaker(config.model)), terms: "" };
    families.set(id, { ...current, terms: `${current.terms} ${config.model}`, ...(isFreeModel(config) ? { badge: "Free" } : {}) });
  }
  return [...families.values()];
}

