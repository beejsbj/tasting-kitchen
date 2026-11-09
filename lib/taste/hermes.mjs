import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { NETWORK_ENV, harnessEnv } from "./child-env.mjs";
import { readClaudeLogin } from "./claude-code.mjs";
import { canonicalJson } from "./hash.mjs";
import { DETACHED_CHILD, trackChild } from "./interrupt.mjs";
import { collectSetupChildren, collectSetupFile, createSetupBudget, setupDigest, setupRecord, setupText, toggleOn, writeSetupFiles } from "./environments.mjs";
import { KEY_PROXY_AUTH, isKeyProxyBaseUrl } from "./key-proxy.mjs";
import { OPENROUTER_BASE_URL, OPENROUTER_KEY_ENV, OPENROUTER_ROUTE, openRouterProviderPin, requireOpenRouterKey } from "./openrouter.mjs";

/**
 * Hermes Agent adapter.
 *
 * Hermes runs one headless turn per process (`chat --query-file … --oneshot
 * --format stream-json`) and continues a session with `--resume <id>`. Its
 * stream only echoes the requested model, so observed identity comes from the
 * session database Hermes writes beside the run: `session_model_usage` records
 * every main-loop API call under the model and billing provider Hermes actually
 * routed it to, so a silent fallback shows up as a second row.
 *
 * Both environments run in a fresh Hermes home per attempt (HERMES_HOME). On
 * the Anthropic route Hermes borrows the existing Claude Code login, but only
 * as an access-token copy inside that home (CLAUDE_CONFIG_DIR points there):
 * with no refresh token it cannot rotate the login, and anything Hermes writes
 * back lands in the copy, never in ~/.claude/.credentials.json. On the
 * OpenRouter route Hermes never holds the key: it talks to Kitchen's loopback
 * key proxy (key-proxy.mjs) with a per-attempt dummy token. The home is emptied
 * of everything but its session database after the session.
 * Clean holds only a Kitchen-written config.yaml. Snapshot holds a copy of a
 * named profile (soul, skills, memories as the toggle allows, MCP servers and
 * plugins only with connections on) and a config.yaml built from an allowlist
 * of that profile's settings: never its secrets, fallbacks or gateway sections.
 * Kitchen never runs a Hermes profile live, and never writes under ~/.hermes.
 */

export const HERMES_TOOLSETS = "file,terminal";
export const HERMES_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"];
export const HERMES_MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1"];
/** What survives a session in the throwaway home: the database identity checks and recovery read. Everything else, a copied login included, is removed. */
const KEPT_AFTER_SESSION = new Set(["state.db", "state.db-wal", "state.db-shm"]);

// The inference route is part of what is tasted, so it lives in the execution profile id.
const ROUTES = {
  "hermes-linux-host-clean-anthropic-v1": { provider: "anthropic", baseUrl: "https://api.anthropic.com", auth: "borrowed-claude-code-login" },
  "hermes-linux-host-snapshot-anthropic-v1": { provider: "anthropic", baseUrl: "https://api.anthropic.com", auth: "borrowed-claude-code-login" },
  "hermes-linux-host-clean-openrouter-v1": { provider: OPENROUTER_ROUTE, baseUrl: OPENROUTER_BASE_URL, auth: KEY_PROXY_AUTH },
};

const SESSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{5,127}$/u;
// Where the access-token copy of the borrowed Claude Code login sits, inside the throwaway home.
const LOGIN_COPY = "claude-login";

function requiredString(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} must be a non-empty string`);
  return value;
}

function absolutePath(value, name) {
  requiredString(value, name);
  if (!path.isAbsolute(value)) throw new TypeError(`${name} must be an absolute path`);
  return path.normalize(value);
}

export function hermesRoute(variant) {
  const route = ROUTES[variant?.executionProfile?.id];
  if (!route) throw new Error(`Hermes execution profile has no known inference route: ${variant?.executionProfile?.id}`);
  return route;
}

export function hermesEnvironment(variant) {
  const environment = variant?.executionProfile?.environment;
  if (environment !== "clean" && environment !== "snapshot") throw new Error(`Hermes execution profile must declare the clean or snapshot environment (got ${environment})`);
  return environment;
}

export function hermesRoot(env = {}) {
  return env.TASTE_HERMES_ROOT ?? process.env.TASTE_HERMES_ROOT ?? path.join(os.homedir(), ".hermes");
}

function claudeConfigDir(env = {}) {
  return env.CLAUDE_CONFIG_DIR ?? process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude");
}

/** The Claude Code login file the Anthropic route borrows from. Read only; Hermes is never pointed at it. */
export function hermesLoginSource(env = {}) {
  return path.join(claudeConfigDir(env), ".credentials.json");
}

/** The CLAUDE_CONFIG_DIR a Hermes child sees: the copy inside its throwaway home. */
export function hermesLoginCopy(hermesHome) {
  return path.join(absolutePath(hermesHome, "hermesHome"), LOGIN_COPY);
}

/**
 * Give Hermes the borrowed login as an access token with its expiry and scopes,
 * never the refresh token, and refuse one that would expire within the run
 * window (TASTE_CLAUDE_TOKEN_MARGIN_MS, as for Claude Code). Hermes reads and
 * writes Claude Code's login through CLAUDE_CONFIG_DIR, so a refresh it
 * attempts fails without a refresh token, and any write lands in this copy.
 */
export async function writeHermesLoginCopy({ hermesHome, env = {} }) {
  const login = await readClaudeLogin({ env, source: hermesLoginSource(env) });
  const directory = hermesLoginCopy(hermesHome);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(path.join(directory, ".credentials.json"), `${JSON.stringify({ claudeAiOauth: login })}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  return directory;
}

