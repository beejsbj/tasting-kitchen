import type { Configuration } from "../types";

// Kept free of local runtime imports so node's type-stripping test runner can load it.
type Dimensioned = Pick<Configuration, "harness" | "model" | "reasoningEffort" | "serviceTier" | "executionProfile"> & Partial<Pick<Configuration, "harnessPath">>;

const HARNESSES: Record<string, string> = { "claude-code": "Claude Code", hermes: "Hermes", "codex-cli": "Codex CLI", "cursor-agent": "Cursor Agent", "direct-api": "Direct API", t3: "T3" };
const ROUTES: Record<string, string> = { openrouter: "OpenRouter", anthropic: "Anthropic" };
/** Model-name words whose casing a capitalized first letter gets wrong. */
const MODEL_WORDS: Record<string, string> = { deepseek: "DeepSeek", glm: "GLM", gpt: "GPT", minimax: "MiniMax" };
const ENVIRONMENTS: Record<string, string> = { clean: "Clean", snapshot: "Snapshot", live: "Live" };
const EFFORTS: Record<string, string> = { none: "None", minimal: "Minimal", low: "Low", medium: "Medium", high: "High", xhigh: "XHigh", max: "Max", ultra: "Ultra", adaptive: "Adaptive" };
/** Environment key of a configuration that predates the dimension. */
export const UNDECLARED_ENVIRONMENT = "undeclared";
export const NOT_DECLARED = "Not declared";

/**
 * How a configuration reaches its model: its harness path, outermost first,
 * and the inference route when the profile declares one other than the
 * provider's own. "claude-code", "t3>claude-code", "direct-api@openrouter".
 * This is the harness axis value and the harness filter token.
 */
export function harnessKey({ harness, harnessPath, executionProfile: { route } }: Pick<Dimensioned, "harness" | "harnessPath" | "executionProfile">) {
  return `${(harnessPath ?? [harness]).join(">")}${route ? `@${route}` : ""}`;
}
/** "Claude Code", "T3 → Claude Code", "Direct API · OpenRouter"; accepts a bare harness id or a `harnessKey`. */
export function harnessLabel(key: string) {
  const [layers, route] = key.split("@");
  return `${layers.split(">").map((layer) => HARNESSES[layer] ?? layer).join(" → ")}${route ? ` · ${ROUTES[route] ?? route}` : ""}`;
}
/** "Gemini 4 Argon" for "google/gemini-4-argon": the maker drops, the slug's words are capitalized. */
export function slugModelName(model: string) {
  const slug = model.match(/^[a-z0-9-]+\/([a-z0-9.-]+)$/i)?.[1];
  if (!slug) return undefined;
  return slug.split("-").map((word) => MODEL_WORDS[word.toLowerCase()] ?? `${word[0].toUpperCase()}${word.slice(1)}`).join(" ");
}
/** "Gemini", "DeepSeek": the family of a maker/slug model, from the slug's leading letters. */
export function slugModelFamily(model: string) {
  const word = model.match(/^[a-z0-9-]+\/([a-z]+)/i)?.[1]?.toLowerCase();
  return word ? MODEL_WORDS[word] ?? `${word[0].toUpperCase()}${word.slice(1)}` : undefined;
}
export const effortName = (effort: string) => EFFORTS[effort] ?? effort;
/** Toggle tokens of a personal environment, in a fixed order: only the ones that depart from memory on, connections off. */
function toggleTokens({ memory, connections }: Dimensioned["executionProfile"]) {
  return [...(memory === "off" ? ["no-memory"] : []), ...(connections === "on" ? ["connections"] : [])];
}
const TOGGLE_LABELS: Record<string, string> = { "no-memory": "no memory", connections: "connections on" };
function composeLabel(environment: string, profile: string | undefined, toggles: readonly string[]) {
  // Live never loads his connections unless the key says so; the label says which, rather than leave it to be assumed.
  const stated = environment === "live" && !toggles.includes("connections") ? [...toggles.map((toggle) => TOGGLE_LABELS[toggle] ?? toggle), "connections off"] : toggles.map((toggle) => TOGGLE_LABELS[toggle] ?? toggle);
  return [ENVIRONMENTS[environment] ?? environment, profile, ...stated].filter(Boolean).join(" · ");
}
/**
 * "Clean", "Live · connections off", "Snapshot · rose", "Snapshot · rose · no memory", "Live · connections on";
 * undefined when the configuration predates environments. `withProfile` false drops the
 * harness profile, which belongs to its harness, but keeps the toggles.
 */
