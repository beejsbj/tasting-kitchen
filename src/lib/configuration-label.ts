import type { Configuration } from "../types";

// Kept free of local runtime imports so node's type-stripping test runner can load it.
type Dimensioned = Pick<Configuration, "harness" | "model" | "reasoningEffort" | "serviceTier" | "executionProfile">;

const HARNESSES: Record<string, string> = { "claude-code": "Claude Code", hermes: "Hermes", "codex-cli": "Codex CLI", "cursor-agent": "Cursor Agent" };
const ENVIRONMENTS: Record<string, string> = { clean: "Clean", personal: "Personal" };
const EFFORTS: Record<string, string> = { none: "None", minimal: "Minimal", low: "Low", medium: "Medium", high: "High", xhigh: "XHigh", max: "Max", ultra: "Ultra", adaptive: "Adaptive" };
/** Environment key of a configuration that predates the dimension. */
export const UNDECLARED_ENVIRONMENT = "undeclared";
export const NOT_DECLARED = "Not declared";

export const harnessLabel = (harness: string) => HARNESSES[harness] ?? harness;
export const effortName = (effort: string) => EFFORTS[effort] ?? effort;
/** "Clean", "Personal", "Personal · rose"; undefined when the configuration predates environments. */
export function environmentLabel({ executionProfile: { environment, harnessProfile } }: Pick<Dimensioned, "executionProfile">, withProfile = true) {
  if (!environment) return undefined;
  return `${ENVIRONMENTS[environment] ?? environment}${withProfile && harnessProfile ? ` · ${harnessProfile}` : ""}`;
}
/** `environmentLabel`, or "Not declared" for a configuration that declares none; for places that show the axis beside a choice. */
export const environmentName = (config: Pick<Dimensioned, "executionProfile">, withProfile = true) => environmentLabel(config, withProfile) ?? NOT_DECLARED;
/** Filter and URL token: "clean", "personal", "personal:rose" or "undeclared". */
export function environmentKey({ executionProfile: { environment, harnessProfile } }: Pick<Dimensioned, "executionProfile">) {
  return environment ? `${environment}${harnessProfile ? `:${harnessProfile}` : ""}` : UNDECLARED_ENVIRONMENT;
}
export function environmentKeyLabel(key: string) {
  const [environment, profile] = key.split(":");
  return key === UNDECLARED_ENVIRONMENT ? NOT_DECLARED : `${ENVIRONMENTS[environment] ?? environment}${profile ? ` · ${profile}` : ""}`;
}
/** "Opus 5.5" for Claude-style ids ("claude-opus-5-5", "anthropic/claude-opus-5.5"); undefined for other models. */
export function claudeModelName(model: string) {
  const match = model.match(/(?:^|[-/])(opus|sonnet|haiku|fable)-(\d+)[-.](\d{1,2})(?:$|[-[])/i);
  return match ? `${match[1][0].toUpperCase()}${match[1].slice(1).toLowerCase()} ${match[2]}.${match[3]}` : undefined;
}
const modelKey = (model: string) => claudeModelName(model) ?? model;
/** "Opus 5.5 · High · Claude Code · Clean"; `name` is the model's display name. */
export function configurationHeading(config: Dimensioned, name: string) {
  return [claudeModelName(config.model) ?? name, effortName(config.reasoningEffort), harnessLabel(config.harness), environmentLabel(config)].filter(Boolean).join(" · ");
}
/** The harness and environment values present, in catalog order, for facets that only matter when there is a choice. */
export function configurationFacets(configs: readonly Dimensioned[]) {
  const harnesses = [...new Set(configs.map((config) => config.harness))].map((id) => ({ id, label: harnessLabel(id) }));
  const environments = [...new Set(configs.map(environmentKey))].map((id) => ({ id, label: environmentKeyLabel(id) }));
  return { harnesses, environments };
}

export type ComparisonDimension = "model" | "effort" | "service tier" | "harness" | "environment" | "skill layer" | "other settings" | "undeclared environments";
/** Not a difference but a gap: across harnesses, two configurations without a declared environment are not known to share one. */
export const UNDECLARED_ENVIRONMENTS = "undeclared environments";
export const UNDECLARED_ENVIRONMENTS_NOTE = "environments not declared, so not known to be the same";
/**
 * Which configuration dimensions differ across the compared slots. A model is
 * the same model through any harness's naming of it. A harness profile belongs
 * to its harness, so it only counts as an environment difference between
 * slots that share a harness.
 */
export function differingDimensions(slots: ReadonlyArray<{ config: Dimensioned & Pick<Configuration, "personality" | "capabilities">; skillKey?: string }>): ComparisonDimension[] {
  const sameHarness = new Set(slots.map(({ config }) => config.harness)).size === 1;
  const read: Record<Exclude<ComparisonDimension, typeof UNDECLARED_ENVIRONMENTS>, (slot: (typeof slots)[number]) => unknown> = {
    model: ({ config }) => modelKey(config.model),
    effort: ({ config }) => config.reasoningEffort,
    "service tier": ({ config }) => config.serviceTier,
    harness: ({ config }) => config.harness,
    environment: ({ config }) => sameHarness ? environmentKey(config) : config.executionProfile.environment,
    "skill layer": ({ skillKey }) => skillKey,
    "other settings": ({ config: { executionProfile: { runtime, sandbox, approvalPolicy, nativeWeb, networkPolicy, filesystemBoundary }, personality, capabilities } }) => JSON.stringify([runtime, sandbox, approvalPolicy, nativeWeb, networkPolicy, filesystemBoundary, personality, [...capabilities].sort()]),
  };
  const differing = (Object.keys(read) as Array<keyof typeof read>).filter((dimension) => new Set(slots.map(read[dimension])).size > 1);
  const undeclared = !sameHarness && slots.filter(({ config }) => !config.executionProfile.environment).length > 1;
  return undeclared ? [...differing, UNDECLARED_ENVIRONMENTS] : differing;
}
const ONLY_NOTES: Partial<Record<ComparisonDimension, string>> = {
  harness: "only the harness differs · its own prompt, tools and defaults come with it",
  environment: "only the environment differs · what the environment adds",
};
/** The comparison note once the briefs match and nothing drifted: it names what differs. */
export function differenceNote(all: readonly ComparisonDimension[]) {
  const dimensions = all.filter((dimension) => dimension !== UNDECLARED_ENVIRONMENTS);
  if (dimensions.length < all.length) return `Same brief · ${dimensions.join(", ")} ${dimensions.length === 1 ? "differs" : "differ"} · ${UNDECLARED_ENVIRONMENTS_NOTE}`;
  if (dimensions.length === 1) return `Same brief · ${ONLY_NOTES[dimensions[0]] ?? `only the ${dimensions[0]} differs`}`;
  if (dimensions.length) return `Same brief · ${dimensions.join(", ")} differ`;
  return undefined;
}