/** The throwaway Hermes home whose state.db holds this run's sessions. Both environments use one. */
export function hermesHomeFor({ variant, attemptDir }) {
  hermesEnvironment(variant);
  return path.join(absolutePath(attemptDir, "attemptDir"), "hermes-home");
}

/** The profile a snapshot copies, read from the same root Kitchen names, so the copy and the identity reader cannot disagree. */
export function hermesProfileSource(variant, env = {}) {
  const profile = requiredString(variant?.executionProfile?.harnessProfile, "executionProfile.harnessProfile");
  return profile === "default" ? hermesRoot(env) : path.join(hermesRoot(env), "profiles", profile);
}

/**
 * An allowlisted environment (child-env.mjs): no provider key, token or agent
 * socket from the Kitchen's own environment arrives. The one credential a route
 * needs is set deliberately: the login copy's directory for the Anthropic route,
 * the key proxy's dummy token and loopback URL for OpenRouter. HERMES_DISABLE_LAZY_INSTALLS
 * stops a fresh home outside ~/.hermes from building its own dependency environment.
 */
export function hermesProcessEnv({ variant, hermesHome, env = {}, proxy = null, set: extra = {} }) {
  const set = { HERMES_HOME: hermesHome, HERMES_DISABLE_LAZY_INSTALLS: "1", ...extra };
  const auth = variant ? hermesRoute(variant).auth : null;
  if (auth === "borrowed-claude-code-login") set.CLAUDE_CONFIG_DIR = hermesLoginCopy(hermesHome);
  if (auth === KEY_PROXY_AUTH) {
    if (!proxy) throw new Error("Hermes OpenRouter route runs only through Kitchen's key proxy");
    // Hermes treats a provider: openrouter base URL from OPENROUTER_BASE_URL as a deliberate mirror and sends it OPENROUTER_API_KEY.
    Object.assign(set, { [OPENROUTER_KEY_ENV]: proxy.token, OPENROUTER_BASE_URL: proxy.baseUrl });
  }
  const child = harnessEnv({ env, allow: NETWORK_ENV, set });
  // The key proxy is on loopback: it must never go through the host's HTTP proxy.
  if (auth === KEY_PROXY_AUTH) for (const name of ["NO_PROXY", "no_proxy"]) child[name] = [child[name], "127.0.0.1"].filter(Boolean).join(",");
  return child;
}

/** Minimal config for the clean home: the route and model only. No fallbacks, secrets, plugins, or MCP servers. */
export function cleanHermesConfig(variant) {
  const route = hermesRoute(variant);
  return [
    "# Written by Tasting Kitchen for one clean attempt.",
    "model:",
    `  provider: ${route.provider}`,
    `  default: ${variant.model}`,
    // Only the borrowed-login route adopts an external login; the key-proxy route must not find one.
    "auth:",
    `  adopt_external_logins: ${route.auth === "borrowed-claude-code-login"}`,
    // Hermes sends this as OpenRouter's `provider.only`, so no other upstream can serve the
    // model (Hermes records no upstream, so this one is enforced by the request, not observed).
    ...(route.auth === KEY_PROXY_AUTH ? ["provider_routing:", "  only:", `    - ${openRouterProviderPin(variant.executionProfile.upstream).only[0]}`, "  require_parameters: true"] : []),
    "",
  ].join("\n");
}

/** Settings a snapshot keeps from the profile's config.yaml. Everything else (secrets helpers, fallbacks, platforms, gateways, cron, display) stays behind. */
export const HERMES_SNAPSHOT_SETTINGS = { memory: ["memory_char_limit", "user_char_limit"], skills: ["auto_load", "disabled"] };

function pick(object, keys) {
  return Object.fromEntries(keys.filter((key) => object?.[key] !== undefined).map((key) => [key, object[key]]));
}