export function environmentLabel({ executionProfile }: Pick<Dimensioned, "executionProfile">, withProfile = true) {
  if (!executionProfile.environment) return undefined;
  return composeLabel(executionProfile.environment, withProfile ? executionProfile.harnessProfile : undefined, toggleTokens(executionProfile));
}
/** `environmentLabel`, or "Not declared" for a configuration that declares none; for places that show the axis beside a choice. */
export const environmentName = (config: Pick<Dimensioned, "executionProfile">, withProfile = true) => environmentLabel(config, withProfile) ?? NOT_DECLARED;
/** Filter and URL token: "clean", "live", "snapshot:rose", "snapshot:rose+no-memory+connections" or "undeclared". */
export function environmentKey({ executionProfile }: Pick<Dimensioned, "executionProfile">, withProfile = true) {
  const { environment, harnessProfile } = executionProfile;
  if (!environment) return UNDECLARED_ENVIRONMENT;
  return [`${environment}${withProfile && harnessProfile ? `:${harnessProfile}` : ""}`, ...toggleTokens(executionProfile)].join("+");
}
/** The environment as it holds across harnesses: its kind and toggles, without a harness's own profile. */
export const environmentKindKey = (config: Pick<Dimensioned, "executionProfile">) => environmentKey(config, false);
export function environmentKeyLabel(key: string) {
  if (key === UNDECLARED_ENVIRONMENT) return NOT_DECLARED;
  const [head, ...toggles] = key.split("+");
  const [environment, profile] = head.split(":");
  return composeLabel(environment, profile, toggles);
}
/** "Opus 5.5" for Claude-style ids ("claude-opus-5-5", "anthropic/claude-opus-5.5"); undefined for other models. */
export function claudeModelName(model: string) {
  const match = model.match(/(?:^|[-/])(opus|sonnet|haiku|fable)-(\d+)[-.](\d{1,2})(?:$|[-[])/i);
  return match ? `${match[1][0].toUpperCase()}${match[1].slice(1).toLowerCase()} ${match[2]}.${match[3]}` : undefined;
}
const modelKey = (model: string) => claudeModelName(model) ?? model;
/** "Opus 5.5 · High · Claude Code · Clean"; `name` is the model's display name. */
export function configurationHeading(config: Dimensioned, name: string) {
  return [claudeModelName(config.model) ?? name, effortName(config.reasoningEffort), harnessLabel(harnessKey(config)), environmentLabel(config)].filter(Boolean).join(" · ");
}
/** The harness and environment values present, in catalog order, for facets that only matter when there is a choice. */
export function configurationFacets(configs: readonly Dimensioned[]) {
  const harnesses = [...new Set(configs.map(harnessKey))].map((id) => ({ id, label: harnessLabel(id) }));
  const environments = [...new Set(configs.map((config) => environmentKey(config)))].map((id) => ({ id, label: environmentKeyLabel(id) }));
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
    harness: ({ config }) => harnessKey(config),
    environment: ({ config }) => sameHarness ? environmentKey(config) : environmentKindKey(config),
    "skill layer": ({ skillKey }) => skillKey,
    "other settings": ({ config: { executionProfile: { runtime, sandbox, approvalPolicy, nativeWeb, networkPolicy, filesystemBoundary }, personality, capabilities } }) => JSON.stringify([runtime, sandbox, approvalPolicy, nativeWeb, networkPolicy, filesystemBoundary, personality, [...capabilities].sort()]),
  };
  const differing = (Object.keys(read) as Array<keyof typeof read>).filter((dimension) => new Set(slots.map(read[dimension])).size > 1);
  const undeclared = !sameHarness && slots.filter(({ config }) => !config.executionProfile.environment).length > 1;
  return undeclared ? [...differing, UNDECLARED_ENVIRONMENTS] : differing;
}
const ONLY_NOTES: Partial<Record<ComparisonDimension, string>> = {
  harness: "only the harness differs · its own prompt, tools, route and defaults come with it",
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

