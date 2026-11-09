import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { computeCatalogHash, computeConfigHash } from "./catalog.mjs";
import { declaredExecutionProfile, resolveHarnessAdapter } from "./harness-adapters.mjs";
import { HERMES_EFFORTS, HERMES_MODELS } from "./hermes.mjs";
import { HERMES_KEY_ROUTES, HERMES_ROUTE_PROFILE_ID, hermesRouteRefusal, routeModelMaker } from "./hermes-routes.mjs";
import { discoverModels, openRouterModelProviders } from "./model-discovery.mjs";
import { OPENROUTER_ROUTE, OPENROUTER_UPSTREAMS, isMakerUpstream, openRouterMaker } from "./openrouter.mjs";
import { withRecipeFilesLock } from "./recipe-files-lock.mjs";

/**
 * Configuration templates: how a model Hermes can reach becomes a configuration
 * without anyone writing it by hand.
 *
 * A template fixes everything but the model and its effort: harness, route,
 * environment, execution profile, and the policy that says which efforts a
 * model takes. A spec names one model on a template:
 *
 *   hermes:openrouter/google/gemma-4-31b-it:free@high[:clean]
 *
 * and a selector names many, by a `*` pattern and `+filters`:
 *
 *   hermes:openrouter/*@auto+free
 *
 * OpenRouter and Anthropic have templates of their own. Every other key route
 * Kitchen can proxy (hermes-routes.mjs, such as opencode-go) shares the route
 * template, whose route is the spec's:
 *
 *   hermes:opencode-go/glm-5.3@high
 *
 * Resolving a spec builds the exact configuration a hand-written entry would
 * be, hashed the same way. If the catalog already holds that hash, the spec is
 * that entry; otherwise the configuration is materialized into
 * catalog/configurations.json when it is first cooked, marked `materialized`,
 * so the catalog stays the one place configurations live and Dishes, Repeats
 * and receipts stay as exact as ever.
 */

export const CONFIGURATION_TEMPLATES = [
  {
    id: "hermes-openrouter-clean", harness: "hermes", route: OPENROUTER_ROUTE, environment: "clean", executionProfileId: "hermes-linux-host-clean-openrouter-v1",
    routeLabel: "OpenRouter", effortPolicy: "the model's published OpenRouter efforts; auto takes high, else the model's default, else its highest",
  },
  {
    id: "hermes-anthropic-clean", harness: "hermes", route: "anthropic", environment: "clean", executionProfileId: "hermes-linux-host-clean-anthropic-v1",
    routeLabel: "Anthropic", effortPolicy: `any Hermes effort (${HERMES_EFFORTS.join(", ")}); auto takes high`,
  },
  {
    // `route: null`: the spec names it. templateFor binds it to one key route.
    id: "hermes-route-clean", harness: "hermes", route: null, environment: "clean", executionProfileId: HERMES_ROUTE_PROFILE_ID,
    routeLabel: null, effortPolicy: "any Hermes effort for a model that reasons (Hermes maps it to what the route takes), none for one that does not; auto takes high, else the highest",
  },
];

/** The route template, which takes its route from the spec. */
const ROUTE_TEMPLATE_ID = "hermes-route-clean";

export const SELECTOR_FILTERS = {
  free: "zero-priced on the route (OpenRouter's :free offerings and free previews)",
};

const SPEC = /^(?<harness>[a-z0-9-]+):(?<route>[a-z0-9-]+)\/(?<model>[^@\s]+)@(?<effort>[a-z]+)(?::(?<environment>[a-z]+))?(?<filters>(?:\+[a-z-]+)*)$/u;
const EFFORT_LABELS = { none: "None", minimal: "Minimal", low: "Low", medium: "Medium", high: "High", xhigh: "XHigh", max: "Max", ultra: "Ultra" };
const LOOKUP_CONCURRENCY = 8;

/** Whether a `--config` value is a spec or selector rather than a configuration id (ids hold neither `:` nor `@`). */
export function isConfigurationSpec(value) {
  return typeof value === "string" && value.includes(":") && value.includes("@");
}

