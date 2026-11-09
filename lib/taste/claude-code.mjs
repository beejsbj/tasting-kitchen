import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { canonicalJson } from "./hash.mjs";
import { NETWORK_ENV, harnessEnv } from "./child-env.mjs";
import { DETACHED_CHILD, trackChild } from "./interrupt.mjs";
import { collectSetupChildren, collectSetupDirectory, collectSetupFile, createSetupBudget, setupDigest, setupRecord, setupText, toggleOn, writeSetupFiles } from "./environments.mjs";
import { ensurePrivateDirectory } from "./files.mjs";
import { serviceTiersMatch } from "./identity.mjs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** File and shell tools only: no web, MCP, subagents, or scheduling tools. */
export const CLAUDE_CODE_TOOLS = ["Bash", "Edit", "Glob", "Grep", "Read", "Write"];
/** A personal setup also needs the Skill tool, which is how his skills load. */
export const CLAUDE_CODE_PERSONAL_TOOLS = [...CLAUDE_CODE_TOOLS, "Skill"];
export const CLAUDE_CODE_EFFORTS = ["low", "medium", "high", "xhigh", "max"];
/** Directories of ~/.claude a snapshot copies, each child (a skill, an agent) on its own terms. */
export const CLAUDE_CODE_SNAPSHOT_DIRECTORIES = ["skills", "agents", "commands", "output-styles"];
/**
 * User settings a snapshot keeps. Everything else in settings.json is either
 * pinned by the configuration (model, effort, permissions), set by Kitchen for
 * the run (hooks, memory, connectors), or about his terminal (notifications,
 * update channel), so it is left behind. Plugin choices travel only with connections.
 */
export const CLAUDE_CODE_SNAPSHOT_SETTINGS = ["language", "alwaysThinkingEnabled", "includeCoAuthoredBy", "attribution"];
const CONNECTION_SETTINGS = ["enabledPlugins", "extraKnownMarketplaces"];
/** Plugin installation state a snapshot copies with connections on. Marketplace clones are left behind. */
const PLUGIN_ENTRIES = ["installed_plugins.json", "known_marketplaces.json", "cache"];
const EMPTY_MCP = JSON.stringify({ mcpServers: {} });
// The access token is handed to the child on this descriptor, never in argv,
// the environment, or a file inside the attempt home.
const TOKEN_FD = 3;
const DEFAULT_TOKEN_MARGIN_MS = 30 * 60 * 1000;