/**
 * The config.yaml a snapshot home receives: the pinned route and model, the
 * memory toggle, his skill choices, and with connections on his MCP servers and
 * plugins. JSON is valid YAML, and sorted keys keep the digest stable.
 */
export function snapshotHermesConfig(variant, profileConfig = {}) {
  const route = hermesRoute(variant);
  const memory = toggleOn(variant, "memory");
  const config = {
    model: { provider: route.provider, default: variant.model },
    auth: { adopt_external_logins: true },
    // An external memory provider would need its own credentials; only built-in memory travels.
    memory: { ...pick(profileConfig.memory, HERMES_SNAPSHOT_SETTINGS.memory), memory_enabled: memory, user_profile_enabled: memory, provider: "" },
    ...(profileConfig.skills ? { skills: pick(profileConfig.skills, HERMES_SNAPSHOT_SETTINGS.skills) } : {}),
    ...(profileConfig._config_version !== undefined ? { _config_version: profileConfig._config_version } : {}),
  };
  if (toggleOn(variant, "connections")) {
    if (profileConfig.mcp_servers) config.mcp_servers = profileConfig.mcp_servers;
    if (profileConfig.plugins) config.plugins = profileConfig.plugins;
  }
  return `${JSON.stringify(JSON.parse(canonicalJson(config)), null, 2)}\n`;
}

async function readProfileConfig(source) {
  let text;
  try { text = await readFile(path.join(source, "config.yaml"), "utf8"); }
  catch { throw new Error(`Hermes profile has no readable config.yaml at ${source}`); }
  const { load } = await import("js-yaml");
  const parsed = load(text);
  return parsed && typeof parsed === "object" ? parsed : {};
}

/** MCP toolsets a snapshot with connections on adds to the pinned file and terminal tools. */
export function hermesConnectionToolsets(profileConfig = {}) {
  return Object.keys(profileConfig.mcp_servers ?? {}).sort().map((name) => `mcp-${name}`);
}

/**
 * The deterministic copy of a Hermes profile a snapshot attempt starts from,
 * as files relative to the throwaway home. Reads only; never auth.json, .env
 * or the gateway, cron, session and platform state beside them.
 */
export async function collectHermesSnapshot({ variant, env = {} } = {}) {
  const source = hermesProfileSource(variant, env);
  const profileConfig = await readProfileConfig(source);
  const budget = createSetupBudget();
  const files = [setupText("config.yaml", snapshotHermesConfig(variant, profileConfig))];
  files.push(...await collectSetupFile(path.join(source, "SOUL.md"), "SOUL.md", budget));
  // Without it, a fresh home seeds Hermes's bundled skills beside his own.
  files.push(...await collectSetupFile(path.join(source, ".no-bundled-skills"), ".no-bundled-skills", budget));
  files.push(...await collectSetupChildren(path.join(source, "skills"), "skills", budget));
  if (toggleOn(variant, "memory")) {
    for (const name of ["MEMORY.md", "USER.md"]) files.push(...await collectSetupFile(path.join(source, "memories", name), `memories/${name}`, budget));
  }
  if (toggleOn(variant, "connections")) files.push(...await collectSetupChildren(path.join(source, "plugins"), "plugins", budget));
  return { files, toolsets: [HERMES_TOOLSETS, ...(toggleOn(variant, "connections") ? hermesConnectionToolsets(profileConfig) : [])].join(",") };
}

export async function currentHermesSetupDigest({ variant, env = {} } = {}) {
  if (hermesEnvironment(variant) !== "snapshot") return null;
  return setupDigest((await collectHermesSnapshot({ variant, env })).files);
}

export function buildHermesTurnArgs({ variant, workspace, queryFile, threadId, toolsets = HERMES_TOOLSETS } = {}) {
  if (!variant || variant.harness !== "hermes") throw new Error("Hermes adapter requires a hermes configuration");
  const route = hermesRoute(variant);
  const model = requiredString(variant.model, "variant.model");
  const effort = requiredString(variant.reasoningEffort, "variant.reasoningEffort");
  if (!HERMES_EFFORTS.includes(effort)) throw new Error(`Hermes reasoning effort must be one of ${HERMES_EFFORTS.join(", ")}`);
  assertHermesToolsets(toolsets, variant);
  // The prompt travels in a file: nothing is shell-interpreted and argv stays small.
  const args = ["chat", "--query-file", absolutePath(queryFile, "queryFile"), "--oneshot", "--format", "stream-json",
    "--provider", route.provider, "-m", model, "--reasoning", effort, "-t", toolsets,
    "--yolo", "--source", "tool", "--in", absolutePath(workspace, "workspace")];
  // Clean skips AGENTS.md, SOUL.md, memory and preloaded skills; a snapshot keeps the copied profile's.
  if (hermesEnvironment(variant) === "clean") args.push("--ignore-rules");
  if (threadId !== undefined && threadId !== null) {
    if (!SESSION_PATTERN.test(threadId)) throw new TypeError("threadId must be an exact Hermes session id");
    args.push("--resume", threadId);
  }
  return args;
}