export function parseConfigurationSpec(text) {
  const match = SPEC.exec(text ?? "");
  if (!match) throw new Error(`Configuration spec must read harness:route/model@effort[:environment][+filter], such as hermes:openrouter/google/gemma-4-31b-it:free@high (got ${text})`);
  const { harness, route, model, effort, environment = "clean", filters } = match.groups;
  const filterList = filters ? filters.split("+").filter(Boolean) : [];
  for (const filter of filterList) if (!Object.hasOwn(SELECTOR_FILTERS, filter)) throw new Error(`Unknown selector filter +${filter}; known: ${Object.keys(SELECTOR_FILTERS).map((name) => `+${name}`).join(", ")}`);
  const selector = model.includes("*") || filterList.length > 0;
  return { text, harness, route, model, effort, environment, filters: filterList, selector };
}

export function templateFor({ harness, route, environment }) {
  const own = CONFIGURATION_TEMPLATES.find((candidate) => candidate.harness === harness && candidate.route === route && candidate.environment === environment);
  if (own) return own;
  const shared = CONFIGURATION_TEMPLATES.find((candidate) => candidate.id === ROUTE_TEMPLATE_ID);
  if (harness === shared.harness && environment === shared.environment && !CONFIGURATION_TEMPLATES.some((candidate) => candidate.route === route)) {
    const refusal = hermesRouteRefusal(route);
    if (refusal) throw new Error(`No configuration template for ${harness} on the ${route} route: ${refusal}`);
    return { ...shared, route, routeLabel: HERMES_KEY_ROUTES[route].label };
  }
  const named = CONFIGURATION_TEMPLATES.map((item) => `${item.harness}:${item.route ?? "<key route>"}:${item.environment}`).join(", ");
  throw new Error(`No configuration template for ${harness} on the ${route} route in the ${environment} environment; templates: ${named}`);
}

function globPattern(model) {
  return new RegExp(`^${model.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/gu, "\\$&")).join(".*")}$`, "u");
}

function slugPart(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "");
}

/** The effort a model is cooked at: the one asked for, if the model takes it; `auto` follows the template's policy. */
export function chooseEffort(model, requested) {
  const efforts = model.efforts ?? [];
  if (requested === "auto") {
    if (efforts.includes("high")) return { effort: "high" };
    if (model.defaultEffort && efforts.includes(model.defaultEffort)) return { effort: model.defaultEffort };
    const highest = efforts.at(-1);
    return highest ? { effort: highest } : { reason: "publishes no effort it accepts" };
  }
  if (!efforts.includes(requested)) return { reason: `does not take effort ${requested} (it takes ${efforts.join(", ") || "none listed"})` };
  return { effort: requested };
}

/**
 * The OpenRouter provider a model is pinned to. The maker's own provider when
 * it serves the model; otherwise the only provider that does (most free models
 * have exactly one); otherwise only the one Burooj names. The reason is
 * recorded beside the configuration, so the choice is never silent.
 */
export function chooseUpstream(modelId, providers, named = null) {
  const maker = openRouterMaker(modelId);
  if (!providers.length) return { reason: "OpenRouter lists no provider serving it" };
  if (named) {
    const provider = providers.find((item) => item.slug === named);
    if (!provider) return { reason: `provider ${named} does not serve it (${providers.map((item) => item.slug).join(", ")} do)` };
    return { upstream: provider.slug, choice: { name: provider.name, reason: isMakerUpstream(provider.slug, maker) ? "maker" : "named" } };
  }
  const own = providers.filter((item) => isMakerUpstream(item.slug, maker));
  if (own.length === 1) return { upstream: own[0].slug, choice: { name: OPENROUTER_UPSTREAMS[own[0].slug] ?? own[0].name, reason: "maker" } };
  if (providers.length === 1) return { upstream: providers[0].slug, choice: { name: providers[0].name, reason: "sole-provider" } };
  return { reason: `${providers.length} providers serve it and none is ${maker}'s own; name one with --upstream (${providers.map((item) => item.slug).join(", ")})` };
}

function anthropicModelName(model) {
  const match = /^claude-([a-z]+)-(\d+)-(\d+)$/u.exec(model);
  return match ? `${match[1][0].toUpperCase()}${match[1].slice(1)} ${match[2]}.${match[3]}` : model;
}

/** Only an endpoint that can run the Cook is a pin: one that takes tools and, for a free model, charges nothing. */
export function servingProviders(model, providers) {
  return providers.filter((provider) => provider.tools && (!model.free || provider.free));
}