function requiredString(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} must be a non-empty string`);
  return value;
}

function absolutePath(value, name) {
  requiredString(value, name);
  if (!path.isAbsolute(value)) throw new TypeError(`${name} must be an absolute path`);
  return path.normalize(value);
}

function environmentOf(variant) {
  const environment = variant?.executionProfile?.environment;
  if (!["clean", "snapshot", "live"].includes(environment)) throw new Error("Claude Code configuration must declare executionProfile.environment clean, snapshot or live");
  return environment;
}

const memoryOn = (variant) => environmentOf(variant) !== "clean" && toggleOn(variant, "memory");
const connectionsOn = (variant) => environmentOf(variant) !== "clean" && toggleOn(variant, "connections");

export function claudePersonalSource(env = {}) {
  return path.resolve(env.TASTE_CLAUDE_PERSONAL_HOME ?? process.env.TASTE_CLAUDE_PERSONAL_HOME ?? path.join(os.homedir(), ".claude"));
}

/** The global config holding his user-scoped MCP servers: ~/.claude.json beside, not inside, ~/.claude. */
export function claudeGlobalConfigPath(env = {}) {
  return path.resolve(env.TASTE_CLAUDE_GLOBAL_CONFIG ?? process.env.TASTE_CLAUDE_GLOBAL_CONFIG ?? path.join(os.homedir(), ".claude.json"));
}

/**
 * The memory a personal run sees. Claude Code keys auto-memory by project, and
 * an attempt workspace is a fresh project with none, so both snapshot and live
 * use the memory he builds from his home directory.
 */
export function claudeMemorySource(env = {}) {
  const override = env.TASTE_CLAUDE_MEMORY_SOURCE ?? process.env.TASTE_CLAUDE_MEMORY_SOURCE;
  if (override) return path.resolve(override);
  return path.join(claudePersonalSource(env), "projects", os.homedir().replace(/[^A-Za-z0-9]/gu, "-"), "memory");
}

/** The memory directory a run points auto-memory at: the copy for a snapshot, the real one for live. */
function memoryDirectory(variant, harnessHome, env) {
  return environmentOf(variant) === "snapshot" ? path.join(absolutePath(harnessHome, "harnessHome"), "memory") : claudeMemorySource(env);
}

async function readJsonFile(file) {
  try { return JSON.parse(await readFile(file, "utf8")); }
  catch (error) {
    if (error?.code === "ENOENT") return null;
    throw new Error(`Cannot read ${path.basename(file)} as JSON`);
  }
}

/** Sorted-key JSON, so reordering his own file does not move the digest. */
function stableJson(value) {
  return `${JSON.stringify(JSON.parse(canonicalJson(value)), null, 2)}\n`;
}

function pick(object, keys) {
  return Object.fromEntries(keys.filter((key) => object?.[key] !== undefined).map((key) => [key, object[key]]));
}

/**
 * The deterministic copy of his Claude Code setup a snapshot attempt starts
 * from, as files relative to the attempt home. Never the credential file:
 * the login travels on a descriptor. Reads only.
 */
export async function collectClaudeSnapshot({ variant, env = {} } = {}) {
  const source = claudePersonalSource(env);
  const connections = connectionsOn(variant);
  const budget = createSetupBudget();
  const files = [...await collectSetupFile(path.join(source, "CLAUDE.md"), "CLAUDE.md", budget)];
  for (const directory of CLAUDE_CODE_SNAPSHOT_DIRECTORIES) files.push(...await collectSetupChildren(path.join(source, directory), directory, budget));
  const userSettings = await readJsonFile(path.join(source, "settings.json"));
  const settings = pick(userSettings, [...CLAUDE_CODE_SNAPSHOT_SETTINGS, ...(connections ? CONNECTION_SETTINGS : [])]);
  files.push(setupText("settings.json", stableJson(settings)));
  if (memoryOn(variant)) files.push(...await collectSetupDirectory(claudeMemorySource(env), "memory", budget));
  if (connections) {
    const mcpServers = (await readJsonFile(claudeGlobalConfigPath(env)))?.mcpServers ?? {};
    files.push(setupText("mcp.json", stableJson({ mcpServers })));
    for (const entry of PLUGIN_ENTRIES) {
      const entrySource = path.join(source, "plugins", entry);
      files.push(...entry === "cache" ? await collectSetupChildren(entrySource, "plugins/cache", budget) : await collectSetupFile(entrySource, `plugins/${entry}`, budget));
    }
  }
  return files;
}

/** Plugins his live settings enable, each switched off: flag settings merge per plugin, so `{}` would not. */
async function livePluginsOff(env) {
  const enabled = (await readJsonFile(path.join(claudePersonalSource(env), "settings.json")))?.enabledPlugins ?? {};
  return Object.fromEntries(Object.keys(enabled).sort().map((name) => [name, false]));
}

/** Settings layered over whatever setting sources the environment loads. */
export function claudeRunSettings(variant, { harnessHome, env = {}, pluginsOff = {} } = {}) {
  const environment = environmentOf(variant);
  const settings = {};
  if (environment === "clean") return { disableAllHooks: true, disableClaudeAiConnectors: true };
  // Hooks are scripts that can write anywhere, so a snapshot runs none; live keeps his.
  if (environment === "snapshot") Object.assign(settings, { disableAllHooks: true, autoDreamEnabled: false });
  if (memoryOn(variant)) settings.autoMemoryDirectory = memoryDirectory(variant, harnessHome, env);
  else settings.autoMemoryEnabled = false;
  if (!connectionsOn(variant)) {
    settings.disableClaudeAiConnectors = true;
    if (environment === "live" && Object.keys(pluginsOff).length) settings.enabledPlugins = pluginsOff;
  }
  return settings;
}

export function buildClaudeTurnArgs({ variant, workspace, harnessHome, prompt, threadId, env = {}, pluginsOff = {} } = {}) {
  if (!variant || variant.harness !== "claude-code") throw new Error("Claude Code adapter requires a claude-code configuration");
  if (variant.executionProfile?.approvalPolicy !== "bypass-permissions") throw new Error("Claude Code execution profile must declare bypass-permissions approval");
  const environment = environmentOf(variant);
  if (!CLAUDE_CODE_EFFORTS.includes(variant.reasoningEffort)) throw new Error(`Claude Code effort must be one of ${CLAUDE_CODE_EFFORTS.join(", ")}`);
  absolutePath(workspace, "workspace");
  const args = [
    "-p", "--output-format", "stream-json", "--verbose",
    "--model", requiredString(variant.model, "variant.model"),
    "--effort", variant.reasoningEffort,
  ];
  // Clean: safe mode drops CLAUDE.md, skills, plugins, hooks, MCP, commands,
  // agents and output styles, and no settings file is read. Snapshot and live:
  // only the user settings source, which is the copied home or the real one.
  if (environment === "clean") args.push("--safe-mode", "--setting-sources", "");
  else args.push("--setting-sources", "user");
  args.push("--settings", JSON.stringify(claudeRunSettings(variant, { harnessHome, env, pluginsOff })));
  // Connections off: no MCP server from anywhere. On: a snapshot loads the copied
  // user servers; live loads whatever his real config holds.
  if (!connectionsOn(variant)) args.push("--strict-mcp-config", "--mcp-config", EMPTY_MCP);
  else if (environment === "snapshot") args.push("--mcp-config", path.join(absolutePath(harnessHome, "harnessHome"), "mcp.json"));
  if (threadId !== undefined && threadId !== null) {
    if (!UUID_PATTERN.test(threadId)) throw new TypeError("threadId must be an exact UUID");
    args.push("--resume", threadId);
  }
  args.push("--tools", claudeTools(variant).join(","), "--permission-mode", "bypassPermissions", "--", requiredString(prompt, "prompt"));
  return args;
}

export function claudeTools(variant) {
  return environmentOf(variant) === "clean" ? CLAUDE_CODE_TOOLS : CLAUDE_CODE_PERSONAL_TOOLS;
}

/**
 * Clean and snapshot children get an allowlisted environment (child-env.mjs):
 * no provider key, GitHub token or agent socket reaches a run whose skills may
 * tell the model to use them. Live runs as he runs claude, so it keeps his
 * environment and drops only inherited Claude or Anthropic variables (a parent
 * Claude Code session sets several, including its effort). Clean and snapshot
 * run from the per-attempt home; live from his real one.
 */
export function claudeChildEnv({ variant, harnessHome, env = {}, base = process.env } = {}) {
  const environment = environmentOf(variant);
  const set = { CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR: String(TOKEN_FD), DISABLE_AUTOUPDATER: "1" };
  let child;
  if (environment === "live") {
    const inherited = (key) => !/^(?:CLAUDE|ANTHROPIC|TASTE_CLAUDE_)/u.test(key) && key !== "CLAUDECODE";
    child = { ...Object.fromEntries([...Object.entries(base), ...Object.entries(env)].filter(([key]) => inherited(key))), ...set };
    // Live leaves CLAUDE_CONFIG_DIR unset, exactly as he runs claude, unless a test points it elsewhere.
    if (env.TASTE_CLAUDE_PERSONAL_HOME ?? process.env.TASTE_CLAUDE_PERSONAL_HOME) child.CLAUDE_CONFIG_DIR = claudePersonalSource(env);
  } else {
    child = harnessEnv({ env, base, allow: NETWORK_ENV, set: { ...set, CLAUDE_CONFIG_DIR: absolutePath(harnessHome, "harnessHome") } });
  }
  if (environment === "clean") Object.assign(child, { CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1", CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1" });
  if (environment !== "clean" && !memoryOn(variant)) child.CLAUDE_CODE_DISABLE_AUTO_MEMORY = "1";
  if (!connectionsOn(variant)) child.ENABLE_CLAUDEAI_MCP_SERVERS = "false";
  return child;
}

export function claudeCredentialsPath(env = {}) {
  return path.resolve(env.TASTE_CLAUDE_CREDENTIALS_PATH ?? process.env.TASTE_CLAUDE_CREDENTIALS_PATH ?? path.join(os.homedir(), ".claude", ".credentials.json"));
}

/**
 * Read the existing claude.ai OAuth login: its access token, expiry and scopes,
 * never the refresh token. Errors never quote the file. The token must outlive
 * the run: with no refresh token the child cannot renew it, which is what keeps
 * it from rotating the login Burooj's own sessions use. `source` defaults to
 * Claude Code's own credentials file.
 */
export async function readClaudeLogin({ env = {}, now = Date.now(), marginMs, source = claudeCredentialsPath(env) } = {}) {
  const rawMargin = marginMs ?? env.TASTE_CLAUDE_TOKEN_MARGIN_MS ?? process.env.TASTE_CLAUDE_TOKEN_MARGIN_MS ?? DEFAULT_TOKEN_MARGIN_MS;
  const margin = typeof rawMargin === "string" && rawMargin.trim() === "" ? Number.NaN : Number(rawMargin);
  if (!Number.isFinite(margin) || margin < 0) throw new Error("Claude Code token margin must be a non-negative number of milliseconds");
  let parsed;
  try { parsed = JSON.parse(await readFile(source, "utf8")); }
  catch { throw new Error(`Claude Code credentials are unavailable or unreadable: ${source}`); }
  const oauth = parsed?.claudeAiOauth;
  if (typeof oauth?.accessToken !== "string" || oauth.accessToken.length < 16) throw new Error("Claude Code credentials lack a claude.ai OAuth access token; log in with claude first");
  if (!Number.isFinite(oauth.expiresAt)) throw new Error("Claude Code credentials lack a valid OAuth expiry; log in with claude first");
  if (oauth.expiresAt - now < margin) {
    throw new Error(`Claude Code access token expires within ${Math.round(margin / 60000)} minutes; run any claude command to refresh the login, then cook`);
  }
  return { accessToken: oauth.accessToken, expiresAt: oauth.expiresAt, ...(Array.isArray(oauth.scopes) ? { scopes: oauth.scopes.filter((scope) => typeof scope === "string") } : {}) };
}

/** The access token alone. */
export async function readClaudeAccessToken(options = {}) {
  return (await readClaudeLogin(options)).accessToken;
}

/** The setup digest a snapshot attempt would record now: lets fill-missing see a changed setup. Reads only. */
export async function currentClaudeSetupDigest({ variant, env = {} } = {}) {
  if (environmentOf(variant) !== "snapshot") return null;
  return setupDigest(await collectClaudeSnapshot({ variant, env }));
}

/**
 * Prepare one attempt. Clean and snapshot get an empty, private home; a
 * snapshot home then receives the copy and its digest. Live touches nothing:
 * its record notes the digest of his setup as it stood at the start, for the
 * receipt only, since live writes may change it.
 */
export async function prepareClaudeAttempt({ variant, harnessHome, env = {} } = {}) {
  const environment = environmentOf(variant);
  await readClaudeAccessToken({ env });
  if (environment === "live") {
    const files = await collectClaudeSnapshot({ variant, env });
    const record = setupRecord(variant, files);
    return { setup: { environment, memory: record.memory, connections: record.connections, home: "real", digestAtStart: record.digest } };
  }
  const home = absolutePath(harnessHome, "harnessHome");
  await ensurePrivateDirectory(home);
  if ((await readdir(home)).length !== 0) throw new Error("Fresh attempt Claude Code home must start empty");
  if (environment === "clean") return { setup: null };
  const files = await collectClaudeSnapshot({ variant, env });
  await writeSetupFiles(home, files);
  return { setup: setupRecord(variant, files) };
}

/** A snapshot home is discarded after the attempt: the digest says what it held. Clean homes stay for inspection; live has none. */
export async function cleanupClaudeAttempt({ variant, harnessHome }) {
  if (environmentOf(variant) === "snapshot" && harnessHome) await rm(absolutePath(harnessHome, "harnessHome"), { recursive: true, force: true });
}

export function claudeRequestedExecution(variant) {
  const environment = environmentOf(variant);
  const setup = {
    clean: "none (safe mode)",
    snapshot: `per-attempt copy of ~/.claude: CLAUDE.md, ${CLAUDE_CODE_SNAPSHOT_DIRECTORIES.join(", ")}, chosen settings${memoryOn(variant) ? ", memory" : ""}${connectionsOn(variant) ? ", MCP servers, plugins" : ""}`,
    live: "real ~/.claude, writes included",
  }[environment];
  return {
    claudeConfigDir: environment === "live" ? "real-home" : "fresh-per-attempt",
    providerAuth: "existing-oauth-access-token-on-fd",
    setup,
    tools: claudeTools(variant).join(","),
    mcpServers: connectionsOn(variant) ? (environment === "live" ? "his live servers" : "copied user servers and claude.ai connectors") : "none",
    hooks: environment === "live" ? "as configured" : "disabled",
    memory: memoryOn(variant) ? (environment === "live" ? "real home memory, writes kept" : "copied home memory, writes discarded") : "off",
  };
}

function collectProcess(executable, args, { cwd, env, token }) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const stdio = ["ignore", "pipe", "pipe"];
    if (token !== undefined) stdio.push("pipe");
    const child = trackChild(spawn(executable, args, { cwd, env, shell: false, stdio, ...DETACHED_CHILD }));
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    if (token !== undefined) {
      // A child that never reads the descriptor must not crash the runner.
      child.stdio[TOKEN_FD].on("error", () => {});
      child.stdio[TOKEN_FD].end(token);
    }
    child.on("error", (error) => {
      if (!settled) { settled = true; resolve({ exitCode: null, signal: null, stdout, stderr, spawnError: error }); }
    });
    child.on("close", (exitCode, signal) => {
      if (!settled) { settled = true; resolve({ exitCode, signal, stdout, stderr, spawnError: null }); }
    });
  });
}

export class ClaudeCodeExecutionError extends Error {
  constructor(message, result, options) {
    super(message, options);
    this.name = "ClaudeCodeExecutionError";
    this.result = result;
  }
}

/** Main-thread assistant messages; subagent messages carry a parent tool use id. */
function mainAssistantModels(events) {
  return events
    .filter((event) => event?.type === "assistant" && (event.parent_tool_use_id === null || event.parent_tool_use_id === undefined))
    .map((event) => event.message?.model ?? null);
}

export function claudeTurnEvidence(events, { threadId } = {}) {
  if (!Array.isArray(events)) throw new TypeError("Claude Code turn events must be an array");
  const results = events.filter((event) => event?.type === "result");
  const failure = results.find((event) => event.is_error === true || event.subtype !== "success");
  if (failure) throw new Error(`Claude Code reported failure: ${failure.result ?? failure.subtype ?? failure.type}`);
  const inits = events.filter((event) => event?.type === "system" && event?.subtype === "init");
  if (inits.length === 0 || !UUID_PATTERN.test(inits[0]?.session_id ?? "")) throw new Error("Claude Code init event did not contain a valid session UUID");
  if (inits.length !== 1) throw new Error(`Claude Code stream contained ${inits.length} init events; expected exactly one`);
  if (results.length !== 1) throw new Error(`Claude Code stream contained ${results.length} final result events; expected exactly one`);
  const [init] = inits;
  const [result] = results;
  if (events.indexOf(init) > events.indexOf(result)) throw new Error("Claude Code result appeared before its init event");
  if (typeof result.result !== "string") throw new Error("Claude Code succeeded without a final result message");
  if (result.session_id !== init.session_id) throw new Error("Claude Code result session did not match its init session");
  if (threadId !== undefined && (init.session_id !== threadId || result.session_id !== threadId)) throw new Error(`Claude Code turn session did not match result thread ${threadId}`);
  const assistantModels = mainAssistantModels(events);
  if (assistantModels.length === 0) throw new Error("Claude Code turn has no assistant message evidence");
  return { init, result, assistantModels, usageModels: Object.keys(result.modelUsage ?? {}) };
}

export function parseClaudeJsonl(stdout) {
  if (typeof stdout !== "string") throw new TypeError("stdout must be a string");
  const events = stdout.split(/\r?\n/u).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); }
    catch (error) { throw new Error(`Invalid Claude Code JSONL on line ${index + 1}: ${error.message}`); }
  });
  const { init, result } = claudeTurnEvidence(events);
  return {
    events,
    threadId: init.session_id,
    model: requiredString(init.model, "Claude Code observed model"),
    finalMessage: result.result,
    usage: result.usage ?? null,
  };
}

export async function getClaudeVersion({ executable = "claude", env = {}, cwd, variant, harnessHome } = {}) {
  const childEnv = harnessHome || environmentOf(variant) === "live" ? claudeChildEnv({ variant, harnessHome, env }) : harnessEnv({ env, allow: NETWORK_ENV });
  const result = await collectProcess(requiredString(executable, "executable"), ["--version"], { cwd: cwd ? absolutePath(cwd, "cwd") : process.cwd(), env: childEnv });
  if (result.spawnError) throw new ClaudeCodeExecutionError(`Could not start Claude Code: ${result.spawnError.message}`, result, { cause: result.spawnError });
  if (result.exitCode !== 0) throw new ClaudeCodeExecutionError(`claude --version exited with code ${result.exitCode}`, result);
  const version = result.stdout.trim().match(/^(\d+\.\d+\.\d+\S*)/u)?.[1];
  if (!version) throw new ClaudeCodeExecutionError("claude --version did not report a version", result);
  return `claude-code ${version}`;
}

async function runClaudeTurn({ variant, workspace, harnessHome, artifactDir, prompt, threadId, executable, env, pluginsOff }) {
  const args = buildClaudeTurnArgs({ variant, workspace, harnessHome, prompt, threadId, env, pluginsOff });
  const paths = { stdout: path.join(artifactDir, "stdout.jsonl"), stderr: path.join(artifactDir, "stderr.txt"), finalMessage: path.join(artifactDir, "final.txt") };
  await mkdir(artifactDir, { recursive: true });
  const partial = { paths, argv: [executable, ...args] };
  let token;
  try { token = await readClaudeAccessToken({ env, marginMs: 0 }); }
  catch (error) { throw new ClaudeCodeExecutionError(error.message, partial, { cause: error }); }
  const result = await collectProcess(executable, args, { cwd: workspace, env: claudeChildEnv({ variant, harnessHome, env }), token });
  await Promise.all([writeFile(paths.stdout, result.stdout, "utf8"), writeFile(paths.stderr, result.stderr, "utf8")]);
  Object.assign(partial, result);
  if (result.spawnError) throw new ClaudeCodeExecutionError(`Could not start Claude Code: ${result.spawnError.message}`, partial, { cause: result.spawnError });
  if (result.exitCode !== 0) throw new ClaudeCodeExecutionError(`Claude Code exited with code ${result.exitCode}${result.signal ? ` (${result.signal})` : ""}`, partial);
  let parsed;
  try { parsed = parseClaudeJsonl(result.stdout); }
  catch (error) { throw new ClaudeCodeExecutionError(error.message, partial, { cause: error }); }
  if (threadId && parsed.threadId !== threadId) throw new ClaudeCodeExecutionError(`Resumed session ${threadId}, but Claude Code reported ${parsed.threadId}`, { ...partial, ...parsed });
  await writeFile(paths.finalMessage, parsed.finalMessage, "utf8");
  return { ...partial, ...parsed };
}

export async function runClaudeSession({ variant, recipe, workspace, privateDir, harnessHome, executable = "claude", env = {}, onPlan } = {}) {
  if (!Array.isArray(recipe?.turns) || recipe.turns.length === 0) throw new TypeError("recipe.turns must be a non-empty array");
  const cwd = absolutePath(workspace, "workspace");
  const root = absolutePath(privateDir, "privateDir");
  const home = absolutePath(harnessHome, "harnessHome");
  await mkdir(root, { recursive: true });
  const pluginsOff = environmentOf(variant) === "live" && !connectionsOn(variant) ? await livePluginsOff(env) : {};
  const cliVersion = await getClaudeVersion({ executable, env, cwd, variant, harnessHome: home });
  let threadId = null;
  let observedModel = null;
  const turns = [];
  let failure = null;
  for (const [index, turn] of recipe.turns.entries()) {
    const turnId = requiredString(turn?.id, `recipe.turns[${index}].id`);
    const content = requiredString(turn?.content, `recipe.turns[${index}].content`);
    const prompt = index === 0 ? `${requiredString(recipe.setup?.instructions, "recipe.setup.instructions")}\n\n${content}` : content;
    const turnDir = path.join(root, "turns", `${String(index + 1).padStart(3, "0")}-${turnId}`);
    const plan = { turnId, argv: [executable, ...buildClaudeTurnArgs({ variant, workspace: cwd, harnessHome: home, prompt, threadId, env, pluginsOff })], eventsPath: path.join(turnDir, "stdout.jsonl"), stderrPath: path.join(turnDir, "stderr.txt"), finalPath: path.join(turnDir, "final.txt"), threadId };
    if (onPlan) await onPlan(plan);
    try {
      const result = await runClaudeTurn({ variant, workspace: cwd, harnessHome: home, artifactDir: turnDir, prompt, threadId, executable, env, pluginsOff });
      if (result.model !== variant.model) throw new ClaudeCodeExecutionError(`Effective Claude Code model mismatch: requested ${variant.model}, observed ${result.model}`, result);
      threadId = result.threadId;
      observedModel = result.model;
      turns.push({ turnId, argv: result.argv, eventsPath: result.paths.stdout, stderrPath: result.paths.stderr, finalPath: result.paths.finalMessage, events: result.events, finalMessage: result.finalMessage, usage: result.usage });
    } catch (error) {
      if (!(error instanceof ClaudeCodeExecutionError)) throw error;
      turns.push({ turnId, argv: error.result?.argv ?? plan.argv, eventsPath: error.result?.paths?.stdout ?? plan.eventsPath, stderrPath: error.result?.paths?.stderr ?? plan.stderrPath, finalPath: error.result?.paths?.finalMessage ?? plan.finalPath, events: [], finalMessage: null, usage: null });
      failure = { turnId, message: error.message, exitCode: error.result?.exitCode ?? null, signal: error.result?.signal ?? null };
      break;
    }
  }
  return { threadId, cliVersion, observedModel, turns, failure };
}

function selectorValues(argv, flag) {
  const values = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") break;
    if (arg === flag) values.push(argv[++index]);
    else if (typeof arg === "string" && arg.startsWith(`${flag}=`)) values.push(arg.slice(flag.length + 1));
  }
  return values;
}

export function assertClaudeInvocation(argv, variant) {
  if (!Array.isArray(argv)) throw new Error("Claude Code identity requires recorded argv for every turn");
  const models = selectorValues(argv, "--model");
  if (models.length !== 1 || models[0] !== variant.model) throw new Error(`Claude Code argv must contain exactly one --model ${variant.model} selector`);
  const efforts = selectorValues(argv, "--effort");
  if (efforts.length !== 1 || efforts[0] !== variant.reasoningEffort) throw new Error(`Claude Code argv must contain exactly one --effort ${variant.reasoningEffort} selector`);
  const environment = environmentOf(variant);
  const options = argv.slice(0, argv.indexOf("--") < 0 ? argv.length : argv.indexOf("--"));
  if ((environment === "clean") !== options.includes("--safe-mode")) throw new Error(`${environment} Claude Code argv ${environment === "clean" ? "must" : "must not"} run in safe mode`);
  if (connectionsOn(variant) === options.includes("--strict-mcp-config")) throw new Error(`Claude Code argv ${connectionsOn(variant) ? "must not pin" : "must pin"} strict MCP configuration with connections ${connectionsOn(variant) ? "on" : "off"}`);
  const tools = selectorValues(argv, "--tools");
  if (tools.length !== 1 || tools[0] !== claudeTools(variant).join(",")) throw new Error(`Claude Code argv must contain exactly one --tools ${claudeTools(variant).join(",")} selector`);
}

const sortedNames = (items) => [...new Set((items ?? []).map((item) => typeof item === "string" ? item : item?.name).filter((name) => typeof name === "string"))].sort();

/**
 * Compare Claude Code's own account of the session (its init event) with the
 * request, so a CLI that ignores --safe-mode, --tools or the MCP pin fails
 * verification instead of passing on argv alone. Returns what it found loaded.
 */
export function verifyClaudeInit(init, variant, { workspaces = [] } = {}) {
  if (init.permissionMode !== "bypassPermissions") throw new Error(`Claude Code init reported permission mode ${init.permissionMode ?? "missing"}, not bypassPermissions`);
  if (workspaces.length && !workspaces.includes(init.cwd)) throw new Error("Claude Code init reported a working directory other than the attempt workspace");
  if (!Array.isArray(init.tools)) throw new Error("Claude Code init event lacks its tool list");
  const builtIn = init.tools.filter((tool) => typeof tool !== "string" || !tool.startsWith("mcp__")).sort();
  const requested = [...claudeTools(variant)].sort();
  if (JSON.stringify(builtIn) !== JSON.stringify(requested)) throw new Error(`Claude Code init loaded tools ${builtIn.join(",")}, not ${requested.join(",")}`);
  const mcpServers = Array.isArray(init.mcp_servers) ? init.mcp_servers.map((server) => ({ name: server?.name, status: server?.status ?? null })).filter((server) => typeof server.name === "string") : null;
  if (mcpServers === null) throw new Error("Claude Code init event lacks its MCP server list");
  const mcpTools = init.tools.filter((tool) => typeof tool === "string" && tool.startsWith("mcp__"));
  if (!connectionsOn(variant) && (mcpServers.length || mcpTools.length)) throw new Error(`Claude Code loaded MCP servers with connections off: ${sortedNames(mcpServers).join(", ") || mcpTools.join(", ")}`);
  return {
    mcpServers: [...mcpServers].sort((a, b) => a.name.localeCompare(b.name)),
    plugins: sortedNames(init.plugins),
    skills: Array.isArray(init.skills) ? init.skills.length : null,
    agents: Array.isArray(init.agents) ? init.agents.length : null,
  };
}

export async function verifyClaudeIdentity({ variant, result, cliVersion, codexHome }) {
  if (result?.failure) throw new Error("Claude Code execution contains a failed turn");
  if (!UUID_PATTERN.test(result?.threadId ?? "")) throw new Error("Claude Code identity requires a valid result thread UUID");
  if (!result?.observedModel) throw new Error("Claude Code stream lacks the observed model");
  if (!Array.isArray(result.turns) || result.turns.length === 0) throw new Error("Claude Code identity requires observed evidence for every turn");
  const tiers = new Set();
  const auxiliaryModels = new Set();
  const outputStyles = new Set();
  // The runner names an attempt-local codex-home path; the workspace sits beside it.
  const workspace = codexHome ? path.join(path.dirname(absolutePath(codexHome, "codexHome")), "workspace") : null;
  const workspaces = workspace ? [workspace, await realpath(workspace).catch(() => workspace)] : [];
  let loaded = null;
  for (const turn of result.turns) {
    const evidence = claudeTurnEvidence(turn.events ?? [], { threadId: result.threadId });
    const found = verifyClaudeInit(evidence.init, variant, { workspaces });
    if (loaded && JSON.stringify(sortedNames(found.mcpServers)) !== JSON.stringify(sortedNames(loaded.mcpServers))) throw new Error("Claude Code loaded different MCP servers between turns");
    loaded ??= found;
    if (turn.finalMessage !== evidence.result.result) throw new Error("Claude Code final message does not match stream evidence");
    const mismatched = [evidence.init.model, ...evidence.assistantModels].find((model) => model !== variant.model);
    if (mismatched !== undefined) throw new Error(`Effective Claude Code model mismatch in turn ${turn.turnId}: requested ${variant.model}, observed ${mismatched ?? "missing"}`);
    if (evidence.usageModels.length > 0 && !evidence.usageModels.includes(variant.model)) throw new Error(`Claude Code usage in turn ${turn.turnId} does not include ${variant.model}`);
    // Claude Code may bill small background calls (titles, summaries) to another
    // model. They are disclosed, never folded into the tasted model's identity.
    for (const model of evidence.usageModels) if (model !== variant.model) auxiliaryModels.add(model);
    const claimedVersion = evidence.init.claude_code_version;
    if (claimedVersion && `claude-code ${claimedVersion}` !== cliVersion) throw new Error(`Claude Code CLI reported ${cliVersion}, stream recorded ${claimedVersion}`);
    if (evidence.result.usage?.service_tier) tiers.add(evidence.result.usage.service_tier);
    outputStyles.add(evidence.init.output_style ?? null);
    assertClaudeInvocation(turn.argv, variant);
  }
  if (result.observedModel !== variant.model) throw new Error(`Effective Claude Code model mismatch: requested ${variant.model}, observed ${result.observedModel}`);
  if (result.cliVersion !== cliVersion) throw new Error(`Claude Code CLI evidence mismatch: ${cliVersion} versus ${result.cliVersion}`);
  if (tiers.size > 1) throw new Error(`Claude Code service tier changed between turns: ${[...tiers].join(", ")}`);
  const [observedTier] = tiers;
  if (observedTier && !serviceTiersMatch(variant.serviceTier, observedTier)) throw new Error(`Claude Code tier requested ${variant.serviceTier}, observed ${observedTier}`);
  // Claude Code has no personality knob; its output style is the nearest thing
  // and must stay at the requested default.
  if (outputStyles.size !== 1 || !outputStyles.has(variant.personality)) throw new Error(`Claude Code output style requested ${variant.personality}, observed ${[...outputStyles].join(", ")}`);
  return {
    model: result.observedModel,
    provider: variant.provider,
    reasoningEffort: variant.reasoningEffort,
    reasoningEffortEvidence: "pinned-argv",
    personality: variant.personality,
    serviceTier: observedTier ?? variant.serviceTier,
    requestedServiceTier: variant.serviceTier,
    ...(observedTier ? { observedServiceTier: observedTier } : {}),
    serviceTierEvidence: observedTier ? "result-usage" : "requested-default",
    auxiliaryModels: [...auxiliaryModels].sort(),
    environment: environmentOf(variant),
    // What the session actually loaded, from its own init event.
    loaded,
    verifiedBy: "claude-code-init-assistant-and-result-events",
  };
}
