import { readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { HERMES_EFFORTS, HERMES_MODELS, hermesRoot } from "./hermes.mjs";
import { OPENROUTER_EFFORTS, OPENROUTER_ROUTE, isFreeSlug, openRouterMaker } from "./openrouter.mjs";

/**
 * Model discovery: which inference routes Hermes is set up for, and which
 * models each one offers.
 *
 * Everything here reads. Hermes's own state is read from files under its home
 * (never by running `hermes`, which writes locks and logs there), and only an
 * allowlist of fields leaves auth.json: provider names, credential sources such
 * as `env:OPENROUTER_API_KEY`, and statuses. Tokens, keys, labels and
 * fingerprints are never read into the result. Model listings come from the
 * caches Hermes keeps, and for OpenRouter from its free public metadata API,
 * which needs no key. Nothing here makes an inference call.
 */

export const OPENROUTER_METADATA_URL = "https://openrouter.ai/api/v1";
const METADATA_TIMEOUT_MS = 15_000;

/** The metadata API base: a test or mirror may point it elsewhere. */
export function openRouterMetadataUrl(env = {}) {
  return (env.TASTE_OPENROUTER_METADATA_URL ?? process.env.TASTE_OPENROUTER_METADATA_URL ?? OPENROUTER_METADATA_URL).replace(/\/+$/u, "");
}

/**
 * Routes Kitchen can cook through Hermes, by Hermes provider id: the template
 * that turns one of the route's models into a configuration. Every other route
 * is listed for what it offers, with the reason it is not cookable yet.
 */
export const COOKABLE_HERMES_ROUTES = {
  [OPENROUTER_ROUTE]: { template: "hermes-openrouter-clean" },
  anthropic: { template: "hermes-anthropic-clean", note: "Kitchen borrows the Claude Code login for this route, not Hermes's own" },
};

const ROUTE_LABELS = {
  openrouter: "OpenRouter", nous: "Nous Portal", anthropic: "Anthropic", "openai-codex": "OpenAI Codex", copilot: "GitHub Copilot",
  gemini: "Google Gemini", "opencode-go": "OpenCode Go", "opencode-zen": "OpenCode Zen", "opencode-free": "OpenCode Free", "ollama-cloud": "Ollama Cloud",
  "kimi-coding": "Kimi", "openai-api": "OpenAI API", xai: "xAI", deepseek: "DeepSeek", zai: "Z.AI", minimax: "MiniMax",
};

/** Credential variables Hermes reads per route: only their presence in this shell is reported. */
const ROUTE_KEY_ENV = {
  openrouter: ["OPENROUTER_API_KEY"], nous: ["NOUS_API_KEY"], anthropic: ["ANTHROPIC_API_KEY"], gemini: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
  "opencode-go": ["OPENCODE_GO_API_KEY"], "opencode-zen": ["OPENCODE_ZEN_API_KEY"], "ollama-cloud": ["OLLAMA_API_KEY"], "kimi-coding": ["KIMI_API_KEY", "KIMI_CODING_API_KEY"],
  copilot: ["COPILOT_GITHUB_TOKEN", "GH_TOKEN"], xai: ["XAI_API_KEY"], deepseek: ["DEEPSEEK_API_KEY"], zai: ["ZAI_API_KEY", "GLM_API_KEY"], minimax: ["MINIMAX_API_KEY"],
};

/** Hermes routes whose models.dev section has another name. */
const MODELS_DEV_IDS = { gemini: "google", copilot: "github-copilot", "openai-codex": "openai", "kimi-coding": "moonshotai" };

/** Routes Hermes has retired: a stale cache must not read as an offer. */
const RETIRED_ROUTES = {
  "opencode-free": "Hermes removed keyless OpenCode Free: its relay refuses clients other than OpenCode's own",
};

async function readJsonFile(file) {
  try { return JSON.parse(await readFile(file, "utf8")); }
  catch (error) {
    if (error?.code === "ENOENT") return null;
    throw new Error(`Cannot read ${path.basename(file)}: ${error.message}`, { cause: error });
  }
}

async function modifiedAt(file) {
  const info = await stat(file).catch(() => null);
  return info ? info.mtime.toISOString() : null;
}

/** A credential source names where a key comes from (`env:NAME`, `manual`, `device_code`), never the key. */
function safeSource(source) {
  if (typeof source !== "string") return null;
  return /^(?:env:[A-Z][A-Z0-9_]*|[a-z_:-]{1,32})$/u.test(source) ? source : "other";
}

/**
 * One route's credential state from auth.json, through an allowlist. A pool
 * entry with no recorded failure counts as usable; Hermes marks the rest
 * exhausted (rate or credit) or failed (auth).
 */
function credentialState(entries = [], providerState = null) {
  const credentials = entries.map((entry) => ({
    authType: typeof entry?.auth_type === "string" ? entry.auth_type : null,
    source: safeSource(entry?.source),
    status: entry?.failure_reason === "auth" ? "auth-failed" : entry?.last_status === "exhausted" ? "exhausted" : "ok",
    ...(Number.isInteger(entry?.last_error_code) ? { errorCode: entry.last_error_code } : {}),
  }));
  const error = providerState?.last_auth_error;
  const loggedOut = error?.relogin_required === true && !credentials.some((credential) => credential.status === "ok");
  let status;
  if (loggedOut) status = "logged-out";
  else if (credentials.some((credential) => credential.status === "ok")) status = "authenticated";
  else if (credentials.some((credential) => credential.status === "exhausted")) status = "exhausted";
  else if (credentials.length) status = "auth-failed";
  else status = "no-credential";
  return {
    status, credentials,
    ...(loggedOut ? { authError: [error.code, error.message].filter((part) => typeof part === "string" && part.length <= 80).join(": ") || "relogin required" } : {}),
  };
}

function fixFor(route, status) {
  if (status === "logged-out") return `hermes auth add ${route}`;
  if (status === "exhausted") return `wait for the limit to reset, or hermes auth reset ${route}`;
  if (status === "auth-failed") return `hermes auth status ${route}, then replace the credential`;
  // Hermes's secrets helper may still supply a key when Hermes itself runs; Kitchen never runs it.
  if (status === "no-credential") return `hermes auth add ${route} (unless Hermes's secrets helper supplies the key)`;
  if (status === "no-claude-login") return "log in to Claude Code";
  return null;
}

function claudeCredentialsFile(env) {
  return path.join(env.CLAUDE_CONFIG_DIR ?? process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude"), ".credentials.json");
}

/** Read what Hermes knows about its routes. Read-only; returns no secret. */
export async function readHermesRouteState({ env = {} } = {}) {
  const root = hermesRoot(env);
  const [auth, providerModels, ollama, modelsDev, nousRecommended] = await Promise.all([
    readJsonFile(path.join(root, "auth.json")),
    readJsonFile(path.join(root, "provider_models_cache.json")),
    readJsonFile(path.join(root, "ollama_cloud_models_cache.json")),
    readJsonFile(path.join(root, "models_dev_cache.json")),
    readJsonFile(path.join(root, "cache", "nous_recommended_cache.json")),
  ]);
  const routes = new Set([
    ...Object.keys(auth?.credential_pool ?? {}), ...Object.keys(auth?.providers ?? {}), ...Object.keys(providerModels ?? {}),
    ...(ollama ? ["ollama-cloud"] : []),
  ]);
  const state = [];
  for (const route of [...routes].sort()) {
    const credentials = credentialState(auth?.credential_pool?.[route] ?? [], auth?.providers?.[route] ?? null);
    const cache = providerModels?.[route];
    let models = Array.isArray(cache?.models) ? cache.models.filter((id) => typeof id === "string") : [];
    let modelSource = models.length ? "hermes:provider_models_cache.json" : null;
    let cachedAt = typeof cache?.at === "number" ? new Date(cache.at * 1000).toISOString() : null;
    if (route === "ollama-cloud" && Array.isArray(ollama?.models)) {
      models = ollama.models.filter((id) => typeof id === "string");
      modelSource = "hermes:ollama_cloud_models_cache.json";
      cachedAt = typeof ollama.cached_at === "number" ? new Date(ollama.cached_at * 1000).toISOString() : null;
    }
    if (route === "nous" && !models.length) {
      const portal = Object.values(nousRecommended ?? {})[0]?.data ?? {};
      models = [...new Set(Object.values(portal).flatMap((list) => (Array.isArray(list) ? list : [])).map((item) => item?.modelName).filter((id) => typeof id === "string"))];
      if (models.length) { modelSource = "hermes:cache/nous_recommended_cache.json"; cachedAt = await modifiedAt(path.join(root, "cache", "nous_recommended_cache.json")); }
    }
    const keyEnv = ROUTE_KEY_ENV[route] ?? [];
    const keyInShell = keyEnv.filter((name) => typeof (env[name] ?? process.env[name]) === "string" && (env[name] ?? process.env[name]).trim() !== "");
    let { status } = credentials;
    if (RETIRED_ROUTES[route]) status = "retired";
    else if (Object.hasOwn(auth?.suppressed_sources ?? {}, route) && status === "no-credential") status = "suppressed";
    // Kitchen reaches Anthropic through Hermes with the Claude Code login it borrows, whatever Hermes's own pool holds.
    else if (route === "anthropic") status = (await stat(claudeCredentialsFile(env)).catch(() => null))?.isFile() ? "borrowed-claude-code-login" : "no-claude-login";
    else if (status === "no-credential" && keyInShell.length) status = "env-key";
    state.push({
      route, label: ROUTE_LABELS[route] ?? route, status,
      ...(RETIRED_ROUTES[route] ? { note: RETIRED_ROUTES[route] } : {}),
      ...(credentials.authError ? { authError: credentials.authError } : {}),
      credentials: credentials.credentials,
      keyInShell,
      ...(fixFor(route, status) ? { fix: fixFor(route, status) } : {}),
      cachedModels: models, modelSource, cachedAt,
    });
  }
  return { root, active: typeof auth?.active_provider === "string" ? auth.active_provider : null, routes: state, modelsDev: modelsDev ?? {} };
}

/** The efforts a model accepts on OpenRouter, from its published reasoning facts. */
export function openRouterEfforts(model) {
  const supported = Array.isArray(model?.supported_parameters) && model.supported_parameters.includes("reasoning");
  if (!supported) return ["none"];
  const reasoning = model.reasoning ?? {};
  const listed = Array.isArray(reasoning.supported_efforts) ? OPENROUTER_EFFORTS.filter((effort) => reasoning.supported_efforts.includes(effort)) : OPENROUTER_EFFORTS;
  // A model that must reason cannot be asked not to.
  return reasoning.mandatory === true ? listed.filter((effort) => effort !== "none") : listed;
}

function priceIsZero(value) {
  return value === undefined || value === null || Number(value) === 0;
}

/** Floating aliases and OpenRouter's own routers pick another model per request, so they are never a configuration. */
function floats(id) {
  return id.startsWith("~") || id.startsWith("openrouter/");
}

/** A model's display name from the metadata API, without the "Maker: " prefix or a trailing "(free)" (the Free badge says it): printable, bounded, else the id. It ends up in a catalog label. */
function displayName(name, id) {
  if (typeof name !== "string") return id;
  const plain = name.replace(/^[^:]+:\s*/u, "").replace(/\p{Cc}+/gu, " ").replace(/[^\p{L}\p{N}\p{P}\p{Zs}+]/gu, "").replace(/\s+/gu, " ").replace(/\s*\(free\)$/iu, "").trim();
  return plain && plain.length <= 80 ? plain : id;
}

/** One OpenRouter model as discovery reports it. */
export function describeOpenRouterModel(model, { curated = new Set() } = {}) {
  const id = model.id;
  const pricing = model.pricing ?? {};
  const free = isFreeSlug(id) || (priceIsZero(pricing.prompt) && priceIsZero(pricing.completion) && pricing.prompt !== undefined);
  const tools = Array.isArray(model.supported_parameters) && model.supported_parameters.includes("tools");
  const textOut = (model.architecture?.output_modalities ?? ["text"]).includes("text");
  const reasons = [];
  if (floats(id)) reasons.push("a router that picks another model per request");
  else if (!openRouterMaker(id)) reasons.push("not a pinned maker/model slug");
  if (!tools) reasons.push("no tool calling, which Hermes's file and terminal tools need");
  if (!textOut) reasons.push("does not answer in text");
  return {
    id, name: displayName(model.name, id), maker: openRouterMaker(id) ?? id.split("/")[0],
    free, contextLength: Number.isInteger(model.context_length) ? model.context_length : null,
    efforts: openRouterEfforts(model), reasoningMandatory: model.reasoning?.mandatory === true,
    ...(model.reasoning?.default_effort ? { defaultEffort: model.reasoning.default_effort } : {}),
    tools, hermesCurated: curated.has(id),
    cookable: reasons.length === 0, ...(reasons.length ? { reasons } : {}),
  };
}

/** One retry: a public metadata call that fails once (a reset connection, a busy host) usually answers the second time. */
async function fetchJson(url, fetchImpl) {
  try { return await fetchJsonOnce(url, fetchImpl); }
  catch { return fetchJsonOnce(url, fetchImpl); }
}

async function fetchJsonOnce(url, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), METADATA_TIMEOUT_MS);
  try {
    // A plain GET with no credentials: the metadata API is public.
    const response = await fetchImpl(url, { headers: { accept: "application/json" }, signal: controller.signal });
    if (!response.ok) throw new Error(`${url} answered ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/** OpenRouter's public model list, from the metadata API; on failure, Hermes's models.dev cache (and the result says so). */
export async function listOpenRouterModels({ env = {}, fetchImpl = globalThis.fetch, modelsDev = null, curated = new Set() } = {}) {
  try {
    const body = await fetchJson(`${openRouterMetadataUrl(env)}/models`, fetchImpl);
    if (!Array.isArray(body?.data)) throw new Error("OpenRouter model list has no data array");
    return { source: "openrouter:/api/v1/models", fetchedAt: new Date().toISOString(), models: body.data.filter((model) => typeof model?.id === "string").map((model) => describeOpenRouterModel(model, { curated })) };
  } catch (error) {
    const cached = modelsDev?.openrouter?.models;
    if (!cached || typeof cached !== "object") throw new Error(`OpenRouter's model list is unavailable (${error.message}) and Hermes has no models.dev cache to fall back on`, { cause: error });
    // models.dev has no per-parameter list, so tools and reasoning come from its flags.
    const models = Object.values(cached).filter((model) => typeof model?.id === "string").map((model) => describeOpenRouterModel({
      id: model.id, name: model.name, context_length: model.limit?.context, pricing: { prompt: model.cost?.input ?? null, completion: model.cost?.output ?? null },
      supported_parameters: [...(model.tool_call ? ["tools"] : []), ...(model.reasoning ? ["reasoning"] : [])],
      architecture: { output_modalities: model.modalities?.output ?? ["text"] },
    }, { curated }));
    return { source: "hermes:models_dev_cache.json", fetchedAt: null, warning: `live list unavailable: ${error.message}`, models };
  }
}

/**
 * The providers OpenRouter would route one model to, by provider slug. Endpoint
 * tags carry a quantization suffix (`venice/fp4`); one provider can list
 * several endpoints, and the pin names the provider.
 */
export async function openRouterModelProviders(modelId, { env = {}, fetchImpl = globalThis.fetch } = {}) {
  const [maker, rest] = [modelId.slice(0, modelId.indexOf("/")), modelId.slice(modelId.indexOf("/") + 1)];
  const body = await fetchJson(`${openRouterMetadataUrl(env)}/models/${encodeURIComponent(maker)}/${rest.split("/").map(encodeURIComponent).join("/")}/endpoints`, fetchImpl);
  const providers = new Map();
  for (const endpoint of body?.data?.endpoints ?? []) {
    const slug = typeof endpoint?.tag === "string" ? endpoint.tag.split("/")[0] : null;
    if (!slug || providers.has(slug)) continue;
    providers.set(slug, {
      slug, name: endpoint.provider_name ?? slug,
      free: priceIsZero(endpoint.pricing?.prompt) && priceIsZero(endpoint.pricing?.completion),
      tools: Array.isArray(endpoint.supported_parameters) && endpoint.supported_parameters.includes("tools"),
    });
  }
  return [...providers.values()];
}

function modelsDevFacts(modelsDev, route, id) {
  const section = modelsDev?.[MODELS_DEV_IDS[route] ?? route]?.models ?? {};
  const model = section[id];
  if (!model) return { free: /[-:]free$/u.test(id), contextLength: null, reasoning: null };
  return {
    free: /[-:]free$/u.test(id) || (model.cost ? Number(model.cost.input ?? 0) === 0 && Number(model.cost.output ?? 0) === 0 : false),
    contextLength: Number.isInteger(model.limit?.context) ? model.limit.context : null,
    reasoning: typeof model.reasoning === "boolean" ? model.reasoning : null,
  };
}

/**
 * Every route Hermes is set up for and every model on it. `route` narrows to one
 * route, `free` to free models. OpenRouter is listed from its live public list
 * (it reaches far beyond Hermes's curated picker); the rest from Hermes's caches.
 */
export async function discoverModels({ harness = "hermes", route = null, free = false, env = {}, fetchImpl = globalThis.fetch } = {}) {
  if (harness !== "hermes") throw new Error(`Model discovery reads Hermes's routes only (got harness ${harness})`);
  const state = await readHermesRouteState({ env });
  const routes = [];
  for (const entry of state.routes) {
    if (route && entry.route !== route) continue;
    const cookable = COOKABLE_HERMES_ROUTES[entry.route];
    let models;
    let source = entry.modelSource;
    let warning;
    let fetchedAt = entry.cachedAt;
    if (entry.route === OPENROUTER_ROUTE) {
      const listed = await listOpenRouterModels({ env, fetchImpl, modelsDev: state.modelsDev, curated: new Set(entry.cachedModels) });
      models = listed.models;
      source = listed.source;
      fetchedAt = listed.fetchedAt ?? entry.cachedAt;
      warning = listed.warning;
    } else {
      models = entry.cachedModels.map((id) => {
        const facts = modelsDevFacts(state.modelsDev, entry.route, id);
        // The Anthropic template takes Kitchen's own spelling of the four models it pins (claude-fable-5-1, not 5.1).
        const kitchenModel = entry.route === "anthropic" && HERMES_MODELS.includes(id.replaceAll(".", "-")) ? id.replaceAll(".", "-") : null;
        return {
          id, name: id, maker: id.includes("/") ? id.split("/")[0] : null, free: facts.free, contextLength: facts.contextLength,
          // Hermes's efforts per route are its own business; models.dev says only whether a model reasons.
          efforts: kitchenModel ? HERMES_EFFORTS : null, reasoning: facts.reasoning, tools: null, hermesCurated: true,
          cookable: Boolean(kitchenModel), ...(kitchenModel && kitchenModel !== id ? { kitchenModel } : {}),
          ...(cookable && !kitchenModel ? { reasons: ["the Anthropic template pins only Kitchen's four Claude models"] } : {}),
        };
      });
    }
    const listed = free ? models.filter((model) => model.free) : models;
    const reason = entry.status === "retired" ? entry.note
      : cookable ? null
        : "Kitchen has no Hermes execution profile for this route yet";
    routes.push({
      route: entry.route, label: entry.label, status: entry.status,
      ...(entry.authError ? { authError: entry.authError } : {}),
      ...(entry.fix ? { fix: entry.fix } : {}),
      credentials: entry.credentials, keyInShell: entry.keyInShell,
      cookable: Boolean(cookable) && entry.status !== "retired", ...(cookable ? { template: cookable.template, ...(cookable.note ? { note: cookable.note } : {}) } : {}),
      ...(reason ? { notCookable: reason } : {}),
      source, fetchedAt, ...(warning ? { warning } : {}),
      counts: { models: models.length, free: models.filter((model) => model.free).length, paid: models.filter((model) => !model.free).length },
      models: listed,
    });
  }
  if (route && !routes.length) throw new Error(`Hermes has no route ${route}; it knows ${state.routes.map((entry) => entry.route).join(", ")}`);
  return { harness, hermesHome: state.root === path.join(os.homedir(), ".hermes") ? "~/.hermes" : state.root, activeRoute: state.active, routes };
}

function contextLabel(tokens) {
  if (!tokens) return "";
  return tokens >= 1_000_000 ? `${Math.round(tokens / 104857.6) / 10}M` : `${Math.round(tokens / 1024)}k`;
}

/** The plain-text listing `taste models` prints. */
export function formatDiscovery(result) {
  const lines = [];
  for (const route of result.routes) {
    const credential = route.credentials.map((item) => item.source).filter(Boolean).join(", ");
    lines.push(`${route.route} · ${route.label} · ${route.status}${credential ? ` (${credential})` : ""}${route.authError ? ` — ${route.authError}` : ""}`);
    lines.push(`  ${route.counts.models} models, ${route.counts.free} free, ${route.counts.paid} paid · from ${route.source ?? "nothing cached"}${route.fetchedAt ? ` at ${route.fetchedAt}` : ""}`);
    if (route.warning) lines.push(`  warning: ${route.warning}`);
    if (route.fix) lines.push(`  fix: ${route.fix}`);
    lines.push(route.cookable ? `  cook: --config 'hermes:${route.route}/<model>@<effort>' (template ${route.template})` : `  not cookable: ${route.notCookable}`);
    for (const model of route.models) {
      const efforts = model.efforts ? model.efforts.join(",") : "?";
      const flags = [model.free ? "FREE" : "    ", contextLabel(model.contextLength).padStart(5), efforts.padEnd(32)];
      lines.push(`    ${flags.join("  ")}  ${model.id}${model.cookable === false && model.reasons ? `  (${model.reasons.join("; ")})` : ""}`);
    }
  }
  return lines.join("\n");
}
