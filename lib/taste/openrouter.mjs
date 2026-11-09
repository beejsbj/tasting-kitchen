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

// A concrete slug: no `~` aliases that float to the latest model, no `:variant` suffixes.
const SLUG = /^([a-z0-9][a-z0-9-]*)\/([a-z0-9][a-z0-9.-]*)$/u;

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

/** The `provider` request object that pins the upstream: only that provider, no fallbacks. */
export function openRouterProviderPin(upstream) {
  if (!Object.hasOwn(OPENROUTER_UPSTREAMS, upstream ?? "")) throw new Error(`OpenRouter upstream pin must be one of ${Object.keys(OPENROUTER_UPSTREAMS).join(", ")} (got ${upstream})`);
  return { only: [upstream], allow_fallbacks: false };
}

/** Whether the provider a response reports is the pinned upstream. */
export function isPinnedUpstream(upstream, observed) {
  return Object.hasOwn(OPENROUTER_UPSTREAMS, upstream ?? "") && observed === OPENROUTER_UPSTREAMS[upstream];
}

export function openRouterMaker(model) {
  return SLUG.exec(model ?? "")?.[1] ?? null;
}

/** Throws a clear message unless `variant` names a pinned OpenRouter model under its maker. */
export function assertOpenRouterModel(variant, harness) {
  const maker = openRouterMaker(variant?.model);
  if (!maker) throw new Error(`${harness} OpenRouter route requires a pinned maker/model slug, not ${variant?.model}`);
  openRouterProviderPin(variant.executionProfile?.upstream);
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