/** The configuration a template makes of one model: the same shape, and so the same hash, as a hand-written entry. */
export function buildTemplateConfiguration(template, { model, name, effort, upstream, upstreamChoice, materialized }) {
  const openRouter = template.route === OPENROUTER_ROUTE;
  const keyRoute = template.id === ROUTE_TEMPLATE_ID;
  const executionProfile = { ...declaredExecutionProfile(template.harness, template.executionProfileId), ...(openRouter ? { upstream } : {}), ...(keyRoute ? { route: template.route } : {}) };
  // A materialized OpenRouter id names its upstream pin (#55): a model that moves to another provider is a second
  // configuration beside the first, not a clash. A hand-written entry is found by hash and keeps the id it has.
  let id;
  if (openRouter) id = `${template.harness}-openrouter-${slugPart(model)}-${materialized && upstream ? `${slugPart(upstream)}-` : ""}${effort}-${template.environment}`;
  else if (keyRoute) id = `${template.harness}-${template.route}-${slugPart(model)}-${effort}-${template.environment}`;
  else id = `${template.harness}-${slugPart(model.replace(/^claude-/u, ""))}-${effort}-${template.environment}`;
  return {
    id,
    label: `${name} · ${EFFORT_LABELS[effort] ?? effort} · via Hermes · ${template.environment} (${template.routeLabel})`,
    provider: openRouter ? openRouterMaker(model) : keyRoute ? routeModelMaker(template.route, model) : "anthropic",
    model,
    harness: template.harness,
    reasoningEffort: effort,
    serviceTier: "default",
    personality: "none",
    capabilities: ["files", "shell"],
    executionProfile,
    ...(upstreamChoice ? { upstreamChoice } : {}),
    ...(materialized ? { materialized } : {}),
  };
}

async function mapLimited(items, limit, operation) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await operation(items[index]);
    }
  }));
  return results;
}

/** The catalog's configurations by hash, so a spec that names an existing entry resolves to it. */
function catalogByHash(catalog) {
  return new Map((catalog.configurations ?? []).map((configuration) => [computeConfigHash(configuration), configuration]));
}

/**
 * Resolve a spec or selector against discovery and the catalog. Reads only: the
 * result says which configurations exist already and which would be
 * materialized, and which models a selector matched but cannot cook, and why.
 */
