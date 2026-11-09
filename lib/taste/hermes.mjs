import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { isPersonalEnvironment } from "./harness-adapters.mjs";
import { OPENROUTER_BASE_URL, OPENROUTER_KEY_ENV, OPENROUTER_ROUTE, requireOpenRouterKey } from "./openrouter.mjs";

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
 * The clean environment uses a fresh Hermes home per attempt holding only a
 * Kitchen-written config.yaml. On the Anthropic route Hermes borrows the
 * existing Claude Code login from ~/.claude/.credentials.json and its copy is
 * deleted after the session. On the OpenRouter route the key reaches Hermes
 * only through its process environment, which Hermes withholds from the
 * model's terminal. The personal environment runs as a named Hermes profile (`-p <name>`).
 */

export const HERMES_TOOLSETS = "file,terminal";
export const HERMES_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"];
export const HERMES_MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1"];
export const PERSONAL_WRITES_ENV = "TASTE_ALLOW_HERMES_PROFILE_WRITES";

// The inference route is part of what is tasted, so it lives in the execution profile id.
const ROUTES = {
  "hermes-linux-host-clean-anthropic-v1": { provider: "anthropic", baseUrl: "https://api.anthropic.com", auth: "borrowed-claude-code-login" },
  "hermes-linux-host-personal-anthropic-v1": { provider: "anthropic", baseUrl: "https://api.anthropic.com", auth: "profile-credentials" },
  "hermes-linux-host-clean-openrouter-v1": { provider: OPENROUTER_ROUTE, baseUrl: OPENROUTER_BASE_URL, auth: "env-api-key" },
};

const SESSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{5,127}$/u;
// Inherited variables that could redirect Hermes to another home or another credential.
const SCRUBBED_ENV = /^(HERMES_|ANTHROPIC_|CLAUDE_CODE_OAUTH|OPENROUTER_|OPENAI_)/u;

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
  if (environment !== "clean" && environment !== "personal") throw new Error(`Hermes execution profile must declare the clean or personal environment (got ${environment})`);
  return isPersonalEnvironment(variant) ? "personal" : "clean";
}

export function hermesRoot(env = {}) {
  return env.TASTE_HERMES_ROOT ?? process.env.TASTE_HERMES_ROOT ?? path.join(os.homedir(), ".hermes");
}

function claudeConfigDir(env = {}) {
  return env.CLAUDE_CONFIG_DIR ?? process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude");
}

/** The Hermes home whose state.db holds this run's sessions. */
export function hermesHomeFor({ variant, attemptDir, env = {} }) {
  if (hermesEnvironment(variant) === "clean") return path.join(absolutePath(attemptDir, "attemptDir"), "hermes-home");
  const profile = requiredString(variant.executionProfile.harnessProfile, "executionProfile.harnessProfile");
  return profile === "default" ? hermesRoot(env) : path.join(hermesRoot(env), "profiles", profile);
}

export function hermesProcessEnv({ variant, hermesHome, env = {} }) {
  // The scrub covers the caller's env too: passing process.env must not bring a key or a Hermes home back.
  const unscrubbed = (source) => Object.fromEntries(Object.entries(source).filter(([key]) => !SCRUBBED_ENV.test(key)));
  const inherited = unscrubbed(process.env);
  // A fresh home outside ~/.hermes would otherwise try to build its own dependency environment.
  const clean = hermesEnvironment(variant) === "clean" ? { HERMES_HOME: hermesHome, HERMES_DISABLE_LAZY_INSTALLS: "1" } : {};
  // The one credential a route asks for is put back deliberately, after the scrub.
  const key = hermesRoute(variant).auth === "env-api-key" ? { [OPENROUTER_KEY_ENV]: requireOpenRouterKey(env, "Hermes") } : {};
  return { ...inherited, ...unscrubbed(env), ...clean, ...key };
}

