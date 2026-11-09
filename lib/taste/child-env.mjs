/**
 * The environment a harness child starts with: an allowlist, not a denylist.
 *
 * Runs are unsandboxed and the tasted model has a shell, so whatever the
 * harness process holds the model can read (`/proc/<pid>/environ` of its own
 * ancestors). A child therefore receives only:
 * - the base names any program needs (path, home, user, locale, terminal, time zone, temp dir),
 * - the names its adapter asks for (network proxy settings, XDG directories for a real home),
 * - the caller's explicit `env`, minus anything credential-shaped and Kitchen's own `TASTE_` settings,
 * - the values the adapter sets, which win over everything else.
 *
 * `GH_TOKEN`, `OPENROUTER_API_KEY`, `BWS_ACCESS_TOKEN`, AWS keys, `SSH_AUTH_SOCK`,
 * a parent Claude Code or T3 session's channels, and any name added later never arrive.
 * The CLI passes no explicit `env`; programmatic callers (tests and their fakes) may.
 */

export const BASE_ENV = ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "LANGUAGE", "TERM", "TZ", "TMPDIR", "XDG_RUNTIME_DIR"];
const LOCALE = /^LC_[A-Z_]+$/u;
/** How a harness reaches the network when the host needs a proxy or a private CA. */
export const NETWORK_ENV = ["HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy", "SSL_CERT_FILE", "SSL_CERT_DIR", "NODE_EXTRA_CA_CERTS", "REQUESTS_CA_BUNDLE"];
/** Where a harness that keeps the real home finds its own config and login. */
export const XDG_HOME_ENV = ["XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME"];

/**
 * Names that hold a credential or point a harness at another login, home or
 * session: never passed on, even when a caller names them explicitly. An
 * adapter that needs one sets it itself.
 */
export const CREDENTIAL_ENV = /^(?:TASTE_|CLAUDE|ANTHROPIC_|OPENROUTER_|OPENAI_|GEMINI_|GOOGLE_|XAI_|NOUS_|OPENCODE_|MISTRAL_|DEEPSEEK_|AWS_|AZURE_|HF_|HUGGING|GITHUB_|GH_|BWS_|HERMES_|CODEX_|CURSOR_|T3_|T3CODE_|SSH_|GPG_|DBUS_)/u;

/** For an adapter that replaces HOME: drop the XDG directories, wherever they came from, so nothing resolves under the real home. */
export const WITHOUT_XDG_HOME = Object.fromEntries(XDG_HOME_ENV.map((key) => [key, undefined]));

/** The child environment: allowlisted names from `base`, the caller's scrubbed explicit names, then the adapter's own values (`undefined` removes one). */
export function harnessEnv({ env = {}, base = process.env, allow = [], set = {} } = {}) {
  const allowed = new Set([...BASE_ENV, ...allow]);
  const inherited = Object.entries(base).filter(([key, value]) => value !== undefined && (allowed.has(key) || LOCALE.test(key)));
  const explicit = Object.entries(env).filter(([key, value]) => value !== undefined && !CREDENTIAL_ENV.test(key));
  const child = Object.fromEntries([...inherited, ...explicit]);
  for (const [key, value] of Object.entries(set)) {
    if (value === undefined) delete child[key];
    else child[key] = value;
  }
  return child;
}

/**
 * A live run's environment: exactly as is. "Live" means the harness runs as he
 * runs it, so it keeps the whole environment of the shell that started the
 * Cook (secrets included), plus the caller's explicit names and the adapter's
 * own values. Only Claude Code live also drops a parent Claude session
 * (claude-code.mjs); nothing here scrubs.
 */
export function liveEnv({ env = {}, base = process.env, set = {} } = {}) {
  const child = Object.fromEntries(Object.entries({ ...base, ...env }).filter(([, value]) => value !== undefined));
  for (const [key, value] of Object.entries(set)) {
    if (value === undefined) delete child[key];
    else child[key] = value;
  }
  return child;
}