export async function resolveConfigurationSpec(catalog, text, { env = {}, fetchImpl = globalThis.fetch, upstream = null, now = () => new Date() } = {}) {
  const spec = parseConfigurationSpec(text);
  const template = templateFor(spec);
  if (upstream && template.route !== OPENROUTER_ROUTE) throw new Error(`--upstream applies only to the OpenRouter route, not ${template.route}`);
  if (upstream && spec.selector) throw new Error("--upstream names one provider, so it applies to one model, not a selector");
  if (spec.effort !== "auto" && !HERMES_EFFORTS.includes(spec.effort)) throw new Error(`Effort ${spec.effort} is not a Hermes effort (${HERMES_EFFORTS.join(", ")}) or auto`);
  const at = now().toISOString();
  const pattern = globPattern(spec.model);
  const unsupported = [];
  let candidates;
  let source;
  if (template.route === OPENROUTER_ROUTE) {
    const discovery = await discoverModels({ harness: spec.harness, route: OPENROUTER_ROUTE, env, fetchImpl });
    const route = discovery.routes[0];
    source = route.source;
    const listed = route.models.filter((model) => pattern.test(model.id) && (!spec.filters.includes("free") || model.free));
    if (!spec.selector && !listed.length) throw new Error(`OpenRouter does not list ${spec.model}; see taste models --route openrouter`);
    candidates = [];
    for (const model of listed) {
      if (!model.cookable) { unsupported.push({ model: model.id, reason: model.reasons.join("; ") }); continue; }
      const effort = chooseEffort(model, spec.effort);
      if (effort.reason) { unsupported.push({ model: model.id, reason: effort.reason }); continue; }
      candidates.push({ model, effort: effort.effort });
    }
    // Which provider serves a model is per model, so it is looked up per model.
    await mapLimited(candidates, LOOKUP_CONCURRENCY, async (candidate) => {
      try { candidate.pin = chooseUpstream(candidate.model.id, servingProviders(candidate.model, await openRouterModelProviders(candidate.model.id, { env, fetchImpl })), upstream); }
      catch (error) { candidate.pin = { reason: `its providers could not be read: ${error.message}` }; }
    });
    for (const candidate of candidates.filter((item) => item.pin.reason)) unsupported.push({ model: candidate.model.id, reason: candidate.pin.reason });
    candidates = candidates.filter((item) => !item.pin.reason);
  } else if (template.id === ROUTE_TEMPLATE_ID) {
    const discovery = await discoverModels({ harness: spec.harness, route: template.route, env, fetchImpl });
    const route = discovery.routes[0];
    source = route.source;
    const listed = route.models.filter((model) => pattern.test(model.id) && (!spec.filters.includes("free") || model.free));
    if (!spec.selector && !listed.length) throw new Error(`Hermes lists no ${spec.model} on the ${template.route} route; see taste models --route ${template.route}`);
    candidates = [];
    for (const model of listed) {
      if (!model.cookable) { unsupported.push({ model: model.id, reason: (model.reasons ?? ["not cookable"]).join("; ") }); continue; }
      const effort = chooseEffort(model, spec.effort);
      if (effort.reason) { unsupported.push({ model: model.id, reason: effort.reason }); continue; }
      candidates.push({ model, effort: effort.effort, pin: {} });
    }
  } else {
    source = "kitchen:HERMES_MODELS";
    const listed = HERMES_MODELS.filter((model) => pattern.test(model));
    if (spec.filters.includes("free")) listed.length = 0;
    if (!spec.selector && !listed.length) throw new Error(`The ${template.route} template pins only ${HERMES_MODELS.join(", ")}`);
    candidates = listed.map((id) => ({ model: { id, name: anthropicModelName(id), efforts: HERMES_EFFORTS, free: false }, effort: spec.effort === "auto" ? "high" : spec.effort, pin: {} }));
  }
  if (!spec.selector && unsupported.length) throw new Error(`Cannot cook ${spec.model} on ${template.id}: ${unsupported[0].reason}`);

  const existing = catalogByHash(catalog);
  const ids = new Set((catalog.configurations ?? []).map((configuration) => configuration.id));
  const entries = [];
  for (const { model, effort, pin } of candidates.sort((a, b) => (a.model.id < b.model.id ? -1 : a.model.id > b.model.id ? 1 : 0))) {
    const concrete = `${spec.harness}:${spec.route}/${model.id}@${effort}:${spec.environment}`;
    const configuration = buildTemplateConfiguration(template, {
      model: model.id, name: model.name, effort, upstream: pin.upstream, upstreamChoice: pin.choice,
      materialized: {
        template: template.id, spec: concrete, ...(spec.selector ? { selector: spec.text } : {}), at,
        ...(model.free ? { free: true } : {}), ...(model.contextLength ? { contextLength: model.contextLength } : {}), source,
      },
    });
    resolveHarnessAdapter(configuration);
    const configHash = computeConfigHash(configuration);
    const known = existing.get(configHash);
    if (known) { entries.push({ status: "catalog", configuration: known, configHash, spec: concrete }); continue; }
    if (ids.has(configuration.id)) {
      const reason = `configuration id ${configuration.id} already names a different configuration (another upstream pin, or a slug that reads the same); edit one of them first`;
      if (!spec.selector) throw new Error(`Cannot materialize ${concrete}: ${reason}`);
      unsupported.push({ model: model.id, reason });
      continue;
    }
    ids.add(configuration.id);
    entries.push({ status: "materialize", configuration, configHash, spec: concrete });
  }
  return {
    spec: spec.text, selector: spec.selector, template: { id: template.id, harness: template.harness, route: template.route, environment: template.environment, executionProfile: template.executionProfileId, effortPolicy: template.effortPolicy },
    source, resolvedAt: at, matched: entries.length + unsupported.length, entries, unsupported: unsupported.sort((a, b) => (a.model < b.model ? -1 : a.model > b.model ? 1 : 0)),
  };
}

/** A new entry with no cell to cook is not written, so the plan says so instead of promising it: `cooking` are the configurations that have cells. */
export function markNothingToCook(resolution, cooking) {
  const cooks = new Set(cooking.map((configuration) => configuration.id));
  for (const entry of resolution.entries) if (entry.status === "materialize" && !cooks.has(entry.configuration.id)) entry.status = "nothing-to-cook";
}

/** The catalog as it reads once these configurations are added, hash recomputed: what a dry run plans against. */
export function catalogWithConfigurations(catalog, configurations) {
  if (!configurations.length) return catalog;
  const next = { ...catalog, configurations: [...catalog.configurations, ...configurations] };
  return { ...next, catalogHash: computeCatalogHash(next) };
}

/**
 * Append materialized configurations to catalog/configurations.json, under the
 * catalog file lock, and atomically. An entry whose hash appeared meanwhile is
 * not written twice. Returns the configurations that were written.
 */
