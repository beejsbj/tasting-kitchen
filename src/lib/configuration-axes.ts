import type { Configuration } from "../types";
import { claudeModelName, effortName, environmentKey, environmentKeyLabel, environmentKindKey, harnessLabel, type ComparisonDimension } from "./configuration-label.ts";

/**
 * A configuration seen as independent axes. A pane is the combination of one
 * value per axis; a comparison holds every axis but one and lays out a pane per
 * value of that one. Kept free of registry/runtime imports (beyond the label
 * module) so node's type-stripping test runner can load it.
 */
export type AxisConfiguration = Pick<Configuration, "id" | "model" | "harness" | "reasoningEffort" | "serviceTier" | "executionProfile"> & Partial<Pick<Configuration, "configHash" | "historical">>;

/**
 * Configuration axes in rank order. Changing one axis on a pane may move the
 * axes after it to a configuration that exists, never the axes before it: a
 * new model may arrive through another harness, but a new harness keeps the model.
 */
export const CONFIG_AXES = ["model", "harness", "environment", "effort", "tier"] as const;
export type ConfigAxis = (typeof CONFIG_AXES)[number];
export type CompareAxis = ConfigAxis | "skill";
/** The order "Compare by" offers its axes. */
export const COMPARE_AXES: readonly CompareAxis[] = ["model", "effort", "harness", "environment", "tier", "skill"];
export const AXIS_LABELS: Record<CompareAxis, string> = { model: "Model", effort: "Effort", harness: "Harness", environment: "Environment", tier: "Service tier", skill: "Skill layer" };
/** The comparison-note dimension each axis isolates. */
export const AXIS_DIMENSIONS: Record<CompareAxis, ComparisonDimension> = { model: "model", effort: "effort", harness: "harness", environment: "environment", tier: "service tier", skill: "skill layer" };
/** The most panes a comparison lays out; the URL keeps no more. */
export const MAX_PANES = 6;

const EFFORT_ORDER = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra", "adaptive"];
const TIER_ORDER = ["default", "flex", "fast", "priority"];

export function isCompareAxis(value: string): value is CompareAxis {
  return (COMPARE_AXES as readonly string[]).includes(value);
}

/** "Opus 5.5", "Sol 5.6", "Astra 6", "Composer 2.5"; the raw id when nothing reads plainly. */
export function modelName(model: string) {
  const claude = claudeModelName(model);
  if (claude) return claude;
  const gpt = model.match(/^gpt-(\d+(?:\.\d+)?)-([a-z]+)$/i);
  if (gpt) return `${gpt[2][0].toUpperCase()}${gpt[2].slice(1)} ${gpt[1]}`;
  const composer = model.match(/^composer-?(\d+(?:\.\d+)?)/i);
  if (composer) return `Composer ${composer[1]}`;
  return model;
}

/** The axis value of a configuration. A model is the same model through any harness's naming of it. */
export function axisValue(config: AxisConfiguration, axis: ConfigAxis): string {
  switch (axis) {
    case "model": return claudeModelName(config.model) ?? config.model;
    case "harness": return config.harness;
    case "environment": return environmentKey(config);
    case "effort": return config.reasoningEffort;
    case "tier": return config.serviceTier;
  }
}

export function axisValueLabel(axis: ConfigAxis, value: string) {
  switch (axis) {
    case "model": return modelName(value);
    case "harness": return harnessLabel(value);
    case "environment": return environmentKeyLabel(value);
    case "effort": return effortName(value);
    case "tier": return `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}`;
  }
}

/**
 * Whether two configurations share an axis value. A harness profile belongs to
 * its harness, so across different harnesses the environment kind and its
 * toggles are what holds.
 */
function sameOn(a: AxisConfiguration, b: AxisConfiguration, axis: ConfigAxis) {
  if (axis === "environment" && a.harness !== b.harness) return environmentKindKey(a) === environmentKindKey(b);
  return axisValue(a, axis) === axisValue(b, axis);
}

function orderValues(axis: ConfigAxis, values: string[]) {
  const order = axis === "effort" ? EFFORT_ORDER : axis === "tier" ? TIER_ORDER : undefined;
  if (!order) return values;
  const rank = (value: string) => { const index = order.indexOf(value); return index < 0 ? order.length : index; };
  return [...values].sort((a, b) => rank(a) - rank(b));
}

/** Values of an axis that have a Dish for this recipe, plus `include`, in a stable order. */
export function cookedValues<C extends AxisConfiguration>(configs: readonly C[], axis: ConfigAxis, dishCount: (config: C) => number, include: readonly string[] = []) {
  const values = new Set<string>();
  for (const config of configs) if (dishCount(config) > 0 || include.includes(axisValue(config, axis))) values.add(axisValue(config, axis));
  return orderValues(axis, [...values]);
}

/** Lexicographic distance over the given axes: earlier axes weigh more. */
function distance(a: AxisConfiguration, b: AxisConfiguration, axes: readonly ConfigAxis[]) {
  return axes.map((axis) => Number(!sameOn(a, b, axis)));
}
function compareVectors(a: number[], b: number[]) {
  for (let index = 0; index < a.length; index++) if (a[index] !== b[index]) return a[index] - b[index];
  return 0;
}

