/**
 * The OpenRouter inference route, shared by every harness that can reach it.
 *
 * A configuration on this route names the model by OpenRouter's slug
 * (`maker/model`, such as `anthropic/claude-opus-5.5`), and its `provider` is
 * the maker: the route is the execution profile's business, not the provider's.
 * The key comes from the caller's environment and is never written to disk.
 */

export const OPENROUTER_ROUTE = "openrouter";
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
export const OPENROUTER_KEY_ENV = "OPENROUTER_API_KEY";
/** OpenRouter's normalized reasoning efforts. */
export const OPENROUTER_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh"];

// A concrete slug: no `~` aliases that float to the latest model, and no `:variant`
// suffix but `:free`, which names OpenRouter's separate zero-priced offering of a model.
const SLUG = /^([a-z0-9][a-z0-9-]*)\/([a-z0-9][a-z0-9.-]*)(?::free)?$/u;
// An OpenRouter provider slug, without the `/fp8`-style endpoint suffix its tags carry.
const PROVIDER_SLUG = /^[a-z0-9][a-z0-9-]*$/u;
/** Why a configuration pins the upstream it does, when that is not settled by the table above. */
export const UPSTREAM_CHOICES = ["maker", "sole-provider", "named"];

/**
 * The upstream providers a configuration may pin, by OpenRouter provider slug,
 * with the display name OpenRouter reports as the response's `provider`
 * (both from OpenRouter's public providers list). A maker's own slug is not
 * always its provider slug: x-ai is `xai`, qwen is served by `alibaba`.
 */
export const OPENROUTER_UPSTREAMS = {
  anthropic: "Anthropic",
  "google-ai-studio": "Google AI Studio",
  xai: "xAI",
  meta: "Meta",
  moonshotai: "Moonshot AI",
  deepseek: "DeepSeek",
  "z-ai": "Z.AI",
  alibaba: "Alibaba",
  mistral: "Mistral",
};

/** The maker whose own models each upstream may be pinned for. */
export const OPENROUTER_UPSTREAM_MAKERS = {
  anthropic: "anthropic",
  "google-ai-studio": "google",
  xai: "x-ai",
  meta: "meta",
  moonshotai: "moonshotai",
  deepseek: "deepseek",
  "z-ai": "z-ai",
  alibaba: "qwen",
  mistral: "mistralai",
};

/**
 * The `provider` request object that pins the upstream: only that provider, no
 * fallbacks. A slug outside the table is accepted only when the configuration
 * records its choice (see assertOpenRouterModel), so callers pass `{ recorded: true }`.
 */
export function openRouterProviderPin(upstream, { recorded = false } = {}) {
  const known = Object.hasOwn(OPENROUTER_UPSTREAMS, upstream ?? "");
  if (!known && !(recorded && PROVIDER_SLUG.test(upstream ?? ""))) throw new Error(`OpenRouter upstream pin must be one of ${Object.keys(OPENROUTER_UPSTREAMS).join(", ")}, or a provider slug whose choice the configuration records (got ${upstream})`);
  return { only: [upstream], allow_fallbacks: false };
}

/** The display name OpenRouter reports for a configuration's pinned upstream: the recorded one, else the table's. */
export function upstreamName(variant) {
  return variant?.upstreamChoice?.name ?? OPENROUTER_UPSTREAMS[variant?.executionProfile?.upstream] ?? null;
}

/** The pin request for a configuration, honouring a recorded upstream choice. */
export function configurationProviderPin(variant) {
  return openRouterProviderPin(variant?.executionProfile?.upstream, { recorded: variant?.upstreamChoice !== undefined });
}

/** Whether the provider a response reports is the pinned upstream. `name` is the pinned provider's display name when it is not in the table. */
export function isPinnedUpstream(upstream, observed, name = OPENROUTER_UPSTREAMS[upstream ?? ""]) {
  return typeof name === "string" && name !== "" && observed === name;
}

/** Whether an upstream slug is the maker's own provider: by the table, or by the maker's own slug (nvidia, cohere, liquid). */
export function isMakerUpstream(upstream, maker) {
  return OPENROUTER_UPSTREAM_MAKERS[upstream] === maker || (upstream === maker && !Object.hasOwn(OPENROUTER_UPSTREAM_MAKERS, upstream));
}

export function openRouterMaker(model) {
  return SLUG.exec(model ?? "")?.[1] ?? null;
}

/** Whether a slug names OpenRouter's free offering of a model. */
export function isFreeSlug(model) {
  return typeof model === "string" && model.endsWith(":free") && SLUG.test(model);
}

/**
 * Throws a clear message unless `variant` names a pinned OpenRouter model under
 * its maker. The pin is the maker's own provider from the table, or, when the
 * configuration records an `upstreamChoice`, a provider it names with the
 * reason: the maker's own (`maker`), the only provider serving the model
 * (`sole-provider`, as for most free models), or one Burooj named (`named`).
 */
export function assertOpenRouterModel(variant, harness) {
  const maker = openRouterMaker(variant?.model);
  if (!maker) throw new Error(`${harness} OpenRouter route requires a pinned maker/model slug, not ${variant?.model}`);
  const upstream = variant.executionProfile?.upstream;
  const choice = variant.upstreamChoice;
  configurationProviderPin(variant);
  if (choice === undefined) {
    if (OPENROUTER_UPSTREAM_MAKERS[upstream] !== maker) throw new Error(`${harness} OpenRouter upstream pin ${upstream} is not the maker ${maker}'s own provider`);
  } else {
    if (!choice || typeof choice !== "object" || typeof choice.name !== "string" || choice.name.trim() === "") throw new Error(`${harness} OpenRouter upstreamChoice must name the provider OpenRouter reports`);
    if (!UPSTREAM_CHOICES.includes(choice.reason)) throw new Error(`${harness} OpenRouter upstreamChoice.reason must be one of ${UPSTREAM_CHOICES.join(", ")}`);
    if (choice.reason === "maker" && !isMakerUpstream(upstream, maker)) throw new Error(`${harness} OpenRouter upstream pin ${upstream} is not the maker ${maker}'s own provider`);
    if (choice.reason === "maker" && Object.hasOwn(OPENROUTER_UPSTREAMS, upstream) && choice.name !== OPENROUTER_UPSTREAMS[upstream]) throw new Error(`${harness} OpenRouter upstreamChoice.name must be ${OPENROUTER_UPSTREAMS[upstream]}`);
  }
  if (variant.provider !== maker) throw new Error(`${harness} OpenRouter configuration provider must be the model's maker ${maker} (got ${variant.provider})`);
}

/** The key, from the caller's env first. Never logged. */
export function openRouterKey(env = {}) {
  const key = env[OPENROUTER_KEY_ENV] ?? process.env[OPENROUTER_KEY_ENV];
  return typeof key === "string" && key.trim() !== "" ? key.trim() : null;
}

export function requireOpenRouterKey(env = {}, harness = "Kitchen") {
  const key = openRouterKey(env);
  if (!key) throw new Error(`${harness} OpenRouter route needs ${OPENROUTER_KEY_ENV} in the environment; export it for this command only before cooking`);
  return key;
}