export async function materializeConfigurations(repoRoot, configurations) {
  if (!configurations.length) return [];
  return withRecipeFilesLock(repoRoot, async () => {
    const file = path.join(repoRoot, "catalog", "configurations.json");
    const document = JSON.parse(await readFile(file, "utf8"));
    const hashes = new Set(document.configurations.map(computeConfigHash));
    const ids = new Set(document.configurations.map((configuration) => configuration.id));
    const written = [];
    for (const configuration of configurations) {
      resolveHarnessAdapter(configuration);
      if (hashes.has(computeConfigHash(configuration))) continue;
      if (ids.has(configuration.id)) throw new Error(`Configuration id ${configuration.id} already names a different configuration`);
      document.configurations.push(configuration);
      hashes.add(computeConfigHash(configuration));
      ids.add(configuration.id);
      written.push(configuration);
    }
    if (written.length) {
      const staging = `${file}.${process.pid}.materializing`;
      await writeFile(staging, `${JSON.stringify(document, null, 2)}\n`, "utf8");
      await rename(staging, file);
    }
    return written;
  });
}

const MATERIALIZED_KEYS = new Set(["template", "spec", "selector", "at", "free", "contextLength", "source"]);

/**
 * What is wrong with a configuration's `materialized` record, if anything. The
 * record is provenance, not identity (it is not hashed), but it must still say
 * truthfully which template and spec made the entry.
 */
export function materializedProblems(configuration) {
  const record = configuration?.materialized;
  if (record === undefined) return [];
  if (!record || typeof record !== "object" || Array.isArray(record)) return ["materialized must be an object"];
  const problems = Object.keys(record).filter((key) => !MATERIALIZED_KEYS.has(key)).map((key) => `materialized has unknown key ${key}`);
  const template = CONFIGURATION_TEMPLATES.find((candidate) => candidate.id === record.template);
  if (!template) return [...problems, `materialized.template must be one of ${CONFIGURATION_TEMPLATES.map((item) => item.id).join(", ")}`];
  if (configuration.harness !== template.harness || configuration.executionProfile?.id !== template.executionProfileId) problems.push(`materialized.template ${template.id} does not make ${configuration.harness} on ${configuration.executionProfile?.id}`);
  // The route template's route is the configuration's own.
  const route = template.route ?? configuration.executionProfile?.route;
  let spec = null;
  try { spec = parseConfigurationSpec(record.spec); }
  catch (error) { problems.push(`materialized.spec: ${error.message}`); }
  if (spec && (spec.selector || spec.model !== configuration.model || spec.effort !== configuration.reasoningEffort || spec.route !== route || spec.environment !== template.environment)) {
    problems.push(`materialized.spec ${record.spec} does not name this configuration's model, effort and template`);
  }
  if (record.selector !== undefined) {
    try { if (!parseConfigurationSpec(record.selector).selector) problems.push("materialized.selector must be a selector"); }
    catch (error) { problems.push(`materialized.selector: ${error.message}`); }
  }
  if (typeof record.at !== "string" || Number.isNaN(Date.parse(record.at))) problems.push("materialized.at must be an ISO timestamp");
  if (record.free !== undefined && record.free !== true) problems.push("materialized.free is either true or absent");
  if (record.contextLength !== undefined && !(Number.isInteger(record.contextLength) && record.contextLength > 0)) problems.push("materialized.contextLength must be a positive integer");
  if (typeof record.source !== "string" || record.source === "") problems.push("materialized.source must name where the model was listed");
  return problems;
}

/** A short public summary of a resolution, for plan and cook output. */
export function resolutionSummary(resolution) {
  return {
    spec: resolution.spec, selector: resolution.selector, template: resolution.template, source: resolution.source, resolvedAt: resolution.resolvedAt,
    matched: resolution.matched,
    configurations: resolution.entries.map(({ status, configuration, configHash, spec }) => ({
      id: configuration.id, spec, status, model: configuration.model, reasoningEffort: configuration.reasoningEffort, configHash,
      ...(configuration.executionProfile.upstream ? { upstream: configuration.executionProfile.upstream } : {}),
      ...(configuration.upstreamChoice ? { upstreamChoice: configuration.upstreamChoice } : {}),
      ...(configuration.materialized?.free ? { free: true } : {}),
    })),
    unsupported: resolution.unsupported,
  };
}