/** The closest configuration among `candidates`: fewest changed axes in rank order, then cooked, then current, then catalog order. */
function closest<C extends AxisConfiguration>(candidates: readonly C[], anchor: AxisConfiguration, axes: readonly ConfigAxis[], dishCount: (config: C) => number) {
  return [...candidates].map((config, index) => ({ config, index })).sort((a, b) =>
    compareVectors(distance(a.config, anchor, axes), distance(b.config, anchor, axes))
    || Number(dishCount(b.config) > 0) - Number(dishCount(a.config) > 0)
    || Number(Boolean(a.config.historical)) - Number(Boolean(b.config.historical))
    || a.index - b.index)[0]?.config;
}

export type AxisOption<C extends AxisConfiguration> = {
  value: string;
  label: string;
  /** The configuration choosing this value leads to; absent when the combination does not exist. */
  config?: C;
  dishes: number;
  status: "cooked" | "uncooked" | "impossible";
  /** Lower-ranked axes that move to reach a configuration that exists, with their new value labels. */
  changes: Array<{ axis: ConfigAxis; label: string }>;
  reason?: string;
  selected: boolean;
};

/**
 * The values one pane's selector offers for `axis`: every value with a Dish for
 * this recipe, plus the pane's own. Higher-ranked axes stay put; lower ones may
 * move, and the option says how. A value no configuration combines with the
 * higher axes is impossible, with the reason.
 */
export function axisOptions<C extends AxisConfiguration>(configs: readonly C[], current: C, axis: ConfigAxis, dishCount: (config: C) => number): AxisOption<C>[] {
  const rank = CONFIG_AXES.indexOf(axis);
  const higher = CONFIG_AXES.slice(0, rank);
  const lower = CONFIG_AXES.slice(rank + 1);
  const currentValue = axisValue(current, axis);
  const options = cookedValues(configs, axis, dishCount, [currentValue]).map((value): AxisOption<C> => {
    const label = axisValueLabel(axis, value);
    const selected = value === currentValue;
    const candidates = selected ? [current] : configs.filter((config) => axisValue(config, axis) === value && higher.every((held) => sameOn(config, current, held)));
    // Hold every lower axis when that combination exists, cooked or not; once
    // something has to move anyway, land on a Dish when one exists.
    const exact = candidates.filter((config) => lower.every((other) => sameOn(config, current, other)));
    const config = exact.length ? closest(exact, current, lower, dishCount) : closest(candidates.filter((config) => dishCount(config) > 0), current, lower, dishCount) ?? closest(candidates, current, lower, dishCount);
    if (!config) {
      const held = higher.map((held) => axisValueLabel(held, axisValue(current, held)));
      return { value, label, dishes: 0, status: "impossible", changes: [], selected, reason: `No configuration for ${[...held, label].join(" · ")}` };
    }
    const dishes = dishCount(config);
    const changes = lower.filter((other) => !sameOn(config, current, other)).map((other) => ({ axis: other, label: axisValueLabel(other, axisValue(config, other)) }));
    return { value, label, config, dishes, status: dishes > 0 ? "cooked" : "uncooked", changes, selected };
  });
  // Values reachable without moving anything else lead; impossible ones keep their reason but sink last.
  const order = (option: AxisOption<C>) => option.status === "impossible" ? 2 : option.changes.length ? 1 : 0;
  return options.map((option, index) => ({ option, index })).sort((a, b) => order(a.option) - order(b.option) || a.index - b.index).map(({ option }) => option);
}

/**
 * Configurations identical to `current` on every axis: a preserved snapshot
 * beside the current one, or two entries differing only in other settings.
 * A pane offers them only when there is more than one.
 */
export function snapshotOptions<C extends AxisConfiguration>(configs: readonly C[], current: C) {
  return configs.filter((config) => CONFIG_AXES.every((axis) => axisValue(config, axis) === axisValue(current, axis)));
}

export type ComparisonValue<C extends AxisConfiguration> = {
  value: string;
  label: string;
  config: C;
  dishes: number;
  /** True when every other axis matches the held pane; false when the nearest Dish also moves another axis. */
  isolated: boolean;
  /** Other axes that differ from the held pane (empty when isolated). */
  differs: Array<{ axis: ConfigAxis; label: string }>;
  held: boolean;
};

/**
 * The values a "Compare by" axis can lay out from the held pane. Each value
 * takes the configuration matching the held pane on every other axis; when
 * that combination does not exist, the closest cooked configuration is offered
 * instead, marked as not isolated. Values with neither are left out.
 * `dishCount` counts within the held skill layer; `listedCount` (any layer by
 * default the same) decides which values the recipe has cooked at all.
 */
