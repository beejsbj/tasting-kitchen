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
  const upstream = variant.executionProfile?.upstream;
  openRouterProviderPin(upstream);
  if (OPENROUTER_UPSTREAM_MAKERS[upstream] !== maker) throw new Error(`${harness} OpenRouter upstream pin ${upstream} is not the maker ${maker}'s own provider`);
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

/** Points the key proxy at a loopback fake instead of OpenRouter. Tests only: anything but a loopback URL is refused. */
export const OPENROUTER_UPSTREAM_ENV = "TASTE_OPENROUTER_UPSTREAM";

/** The upstream the key proxy forwards to: OpenRouter, or a loopback fake named by TASTE_OPENROUTER_UPSTREAM. */
export function openRouterUpstream(env = {}) {
  const override = env[OPENROUTER_UPSTREAM_ENV] ?? process.env[OPENROUTER_UPSTREAM_ENV];
  if (override === undefined || override === "") return OPENROUTER_BASE_URL;
  if (!/^http:\/\/127\.0\.0\.1:\d{1,5}(?:\/[A-Za-z0-9._~/-]*)?$/u.test(override)) throw new Error(`${OPENROUTER_UPSTREAM_ENV} may only name a loopback fake (http://127.0.0.1:<port>/...)`);
  return override.replace(/\/+$/u, "");
}

/** The key proxy an OpenRouter route runs behind: the pinned upstream and the real key, which only the proxy holds. */
export function openRouterKeyProxy(env = {}, harness = "Kitchen") {
  return { upstream: openRouterUpstream(env), apiKey: requireOpenRouterKey(env, harness) };
}