function collectProcess(executable, args, options) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const child = trackChild(spawn(executable, args, { cwd: options.cwd, env: options.env, shell: false, stdio: ["ignore", "pipe", "pipe"], ...DETACHED_CHILD }));
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      if (!settled) { settled = true; resolve({ exitCode: null, signal: null, stdout, stderr, spawnError: error }); }
    });
    child.on("close", (exitCode, signal) => {
      if (!settled) { settled = true; resolve({ exitCode, signal, stdout, stderr, spawnError: null }); }
    });
  });
}

export class HermesExecutionError extends Error {
  constructor(message, result, options) {
    super(message, options);
    this.name = "HermesExecutionError";
    this.result = result;
  }
}

/** One turn's stream: exactly one init, then exactly one successful result. */
export function hermesTurnEvidence(events, { resumedFrom } = {}) {
  if (!Array.isArray(events)) throw new TypeError("Hermes turn events must be an array");
  const inits = events.filter((event) => event?.type === "system" && event?.subtype === "init");
  if (inits.length !== 1) throw new Error(`Hermes stream contained ${inits.length} init events; expected exactly one`);
  const results = events.filter((event) => event?.type === "result");
  if (results.length !== 1) throw new Error(`Hermes stream contained ${results.length} result events; expected exactly one`);
  const [init] = inits;
  const [result] = results;
  if (events.indexOf(init) > events.indexOf(result)) throw new Error("Hermes result appeared before its init event");
  if (result.exit_code !== 0 || result.error) throw new Error(`Hermes reported failure: ${result.error ?? `exit code ${result.exit_code}`}`);
  if (typeof result.text !== "string") throw new Error("Hermes result lacks final text");
  if (!SESSION_PATTERN.test(result.session_id ?? "")) throw new Error("Hermes result did not contain a valid session id");
  if (resumedFrom !== undefined && resumedFrom !== null && init.session_id !== resumedFrom) {
    throw new Error(`Hermes resumed ${init.session_id}, not session ${resumedFrom}`);
  }
  return { init, result };
}

export function parseHermesJsonl(stdout, options) {
  if (typeof stdout !== "string") throw new TypeError("stdout must be a string");
  const events = stdout.split(/\r?\n/u).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); }
    catch (error) { throw new Error(`Invalid Hermes JSONL on line ${index + 1}: ${error.message}`); }
  });
  const { init, result } = hermesTurnEvidence(events, options);
  // A context-compression rotation can end a turn in a child session; the next turn resumes that one.
  return { events, threadId: result.session_id, initSessionId: init.session_id, model: init.model ?? null, finalMessage: result.text, usage: result.tokens ?? null };
}

export async function getHermesVersion({ executable = "hermes", hermesHome, env = {}, cwd, variant } = {}) {
  // The version query gets the same isolated home and allowlisted environment as the run itself,
  // and a borrowed Claude login resolves to the run's copy, never the real one. It needs no key, so no proxy.
  const set = hermesHome && variant && hermesRoute(variant).auth === "borrowed-claude-code-login" ? { CLAUDE_CONFIG_DIR: hermesLoginCopy(hermesHome) } : {};
  const processEnv = hermesHome ? hermesProcessEnv({ hermesHome, env, set }) : harnessEnv({ env, allow: NETWORK_ENV });
  const result = await collectProcess(requiredString(executable, "executable"), ["--version"], { cwd: cwd ? absolutePath(cwd, "cwd") : process.cwd(), env: processEnv });
  if (result.spawnError) throw new HermesExecutionError(`Could not start Hermes: ${result.spawnError.message}`, result, { cause: result.spawnError });
  if (result.exitCode !== 0) throw new HermesExecutionError(`hermes --version exited with code ${result.exitCode}`, result);
  const version = result.stdout.split(/\r?\n/u).map((line) => line.trim()).find(Boolean);
  if (!version) throw new HermesExecutionError("hermes --version returned an empty version", result);
  return version;
}

/**
 * The binary that runs an attempt. The `hermes` launcher scopes its dependency
 * environment to the active home and would try to build a new one for a fresh
 * home, so attempts use the committed environment's own entry point directly.
 * An explicit executable (tests, a pinned install) is kept.
 */