/** Minimal config for the clean home: the route and model only. No fallbacks, secrets, plugins, or MCP servers. */
export function cleanHermesConfig(variant) {
  const route = hermesRoute(variant);
  return [
    "# Written by Tasting Kitchen for one clean attempt.",
    "model:",
    `  provider: ${route.provider}`,
    `  default: ${variant.model}`,
    // Only the borrowed-login route adopts an external login; an API-key route must not find one.
    "auth:",
    `  adopt_external_logins: ${route.auth === "borrowed-claude-code-login"}`,
    "",
  ].join("\n");
}

export function buildHermesTurnArgs({ variant, workspace, queryFile, threadId } = {}) {
  if (!variant || variant.harness !== "hermes") throw new Error("Hermes adapter requires a hermes configuration");
  const route = hermesRoute(variant);
  const model = requiredString(variant.model, "variant.model");
  const effort = requiredString(variant.reasoningEffort, "variant.reasoningEffort");
  if (!HERMES_EFFORTS.includes(effort)) throw new Error(`Hermes reasoning effort must be one of ${HERMES_EFFORTS.join(", ")}`);
  const args = [];
  if (hermesEnvironment(variant) === "personal") args.push("-p", requiredString(variant.executionProfile.harnessProfile, "executionProfile.harnessProfile"));
  // The prompt travels in a file: nothing is shell-interpreted and argv stays small.
  args.push("chat", "--query-file", absolutePath(queryFile, "queryFile"), "--oneshot", "--format", "stream-json",
    "--provider", route.provider, "-m", model, "--reasoning", effort, "-t", HERMES_TOOLSETS,
    "--yolo", "--source", "tool", "--in", absolutePath(workspace, "workspace"));
  // Clean skips AGENTS.md, SOUL.md, memory and preloaded skills; personal keeps the profile's.
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
    const child = spawn(executable, args, { cwd: options.cwd, env: options.env, shell: false, stdio: ["ignore", "pipe", "pipe"] });
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

export async function getHermesVersion({ executable = "hermes", variant, hermesHome, env = {}, cwd } = {}) {
  // A clean run's version query gets the same isolated home and scrubbed credentials as the run itself.
  const processEnv = variant
    ? hermesProcessEnv({ variant, hermesHome, env })
    : Object.fromEntries(Object.entries({ ...process.env, ...env }).filter(([key]) => !SCRUBBED_ENV.test(key)));
  const result = await collectProcess(requiredString(executable, "executable"), ["--version"], { cwd: cwd ? absolutePath(cwd, "cwd") : process.cwd(), env: processEnv });
  if (result.spawnError) throw new HermesExecutionError(`Could not start Hermes: ${result.spawnError.message}`, result, { cause: result.spawnError });
  if (result.exitCode !== 0) throw new HermesExecutionError(`hermes --version exited with code ${result.exitCode}`, result);
  const version = result.stdout.split(/\r?\n/u).map((line) => line.trim()).find(Boolean);
  if (!version) throw new HermesExecutionError("hermes --version returned an empty version", result);
  return version;
}

/**
 * The binary that runs a clean attempt. The `hermes` launcher scopes its
 * dependency environment to the active home and would try to build a new one
 * for a fresh home, so clean runs use the committed environment's own entry
 * point directly. An explicit executable (tests, a pinned install) is kept.
 */
export async function resolveHermesRuntime({ variant, executable = "hermes", env = {} }) {
  if (executable !== "hermes" || hermesEnvironment(variant) === "personal") return executable;
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

/** Compare recorded routes against the request. Returns mismatch strings; empty means verified. */
export function hermesIdentityMismatches(identity, variant) {
  const route = hermesRoute(variant);
  const mismatches = [];
  const main = identity.usage.filter((call) => call.task === "");
  if (main.length === 0) mismatches.push("no main-loop API call was recorded");
  for (const call of main) {
    if (call.model !== variant.model) mismatches.push(`model requested ${variant.model}, observed ${call.model}`);
    if (call.billingProvider !== route.provider) mismatches.push(`provider route requested ${route.provider}, observed ${call.billingProvider || "none"}`);
    if (call.billingBaseUrl !== route.baseUrl) mismatches.push(`endpoint requested ${route.baseUrl}, observed ${call.billingBaseUrl || "none"}`);
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

async function removeBorrowedCredentials(variant, hermesHome) {
  // Hermes copies the borrowed Claude Code login into its own pool. A clean home
  // is throwaway, so the copy must not outlive the session.
  if (hermesEnvironment(variant) !== "clean") return;
  await Promise.all(["auth.json", "auth.lock"].map((name) => rm(path.join(hermesHome, name), { force: true })));
}

function mainLoopCalls(identity) {
  return identity.usage.filter((call) => call.task === "").reduce((total, call) => total + call.apiCalls, 0);
}

async function runHermesTurn({ variant, workspace, artifactDir, prompt, threadId, knownSessions, runtime, hermesHome, env }) {
  await mkdir(artifactDir, { recursive: true });
  const paths = {
    query: path.join(artifactDir, "query.txt"), stdout: path.join(artifactDir, "stdout.jsonl"), stderr: path.join(artifactDir, "stderr.txt"),
    finalMessage: path.join(artifactDir, "final.txt"), identity: path.join(artifactDir, "identity.json"),
  };
  await writeFile(paths.query, prompt, "utf8");
  const args = buildHermesTurnArgs({ variant, workspace, queryFile: paths.query, threadId });
  const stateDb = path.join(hermesHome, "state.db");
  // A hook can end a resumed turn before inference and still return success, so the earlier
  // turns' calls must not satisfy this turn: it needs a main-loop call of its own, counted
  // across every session so far, which also covers a compression child.
  const before = knownSessions.length ? mainLoopCalls(await readHermesIdentity(stateDb, knownSessions)) : 0;
  const result = await collectProcess(runtime, args, { cwd: workspace, env: hermesProcessEnv({ variant, hermesHome, env }) });
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

export async function runHermesSession({ variant, recipe, workspace, privateDir, executable = "hermes", env = {}, onPlan } = {}) {
  if (!Array.isArray(recipe?.turns) || recipe.turns.length === 0) throw new TypeError("recipe.turns must be a non-empty array");
  const cwd = absolutePath(workspace, "workspace");
  const root = absolutePath(privateDir, "privateDir");
  await mkdir(root, { recursive: true });
  const hermesHome = hermesHomeFor({ variant, attemptDir: attemptDirFor(cwd), env });
  const runtime = await resolveHermesRuntime({ variant, executable, env });
  const cliVersion = await getHermesVersion({ executable: runtime, variant, hermesHome, env, cwd });
  let threadId = null;
  const knownSessions = [];
  let observedModel = null;
  const turns = [];
  let failure = null;
  try {
    for (const [index, turn] of recipe.turns.entries()) {
      const turnId = requiredString(turn?.id, `recipe.turns[${index}].id`);
      const content = requiredString(turn?.content, `recipe.turns[${index}].content`);
      const prompt = index === 0 ? `${requiredString(recipe.setup?.instructions, "recipe.setup.instructions")}\n\n${content}` : content;
      const turnDir = path.join(root, "turns", `${String(index + 1).padStart(3, "0")}-${turnId}`);
      const plan = {
        turnId, argv: [runtime, ...buildHermesTurnArgs({ variant, workspace: cwd, queryFile: path.join(turnDir, "query.txt"), threadId })],
        eventsPath: path.join(turnDir, "stdout.jsonl"), stderrPath: path.join(turnDir, "stderr.txt"), finalPath: path.join(turnDir, "final.txt"), threadId,
      };
      if (onPlan) await onPlan(plan);
      try {
        const result = await runHermesTurn({ variant, workspace: cwd, artifactDir: turnDir, prompt, threadId, knownSessions, runtime, hermesHome, env });
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
    await removeBorrowedCredentials(variant, hermesHome);
  }
  return { threadId, cliVersion, observedModel, turns, failure };
}

/** Prepare one attempt. Nothing is copied from Burooj's Hermes setup into a clean home. */
export async function prepareHermesAttempt({ variant, cwd, env = {} } = {}) {
  const attemptDir = absolutePath(cwd, "attempt directory");
  // Hermes merges every AGENTS.md from the git root down to the working directory,
  // and attempts live inside the Kitchen checkout. A `.git` marker beside the
  // workspace makes the attempt its own root, so Kitchen's guidance never reaches
  // the model and its shell cannot browse Kitchen's history.
  await writeFile(path.join(attemptDir, ".git"), "", { flag: "wx" });
  if (hermesEnvironment(variant) === "clean") {
    if (hermesRoute(variant).auth === "env-api-key") requireOpenRouterKey(env, "Hermes");
    else {
      const credentials = path.join(claudeConfigDir(env), ".credentials.json");
      if (!(await stat(credentials).catch(() => null))?.isFile()) {
        throw new Error(`Hermes clean route borrows the Claude Code login, but ${credentials} is absent; log in to Claude Code before cooking`);
      }
    }
    const home = hermesHomeFor({ variant, attemptDir, env });
    await mkdir(home, { recursive: false });
    await writeFile(path.join(home, "config.yaml"), cleanHermesConfig(variant), { encoding: "utf8", mode: 0o600 });
    return;
  }
  const allowed = env[PERSONAL_WRITES_ENV] ?? process.env[PERSONAL_WRITES_ENV];
  if (allowed !== "1") {
    throw new Error(`Refusing a personal Hermes run: a -p ${variant.executionProfile.harnessProfile} session records itself in that profile's state.db and runs its plugin hooks. Set ${PERSONAL_WRITES_ENV}=1 after deciding that is acceptable`);
  }
  const home = hermesHomeFor({ variant, attemptDir, env });
  if (!(await stat(path.join(home, "config.yaml")).catch(() => null))?.isFile()) throw new Error(`Hermes profile ${variant.executionProfile.harnessProfile} does not exist at ${home}`);
}

export function hermesRequestedExecution(variant) {
  const personal = hermesEnvironment(variant) === "personal";
  return {
    hermesHome: personal ? `profile:${variant.executionProfile.harnessProfile}` : "fresh-per-attempt",
    providerRoute: hermesRoute(variant).provider,
    providerAuth: hermesRoute(variant).auth,
    rules: personal ? "profile" : "ignored",
    toolsets: HERMES_TOOLSETS,
    gitBoundary: "attempt-directory",
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

export function assertHermesInvocation(argv, variant) {
  if (!Array.isArray(argv)) throw new Error("Hermes identity requires recorded argv for every turn");
  assertSingleFlag(argv, "-m", variant.model);
  assertSingleFlag(argv, "--provider", hermesRoute(variant).provider);
  assertSingleFlag(argv, "--reasoning", variant.reasoningEffort);
  assertSingleFlag(argv, "-t", HERMES_TOOLSETS);
  if (argv.includes("--model") || argv.includes("--toolsets")) throw new Error("Hermes argv contains an unpinned model or toolset selector");
  const personal = hermesEnvironment(variant) === "personal";
  if (personal) assertSingleFlag(argv, "-p", variant.executionProfile.harnessProfile);
  else if (argv.includes("-p") || argv.includes("--profile")) throw new Error("Clean Hermes argv must not select a profile");
  if (argv.includes("--ignore-rules") === personal) throw new Error(`Hermes argv ${personal ? "must not" : "must"} ignore rules for the ${hermesEnvironment(variant)} environment`);
}

/**
 * Verify every turn against its stream and Hermes's own route record. The
 * record is the harness's account of where it sent each call (as Codex's rollout
 * is); Anthropic does not echo a served model through Hermes's direct route.
 */
export async function verifyHermesIdentity({ codexHome, variant, cliVersion, result, env = {} }) {
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
  const hermesHome = hermesHomeFor({ variant, attemptDir: path.dirname(absolutePath(codexHome, "codexHome")), env });
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