export function comparisonValues<C extends AxisConfiguration>(configs: readonly C[], anchor: C, axis: ConfigAxis, dishCount: (config: C) => number, listedCount: (config: C) => number = dishCount): ComparisonValue<C>[] {
  const others = CONFIG_AXES.filter((item) => item !== axis);
  const anchorValue = axisValue(anchor, axis);
  const values = cookedValues(configs, axis, listedCount, [anchorValue]).flatMap((value): ComparisonValue<C>[] => {
    const label = axisValueLabel(axis, value);
    if (value === anchorValue) return [{ value, label, config: anchor, dishes: dishCount(anchor), isolated: true, differs: [], held: true }];
    const matching = configs.filter((config) => axisValue(config, axis) === value);
    const exact = closest(matching.filter((config) => others.every((other) => sameOn(config, anchor, other))), anchor, [], dishCount);
    if (exact) return [{ value, label, config: exact, dishes: dishCount(exact), isolated: true, differs: [], held: false }];
    const near = closest(matching.filter((config) => dishCount(config) > 0), anchor, others, dishCount);
    if (!near) return [];
    const differs = others.filter((other) => !sameOn(near, anchor, other)).map((other) => ({ axis: other, label: axisValueLabel(other, axisValue(near, other)) }));
    return [{ value, label, config: near, dishes: dishCount(near), isolated: false, differs, held: false }];
  });
  // The held value leads, then values that hold everything else, then the rest.
  const rank = (item: ComparisonValue<C>) => item.held ? 0 : item.isolated ? 1 : 2;
  return values.map((item, index) => ({ item, index })).sort((a, b) => rank(a.item) - rank(b.item) || a.index - b.index).map(({ item }) => item);
}

/**
 * The values a fresh comparison opens with: the held value first, then each
 * isolated value that has a Dish, up to the pane limit.
 */
export function defaultComparisonSelection(values: ReadonlyArray<Pick<ComparisonValue<AxisConfiguration>, "value" | "dishes" | "isolated" | "held">>, max = MAX_PANES) {
  const held = values.filter((item) => item.held).map((item) => item.value);
  const rest = values.filter((item) => !item.held && item.isolated && item.dishes > 0).map((item) => item.value);
  return [...held, ...rest].slice(0, max);
}

/**
 * Keeps a comparison's chosen values when the held pane changes: those that
 * still hold everything else stay, in offer order, with the held value first.
 * A value that would now move another axis is dropped rather than silently
 * breaking the isolation. When none survive, the comparison reopens with its defaults.
 */
export function carryComparisonSelection(previous: readonly string[], values: ReadonlyArray<Pick<ComparisonValue<AxisConfiguration>, "value" | "dishes" | "isolated" | "held">>, max = MAX_PANES) {
  const held = values.find((item) => item.held)?.value;
  const kept = values.filter((item) => !item.held && item.isolated && previous.includes(item.value)).map((item) => item.value);
  if (!kept.length) return defaultComparisonSelection(values, max);
  return [...(held ? [held] : []), ...kept].slice(0, max);
}

/** Toggles one value in a comparison; the held value stays, and the limit holds. */
export function toggleComparisonValue(selection: readonly string[], value: string, held: string, order: readonly string[], max = MAX_PANES) {
  if (value === held) return [...selection];
  const next = selection.includes(value) ? selection.filter((item) => item !== value) : selection.length >= max ? [...selection] : [...selection, value];
  return [held, ...order.filter((item) => item !== held && next.includes(item))];
}

/**
 * The label a "Compare by" layout shows for an axis it holds still. Across
 * harnesses only the environment kind and its toggles hold; a harness profile
 * such as rose stays with its harness, so a rose pane compared by harness holds
 * "Snapshot", not "Snapshot · rose".
 */
export function heldValueLabel(compareAxis: CompareAxis, axis: ConfigAxis, config: AxisConfiguration) {
  if (axis === "environment" && compareAxis === "harness") return environmentKeyLabel(environmentKindKey(config));
  return axisValueLabel(axis, axisValue(config, axis));
}

const ISOLATION: Partial<Record<ComparisonDimension, string>> = {
  harness: "its own prompt, tools and defaults come with it",
  environment: "what the environment adds",
  "skill layer": "the model still decides how to use it",
};
/**
 * The comparison note for a "Compare by" layout. It states what was held by
 * construction and names any axis that moved anyway; it never credits the
 * varied axis alone with the difference.
 */
export function compareByNote(axis: CompareAxis, held: readonly string[], differing: readonly ComparisonDimension[]) {
  const dimension = AXIS_DIMENSIONS[axis];
  const holding = held.length ? `Holding ${held.join(" · ")}` : "Same brief";
  const extra = differing.filter((item) => item !== dimension);
  if (!differing.includes(dimension)) return `${holding} · only one ${AXIS_LABELS[axis].toLowerCase()} on the counter${extra.length ? `, yet ${extra.join(", ")} differ${extra.length === 1 ? "s" : ""}` : ""}`;
  if (extra.length) return `${holding} · ${dimension} varies, and so does ${extra.join(", ")} · not an isolated comparison`;
  return `${holding} · only the ${dimension} differs${ISOLATION[dimension] ? ` · ${ISOLATION[dimension]}` : ""}`;
}