export async function resolveHermesRuntime({ variant, executable = "hermes", env = {} }) {
  hermesEnvironment(variant);
  if (executable !== "hermes") return executable;
  const installs = path.join(hermesRoot(env), "installs");
  const candidates = [];
  for (const entry of await readdir(installs).catch(() => [])) {
    let facts;
    try { facts = JSON.parse(await readFile(path.join(installs, entry, "facts.json"), "utf8")); }
    catch { continue; }
    const environment = facts?.packages?.venv?.environment;
    if (typeof environment !== "string" || !path.isAbsolute(environment)) continue;
    const binary = path.join(environment, "bin", "hermes");
    if ((await stat(binary).catch(() => null))?.isFile()) candidates.push(binary);
  }
  if (candidates.length !== 1) throw new Error(`Expected one committed Hermes dependency environment under ${installs}; found ${candidates.length}`);
  return candidates[0];
}

/** Read what Hermes recorded about the route of every main-loop call in these sessions. */
export async function readHermesIdentity(stateDb, sessionIds) {
  if (!(await stat(stateDb).catch(() => null))?.isFile()) throw new Error(`Hermes session database is missing: ${stateDb}`);
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(stateDb, { readOnly: true });
  try {
    const sessionQuery = db.prepare("SELECT id, source, model, model_config, billing_provider, billing_base_url FROM sessions WHERE id = ?");
    const usageQuery = db.prepare("SELECT model, billing_provider, billing_base_url, task, api_call_count FROM session_model_usage WHERE session_id = ? ORDER BY task, model");
    const sessions = [];
    const usage = [];
    for (const id of [...new Set(sessionIds)]) {
      const row = sessionQuery.get(id);
      if (!row) throw new Error(`Hermes session database has no session ${id}`);
      let modelConfig = null;
      try { modelConfig = row.model_config ? JSON.parse(row.model_config) : null; }
      catch { modelConfig = null; }
      sessions.push({
        id: row.id, source: row.source, model: row.model, billingProvider: row.billing_provider, billingBaseUrl: row.billing_base_url,
        reasoningEffort: modelConfig?.reasoning_config?.effort ?? null,
      });
      for (const call of usageQuery.all(id)) {
        usage.push({ sessionId: id, task: call.task, model: call.model, billingProvider: call.billing_provider, billingBaseUrl: call.billing_base_url, apiCalls: call.api_call_count });
      }
    }
    return { sessions, usage };
  } finally {
    db.close();
  }
}

/**
 * Compare recorded routes against the request. Returns mismatch strings; empty means verified.
 * On the key-proxy route Hermes records the loopback proxy as its endpoint: one proxy
 * URL across every call is accepted, and the proxy forwards only to the pinned upstream.
 */
