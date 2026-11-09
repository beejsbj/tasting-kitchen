import { KEY_PROXY_AUTH } from "./key-proxy.mjs";

/**
 * Hermes routes Kitchen can cook through one execution profile, the route
 * profile (`hermes-linux-host-clean-route-v1`), with the route as its parameter.
 *
 * A route qualifies when Kitchen can keep its key behind the loopback key
 * proxy: Hermes reads the route's key from one environment variable and its
 * base URL from another, so a clean child gets the proxy's dummy token and
 * loopback URL in those variables and never the key. Each entry is checked
 * against Hermes's own provider registry (hermes_cli/auth.py) and against what
 * Hermes's state.db records for the route, because that record is the identity
 * evidence: `billing_provider` is the route id, and `billing_base_url` is the
 * base URL Hermes called, at one of `endpointPaths` (a route that speaks
 * several APIs records several). Adding a route is adding an entry here after
 * those two checks; nothing else changes.
 *
 * Any other route is refused for a clean cook with its reason, rather than
 * handing Hermes the credential (an OAuth login cannot be stood in for by a key
 * swap). OpenRouter and Anthropic keep their own profiles and hashes.
 */

export const HERMES_ROUTE_PROFILE_ID = "hermes-linux-host-clean-route-v1";

export const HERMES_KEY_ROUTES = {
  // OpenAI chat models are called at /zen/go/v1; Anthropic Messages models (MiniMax, Qwen, Claude) at /zen/go,
  // which Hermes records without /v1. The key goes as a bearer token or as x-api-key, and the proxy keeps the style.
  "opencode-go": {
    label: "OpenCode Go", upstream: "https://opencode.ai/zen/go/v1", keyEnv: "OPENCODE_GO_API_KEY", baseUrlEnv: "OPENCODE_GO_BASE_URL",
    endpointPaths: ["/zen/go/v1", "/zen/go"],
  },
};

/** Routes with a profile of their own: the route profile does not make a second way (and a second hash) to reach them. */
const OWN_PROFILE_ROUTES = new Set(["openrouter", "anthropic"]);

/** Routes Hermes reaches with a login rather than a key: why a clean cook cannot keep it from the model. */
const LOGIN_ROUTES = {
  nous: "Nous Portal signs Hermes in by an OAuth device-code login that Hermes refreshes itself",
  "openai-codex": "OpenAI Codex is a ChatGPT OAuth login Hermes holds",
  "xai-oauth": "xAI Grok is an OAuth login Hermes holds",
  "qwen-oauth": "Qwen is an OAuth login Hermes holds",
  "minimax-oauth": "MiniMax is an OAuth login Hermes holds",
  "copilot-acp": "Copilot ACP runs an external process with its own login",
};

/** Why the route profile cannot run `route`, or null when it can. */
export function hermesRouteRefusal(route) {
  if (typeof route !== "string" || route === "") return "the route profile must name the route";
  if (Object.hasOwn(HERMES_KEY_ROUTES, route)) return null;
  if (OWN_PROFILE_ROUTES.has(route)) return `${route} has its own execution profile`;
  if (Object.hasOwn(LOGIN_ROUTES, route)) return `${route} cannot be cooked clean: ${LOGIN_ROUTES[route]}, and Kitchen's key proxy stands in only for an API key, so the run would have to hand Hermes the OAuth login`;
  return `${route} has no key-proxy entry in Kitchen (lib/taste/hermes-routes.mjs), so Kitchen does not know which variables Hermes reads its key and base URL from, and a clean cook would have to hand Hermes the credential`;
}

/** The route's entry, or a clear refusal. */
export function hermesKeyRoute(route) {
  const refusal = hermesRouteRefusal(route);
  if (refusal) throw new Error(`Hermes route profile: ${refusal}`);
  return { id: route, ...HERMES_KEY_ROUTES[route] };
}

/** The adapter's view of a key route: what hermesRoute returns for a route-profile configuration. */
export function hermesKeyRouteInfo(route) {
  const entry = hermesKeyRoute(route);
  return { provider: entry.id, baseUrl: entry.upstream, auth: KEY_PROXY_AUTH, keyEnv: entry.keyEnv, baseUrlEnv: entry.baseUrlEnv, endpointPaths: entry.endpointPaths, label: entry.label };
}

/** The environment variable that points a route's key proxy at a loopback fake (tests only). */
export function routeUpstreamEnv(route) {
  return `TASTE_ROUTE_UPSTREAM_${route.toUpperCase().replace(/[^A-Z0-9]+/gu, "_")}`;
}

/** The key proxy a key route runs behind: its pinned upstream (or a loopback fake) and the real key from the cook command's environment, which only the proxy holds. */
export function hermesRouteKeyProxy(route, env = {}) {
  const entry = hermesKeyRoute(route);
  const name = routeUpstreamEnv(route);
  const override = env[name] ?? process.env[name];
  let upstream = entry.upstream;
  if (override !== undefined && override !== "") {
    if (!/^http:\/\/127\.0\.0\.1:\d{1,5}(?:\/[A-Za-z0-9._~/-]*)?$/u.test(override)) throw new Error(`${name} may only name a loopback fake (http://127.0.0.1:<port>/...)`);
    upstream = override.replace(/\/+$/u, "");
  }
  const key = env[entry.keyEnv] ?? process.env[entry.keyEnv];
  if (typeof key !== "string" || key.trim() === "") throw new Error(`Hermes ${entry.label} route needs ${entry.keyEnv} in the environment; export it for this command only before cooking`);
  return { upstream, apiKey: key.trim() };
}

/**
 * The maker of a model a key route names without one (`glm-5.3`), by the
 * prefix its family uses; a `maker/model` id names its own. A model nobody has
 * a maker for (a stealth model) keeps the route: that is all Kitchen knows of
 * where it comes from.
 */
const MAKER_PREFIXES = [
  ["claude-", "anthropic"], ["gpt-", "openai"], ["gemini-", "google"], ["gemma-", "google"], ["grok-", "x-ai"], ["deepseek-", "deepseek"],
  ["glm-", "z-ai"], ["kimi-", "moonshotai"], ["minimax-", "minimax"], ["qwen", "qwen"], ["mimo-", "xiaomi"], ["longcat-", "meituan"],
  ["hy", "tencent"], ["step-", "stepfun"],
];

export function routeModelMaker(route, model) {
  if (model.includes("/")) return model.slice(0, model.indexOf("/"));
  const match = MAKER_PREFIXES.find(([prefix]) => model.startsWith(prefix) && (prefix !== "hy" || /^hy\d/u.test(model)));
  return match ? match[1] : route;
}