export function hermesIdentityMismatches(identity, variant) {
  const route = hermesRoute(variant);
  const mismatches = [];
  const main = identity.usage.filter((call) => call.task === "");
  if (main.length === 0) mismatches.push("no main-loop API call was recorded");
  const proxied = route.auth === KEY_PROXY_AUTH;
  const endpoints = new Set(main.map((call) => call.billingBaseUrl));
  if (proxied && endpoints.size > 1) mismatches.push(`calls went to ${endpoints.size} endpoints, not one key proxy`);
  for (const call of main) {
    if (call.model !== variant.model) mismatches.push(`model requested ${variant.model}, observed ${call.model}`);
    if (call.billingProvider !== route.provider) mismatches.push(`provider route requested ${route.provider}, observed ${call.billingProvider || "none"}`);
    const endpointOk = proxied ? isKeyProxyBaseUrl(call.billingBaseUrl, route.baseUrl) : call.billingBaseUrl === route.baseUrl;
    if (!endpointOk) mismatches.push(`endpoint requested ${proxied ? `Kitchen's key proxy to ${route.baseUrl}` : route.baseUrl}, observed ${call.billingBaseUrl || "none"}`);
  }
  for (const session of identity.sessions) {
    if (session.model !== variant.model) mismatches.push(`session ${session.id} model ${session.model}`);
    if (session.reasoningEffort !== variant.reasoningEffort) mismatches.push(`effort requested ${variant.reasoningEffort}, session ${session.id} recorded ${session.reasoningEffort ?? "none"}`);
  }
  return [...new Set(mismatches)];
}

function attemptDirFor(workspace) {
  return path.dirname(absolutePath(workspace, "workspace"));
}

/**
 * Empty a throwaway home of everything but its session database. Hermes copies
 * the borrowed Claude Code login into its own pool, and a snapshot holds his
 * soul and memories as files; neither may outlive the session. The database
 * stays for identity verification and recovery, and holds each session's system
 * prompt (so the soul and memory text as the model saw it). Keeping an allowlist
 * means a later Hermes that writes new credential files is covered too. The
 * runner also calls this after a failed or interrupted session, and recovery
 * before it publishes.
 */
export async function cleanupHermesHome(hermesHome) {
  const home = absolutePath(hermesHome, "hermesHome");
  const entries = await readdir(home).catch((error) => {
    if (error?.code === "ENOENT") return [];
    throw error;
  });
  await Promise.all(entries.filter((name) => !KEPT_AFTER_SESSION.has(name)).map((name) => rm(path.join(home, name), { recursive: true, force: true })));
}

export function cleanupHermesAttempt({ variant, cwd }) {
  return cleanupHermesHome(hermesHomeFor({ variant, attemptDir: cwd }));
}

function mainLoopCalls(identity) {
  return identity.usage.filter((call) => call.task === "").reduce((total, call) => total + call.apiCalls, 0);
}

async function runHermesTurn({ variant, workspace, artifactDir, prompt, threadId, knownSessions, runtime, hermesHome, env, toolsets, proxy }) {
  await mkdir(artifactDir, { recursive: true });
  const paths = {
    query: path.join(artifactDir, "query.txt"), stdout: path.join(artifactDir, "stdout.jsonl"), stderr: path.join(artifactDir, "stderr.txt"),
    finalMessage: path.join(artifactDir, "final.txt"), identity: path.join(artifactDir, "identity.json"),
  };
  await writeFile(paths.query, prompt, "utf8");
  const args = buildHermesTurnArgs({ variant, workspace, queryFile: paths.query, threadId, toolsets });
  const stateDb = path.join(hermesHome, "state.db");
  // A hook can end a resumed turn before inference and still return success, so the earlier
  // turns' calls must not satisfy this turn: it needs a main-loop call of its own, counted
  // across every session so far, which also covers a compression child.
  const before = knownSessions.length ? mainLoopCalls(await readHermesIdentity(stateDb, knownSessions)) : 0;
  const result = await collectProcess(runtime, args, { cwd: workspace, env: hermesProcessEnv({ variant, hermesHome, env, proxy }) });
  await Promise.all([writeFile(paths.stdout, result.stdout, "utf8"), writeFile(paths.stderr, result.stderr, "utf8")]);
  const partial = { ...result, paths, argv: [runtime, ...args] };
  if (result.spawnError) throw new HermesExecutionError(`Could not start Hermes: ${result.spawnError.message}`, partial, { cause: result.spawnError });
  let parsed;
  try { parsed = parseHermesJsonl(result.stdout, { resumedFrom: threadId }); }
  catch (error) { throw new HermesExecutionError(result.exitCode !== 0 ? `Hermes exited with code ${result.exitCode}: ${error.message}` : error.message, partial, { cause: error }); }
  if (result.exitCode !== 0) throw new HermesExecutionError(`Hermes exited with code ${result.exitCode}${result.signal ? ` (${result.signal})` : ""}`, { ...partial, ...parsed });
  const identity = await readHermesIdentity(stateDb, [...knownSessions, parsed.initSessionId, parsed.threadId]);
  await writeFile(paths.identity, `${JSON.stringify(identity, null, 2)}\n`, "utf8");
  const mismatches = hermesIdentityMismatches(identity, variant);
  if (mainLoopCalls(identity) <= before) mismatches.push("this turn recorded no new main-loop API call");
  if (mismatches.length) throw new HermesExecutionError(`Effective Hermes identity mismatch: ${mismatches.join("; ")}`, { ...partial, ...parsed });
  await writeFile(paths.finalMessage, parsed.finalMessage, "utf8");
  return { ...partial, ...parsed, identity };
}

export async function runHermesSession({ variant, recipe, workspace, privateDir, executable = "hermes", env = {}, onPlan, setup = null, proxy = null } = {}) {
  if (!Array.isArray(recipe?.turns) || recipe.turns.length === 0) throw new TypeError("recipe.turns must be a non-empty array");
  const cwd = absolutePath(workspace, "workspace");
  const root = absolutePath(privateDir, "privateDir");
  await mkdir(root, { recursive: true });
  const hermesHome = hermesHomeFor({ variant, attemptDir: attemptDirFor(cwd) });
  // The prepared snapshot names its MCP toolsets; everything else runs file and terminal only.
  const toolsets = setup?.toolsets ?? HERMES_TOOLSETS;
  const runtime = await resolveHermesRuntime({ variant, executable, env });
  let threadId = null;
  const knownSessions = [];
  let observedModel = null;
  const turns = [];
  let failure = null;
  let cliVersion = null;
  try {
    // The login copy is written inside the try whose finally removes it with the rest of the home.
    if (hermesRoute(variant).auth === "borrowed-claude-code-login") await writeHermesLoginCopy({ hermesHome, env });
    cliVersion = await getHermesVersion({ executable: runtime, hermesHome, env, cwd, variant });
    for (const [index, turn] of recipe.turns.entries()) {
      const turnId = requiredString(turn?.id, `recipe.turns[${index}].id`);
      const content = requiredString(turn?.content, `recipe.turns[${index}].content`);
      const prompt = index === 0 ? `${requiredString(recipe.setup?.instructions, "recipe.setup.instructions")}\n\n${content}` : content;
      const turnDir = path.join(root, "turns", `${String(index + 1).padStart(3, "0")}-${turnId}`);
      const plan = {
        turnId, argv: [runtime, ...buildHermesTurnArgs({ variant, workspace: cwd, queryFile: path.join(turnDir, "query.txt"), threadId, toolsets })],
        eventsPath: path.join(turnDir, "stdout.jsonl"), stderrPath: path.join(turnDir, "stderr.txt"), finalPath: path.join(turnDir, "final.txt"), threadId,
      };
      if (onPlan) await onPlan(plan);
      try {
        const result = await runHermesTurn({ variant, workspace: cwd, artifactDir: turnDir, prompt, threadId, knownSessions, runtime, hermesHome, env, toolsets, proxy });
        threadId = result.threadId;
        knownSessions.push(...result.identity.sessions.map((session) => session.id).filter((id) => !knownSessions.includes(id)));
        observedModel = result.identity.usage.find((call) => call.task === "")?.model ?? null;
        turns.push({ turnId, argv: result.argv, eventsPath: result.paths.stdout, stderrPath: result.paths.stderr, finalPath: result.paths.finalMessage, events: result.events, finalMessage: result.finalMessage, usage: result.usage });
      } catch (error) {
        if (!(error instanceof HermesExecutionError)) throw error;
        turns.push({ turnId, argv: error.result?.argv ?? plan.argv, eventsPath: plan.eventsPath, stderrPath: plan.stderrPath, finalPath: plan.finalPath, events: [], finalMessage: null, usage: null });
        failure = { turnId, message: error.message, exitCode: error.result?.exitCode ?? null, signal: error.result?.signal ?? null };
        break;
      }
    }
  } finally {
    await cleanupHermesHome(hermesHome);
  }
  return { threadId, cliVersion, observedModel, turns, failure };
}

/**
 * Prepare one attempt: a fresh home holding only Kitchen's config (clean), or
 * the profile copy and its digest (snapshot). Reads the profile; writes only
 * inside the attempt.
 */
export async function prepareHermesAttempt({ variant, cwd, env = {} } = {}) {
  // The cook directory: the workspace's parent, outside any git tree.
  const attemptDir = absolutePath(cwd, "attempt directory");
  if (hermesRoute(variant).auth === KEY_PROXY_AUTH) requireOpenRouterKey(env, "Hermes");
  else {
    const credentials = hermesLoginSource(env);
    if (!(await stat(credentials).catch(() => null))?.isFile()) {
      throw new Error(`Hermes route borrows the Claude Code login, but ${credentials} is absent; log in to Claude Code before cooking`);
    }
    // Fail before any copy if the token would expire within the run window.
    await readClaudeLogin({ env, source: credentials });
  }
  const home = hermesHomeFor({ variant, attemptDir });
  await mkdir(home, { recursive: false, mode: 0o700 });
  if (hermesEnvironment(variant) === "clean") {
    await writeFile(path.join(home, "config.yaml"), cleanHermesConfig(variant), { encoding: "utf8", mode: 0o600 });
    return { setup: null };
  }
  const { files, toolsets } = await collectHermesSnapshot({ variant, env });
  await writeSetupFiles(home, files);
  return { setup: setupRecord(variant, files, { toolsets }) };
}

export function hermesRequestedExecution(variant) {
  const snapshot = hermesEnvironment(variant) === "snapshot";
  return {
    hermesHome: "fresh-per-attempt",
    ...(snapshot ? { setup: `per-attempt copy of profile ${variant.executionProfile.harnessProfile}: SOUL.md, skills, allowlisted config${toggleOn(variant, "memory") ? ", memories" : ""}${toggleOn(variant, "connections") ? ", MCP servers, plugins" : ""}` } : {}),
    providerRoute: hermesRoute(variant).provider,
    providerAuth: hermesRoute(variant).auth,
    ...(variant.executionProfile.upstream !== undefined ? { upstreamPin: variant.executionProfile.upstream } : {}),
    rules: snapshot ? "profile-copy" : "ignored",
    memory: snapshot && toggleOn(variant, "memory") ? "copied, writes discarded" : "off",
    toolsets: snapshot && toggleOn(variant, "connections") ? `${HERMES_TOOLSETS} plus copied MCP servers` : HERMES_TOOLSETS,
  };
}

export function reconstructHermesTurn(eventsText) {
  return parseHermesJsonl(eventsText);
}

function assertSingleFlag(argv, flag, expected) {
  const values = [];
  for (let index = 0; index < argv.length; index += 1) if (argv[index] === flag) values.push(argv[index + 1]);
  if (values.length !== 1 || values[0] !== expected) throw new Error(`Hermes argv must contain exactly one ${flag} ${expected}`);
}

/** File and terminal always; MCP toolsets only for a snapshot with connections on. */
function assertHermesToolsets(toolsets, variant) {
  const [first, second, ...rest] = String(toolsets).split(",");
  const connections = hermesEnvironment(variant) === "snapshot" && toggleOn(variant, "connections");
  if (`${first},${second}` !== HERMES_TOOLSETS || rest.some((name) => !connections || !/^mcp-[A-Za-z0-9_.-]+$/u.test(name))) {
    throw new Error(`Hermes toolsets must be ${HERMES_TOOLSETS}${connections ? " plus MCP toolsets" : ""}, not ${toolsets}`);
  }
}

export function assertHermesInvocation(argv, variant) {
  if (!Array.isArray(argv)) throw new Error("Hermes identity requires recorded argv for every turn");
  assertSingleFlag(argv, "-m", variant.model);
  assertSingleFlag(argv, "--provider", hermesRoute(variant).provider);
  assertSingleFlag(argv, "--reasoning", variant.reasoningEffort);
  const toolsets = argv.filter((_, index) => argv[index - 1] === "-t");
  if (toolsets.length !== 1) throw new Error("Hermes argv must contain exactly one -t selector");
  assertHermesToolsets(toolsets[0], variant);
  if (argv.includes("--model") || argv.includes("--toolsets")) throw new Error("Hermes argv contains an unpinned model or toolset selector");
  // Kitchen never runs a Hermes profile in place: a snapshot is a copied home, not -p.
  if (argv.includes("-p") || argv.includes("--profile")) throw new Error("Hermes argv must not select a profile");
  const clean = hermesEnvironment(variant) === "clean";
  if (argv.includes("--ignore-rules") !== clean) throw new Error(`Hermes argv ${clean ? "must" : "must not"} ignore rules for the ${hermesEnvironment(variant)} environment`);
}

/**
 * Verify every turn against its stream and Hermes's own route record. The
 * record is the harness's account of where it sent each call (as Codex's rollout
 * is); Anthropic does not echo a served model through Hermes's direct route.
 */
export async function verifyHermesIdentity({ codexHome, variant, cliVersion, result }) {
  if (result?.failure) throw new Error("Hermes execution contains a failed turn");
  if (!SESSION_PATTERN.test(result?.threadId ?? "")) throw new Error("Hermes identity requires a valid result session id");
  if (!Array.isArray(result.turns) || result.turns.length === 0) throw new Error("Hermes identity requires observed evidence for every turn");
  const sessionIds = [];
  let previous = null;
  for (const turn of result.turns) {
    const evidence = hermesTurnEvidence(turn.events ?? [], { resumedFrom: previous });
    if (turn.finalMessage !== evidence.result.text) throw new Error("Hermes final message does not match stream evidence");
    assertHermesInvocation(turn.argv, variant);
    sessionIds.push(evidence.init.session_id, evidence.result.session_id);
    previous = evidence.result.session_id;
  }
  if (previous !== result.threadId) throw new Error("Hermes result session does not match the last turn");
  if (result.cliVersion !== cliVersion) throw new Error(`Hermes CLI evidence mismatch: ${cliVersion} versus ${result.cliVersion}`);
  // The runner names an attempt-local codex-home path; its parent is the attempt directory.
  const hermesHome = hermesHomeFor({ variant, attemptDir: path.dirname(absolutePath(codexHome, "codexHome")) });
  const identity = await readHermesIdentity(path.join(hermesHome, "state.db"), sessionIds);
  const mismatches = hermesIdentityMismatches(identity, variant);
  if (mismatches.length) throw new Error(`Effective Hermes identity mismatch: ${mismatches.join("; ")}`);
  const route = hermesRoute(variant);
  const auxiliary = identity.usage.filter((call) => call.task !== "");
  return {
    model: variant.model,
    provider: variant.provider,
    route: route.provider,
    endpoint: route.baseUrl,
    reasoningEffort: variant.reasoningEffort,
    reasoningEffortEvidence: "hermes-session-model-config",
    personality: variant.personality,
    serviceTier: variant.serviceTier,
    requestedServiceTier: variant.serviceTier,
    serviceTierEvidence: "requested-default",
    environment: hermesEnvironment(variant),
    ...(variant.executionProfile.harnessProfile ? { harnessProfile: variant.executionProfile.harnessProfile } : {}),
    sessions: [...new Set(sessionIds)],
    mainLoopCalls: identity.usage.filter((call) => call.task === "").reduce((sum, call) => sum + call.apiCalls, 0),
    // Auxiliary calls (titles, compression) are disclosed, not attributed to the tasted model.
    auxiliaryCalls: auxiliary.map(({ task, model, billingProvider, apiCalls }) => ({ task, model, provider: billingProvider, apiCalls })),
    verifiedBy: "hermes-state-db-session-model-usage",
  };
}
