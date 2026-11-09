import { spawn } from "node:child_process";
import { lstat, mkdir, readFile, readdir, realpath, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ensurePrivateDirectory } from "./files.mjs";
import { serviceTiersMatch } from "./identity.mjs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** File and shell tools only: no web, MCP, subagents, or scheduling tools. */
export const CLAUDE_CODE_TOOLS = ["Bash", "Edit", "Glob", "Grep", "Read", "Write"];
/** The personal setup also needs the Skill tool, which is how his skills load. */
export const CLAUDE_CODE_PERSONAL_TOOLS = [...CLAUDE_CODE_TOOLS, "Skill"];
export const CLAUDE_CODE_EFFORTS = ["low", "medium", "high", "xhigh", "max"];
/** Entries of ~/.claude symlinked (writable) into a personal attempt home, when present. */
export const CLAUDE_CODE_PERSONAL_ENTRIES = ["CLAUDE.md", "skills", "agents", "commands", "output-styles"];
const INSTRUCTION_FILES = ["CLAUDE.md", "CLAUDE.local.md", "AGENTS.md"];
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
  if (environment !== "clean" && environment !== "personal") throw new Error("Claude Code configuration must declare executionProfile.environment clean or personal");
  return environment;
}

/**
 * Instruction files in the workspace's ancestors. Attempt workspaces live
 * inside the Kitchen checkout, whose AGENTS.md (and BJsWorkspace's above it)
 * would otherwise load as project memory.
 */
export function ancestorInstructionExcludes(...workspaces) {
  const excludes = new Set();
  for (const workspace of workspaces.filter(Boolean)) {
    let directory = path.dirname(path.resolve(workspace));
    for (;;) {
      const prefix = directory === path.sep ? "" : directory;
      for (const name of INSTRUCTION_FILES) excludes.add(`${prefix}/${name}`);
      excludes.add(`${prefix}/.claude/**`);
      const parent = path.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  }
  return [...excludes];
}

/** Settings layered over whatever setting sources the environment loads. */
export function claudeRunSettings(variant, { workspace, workspaceRealPath } = {}) {
  // includeGitInstructions also gates the git-status prompt section, which
  // would otherwise carry the Kitchen checkout's branch and recent commits.
  const settings = { disableAllHooks: true, disableClaudeAiConnectors: true, includeGitInstructions: false };
  if (environmentOf(variant) === "personal") settings.claudeMdExcludes = ancestorInstructionExcludes(workspace, workspaceRealPath);
  return settings;
}

export function buildClaudeTurnArgs({ variant, workspace, workspaceRealPath, prompt, threadId } = {}) {
  if (!variant || variant.harness !== "claude-code") throw new Error("Claude Code adapter requires a claude-code configuration");
  if (variant.executionProfile?.approvalPolicy !== "bypass-permissions") throw new Error("Claude Code execution profile must declare bypass-permissions approval");
  const environment = environmentOf(variant);
  if (!CLAUDE_CODE_EFFORTS.includes(variant.reasoningEffort)) throw new Error(`Claude Code effort must be one of ${CLAUDE_CODE_EFFORTS.join(", ")}`);
  const cwd = absolutePath(workspace, "workspace");
  const args = [
    "-p", "--output-format", "stream-json", "--verbose",
    "--model", requiredString(variant.model, "variant.model"),
    "--effort", variant.reasoningEffort,
  ];
  // Clean: safe mode drops CLAUDE.md, skills, plugins, hooks, MCP, commands,
  // agents and output styles, and no settings file is read. Personal: only the
  // user settings source, which is the mirrored attempt home.
  if (environment === "clean") args.push("--safe-mode", "--setting-sources", "");
  else args.push("--setting-sources", "user");
  args.push(
    "--settings", JSON.stringify(claudeRunSettings(variant, { workspace: cwd, workspaceRealPath })),
    "--strict-mcp-config", "--mcp-config", EMPTY_MCP,
  );
  if (threadId !== undefined && threadId !== null) {
    if (!UUID_PATTERN.test(threadId)) throw new TypeError("threadId must be an exact UUID");
    args.push("--resume", threadId);
  }
  const tools = environment === "personal" ? CLAUDE_CODE_PERSONAL_TOOLS : CLAUDE_CODE_TOOLS;
  args.push("--tools", tools.join(","), "--permission-mode", "bypassPermissions", "--", requiredString(prompt, "prompt"));
  return args;
}

/**
 * The child sees no inherited Claude or Anthropic variables (a parent Claude
 * Code session sets several, including its effort), and runs from the
 * per-attempt home.
 */
export function claudeChildEnv({ variant, harnessHome, workspace, workspaceRealPath, env = {}, base = process.env } = {}) {
  const inherited = (key) => !/^(?:CLAUDE|ANTHROPIC|TASTE_CLAUDE_)/u.test(key) && key !== "CLAUDECODE";
  const child = Object.fromEntries([...Object.entries(base), ...Object.entries(env)].filter(([key]) => inherited(key)));
  Object.assign(child, {
    CLAUDE_CONFIG_DIR: absolutePath(harnessHome, "harnessHome"),
    CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR: String(TOKEN_FD),
    ENABLE_CLAUDEAI_MCP_SERVERS: "false",
    DISABLE_AUTOUPDATER: "1",
  });
  if (environmentOf(variant) === "clean") Object.assign(child, { CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1", CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1" });
  // The model's own git commands stop at the attempt, not the Kitchen repo above it.
  const ceilings = [...new Set([workspace, workspaceRealPath].filter(Boolean).map((directory) => path.dirname(path.resolve(directory))))];
  if (ceilings.length) child.GIT_CEILING_DIRECTORIES = ceilings.join(path.delimiter);
  return child;
}

export function claudeCredentialsPath(env = {}) {
  return path.resolve(env.TASTE_CLAUDE_CREDENTIALS_PATH ?? process.env.TASTE_CLAUDE_CREDENTIALS_PATH ?? path.join(os.homedir(), ".claude", ".credentials.json"));
}

export function claudePersonalSource(env = {}) {
  return path.resolve(env.TASTE_CLAUDE_PERSONAL_HOME ?? process.env.TASTE_CLAUDE_PERSONAL_HOME ?? path.join(os.homedir(), ".claude"));
}

/**
 * Read the existing claude.ai OAuth access token. Errors never quote the file.
 * The token must outlive the run: with no refresh token the child cannot renew
 * it, which is what keeps it from rotating the login Burooj's own sessions use.
 */
export async function readClaudeAccessToken({ env = {}, now = Date.now(), marginMs } = {}) {
  const source = claudeCredentialsPath(env);
  const margin = marginMs ?? Number(env.TASTE_CLAUDE_TOKEN_MARGIN_MS ?? process.env.TASTE_CLAUDE_TOKEN_MARGIN_MS ?? DEFAULT_TOKEN_MARGIN_MS);
  let parsed;
  try { parsed = JSON.parse(await readFile(source, "utf8")); }
  catch { throw new Error(`Claude Code credentials are unavailable or unreadable: ${source}`); }
  const oauth = parsed?.claudeAiOauth;
  if (typeof oauth?.accessToken !== "string" || oauth.accessToken.length < 16) throw new Error("Claude Code credentials lack a claude.ai OAuth access token; log in with claude first");
  if (Number.isFinite(oauth.expiresAt) && oauth.expiresAt - now < margin) {
    throw new Error(`Claude Code access token expires within ${Math.round(margin / 60000)} minutes; run any claude command to refresh the login, then cook`);
  }
  return oauth.accessToken;
}

export async function prepareClaudeAttempt({ variant, harnessHome, env = {} } = {}) {
  const environment = environmentOf(variant);
  const home = absolutePath(harnessHome, "harnessHome");
  await ensurePrivateDirectory(home);
  if ((await readdir(home)).length !== 0) throw new Error("Fresh attempt Claude Code home must start empty");
  await readClaudeAccessToken({ env });
  if (environment === "personal") {
    const source = claudePersonalSource(env);
    for (const name of CLAUDE_CODE_PERSONAL_ENTRIES) {
      try { await lstat(path.join(source, name)); }
      catch (error) {
        if (error?.code === "ENOENT") continue;
        throw error;
      }
      await symlink(path.join(source, name), path.join(home, name));
    }
  }
  const entries = (await readdir(home)).sort();
  const allowed = environment === "personal" ? CLAUDE_CODE_PERSONAL_ENTRIES : [];
  const unexpected = entries.filter((entry) => !allowed.includes(entry));
  if (unexpected.length) throw new Error(`Fresh attempt Claude Code home holds unexpected entries: ${unexpected.join(", ")}`);
  return { mirrored: entries };
}

export function claudeRequestedExecution(variant) {
  const personal = environmentOf(variant) === "personal";
  return {
    claudeConfigDir: "fresh-per-attempt",
    providerAuth: "existing-oauth-access-token-on-fd",
    setup: personal ? `mirrored ~/.claude entries: ${CLAUDE_CODE_PERSONAL_ENTRIES.join(", ")}` : "none (safe mode)",
    tools: (personal ? CLAUDE_CODE_PERSONAL_TOOLS : CLAUDE_CODE_TOOLS).join(","),
    mcpServers: "none",
    hooks: "disabled",
  };
}

function collectProcess(executable, args, { cwd, env, token }) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const stdio = ["ignore", "pipe", "pipe"];
    if (token !== undefined) stdio.push("pipe");
    const child = spawn(executable, args, { cwd, env, shell: false, stdio });
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
  const childEnv = harnessHome ? claudeChildEnv({ variant, harnessHome, env }) : { ...process.env, ...env };
  const result = await collectProcess(requiredString(executable, "executable"), ["--version"], { cwd: cwd ? absolutePath(cwd, "cwd") : process.cwd(), env: childEnv });
  if (result.spawnError) throw new ClaudeCodeExecutionError(`Could not start Claude Code: ${result.spawnError.message}`, result, { cause: result.spawnError });
  if (result.exitCode !== 0) throw new ClaudeCodeExecutionError(`claude --version exited with code ${result.exitCode}`, result);
  const version = result.stdout.trim().match(/^(\d+\.\d+\.\d+\S*)/u)?.[1];
  if (!version) throw new ClaudeCodeExecutionError("claude --version did not report a version", result);
  return `claude-code ${version}`;
}

async function runClaudeTurn({ variant, workspace, workspaceRealPath, harnessHome, artifactDir, prompt, threadId, executable, env }) {
  const args = buildClaudeTurnArgs({ variant, workspace, workspaceRealPath, prompt, threadId });
  const paths = { stdout: path.join(artifactDir, "stdout.jsonl"), stderr: path.join(artifactDir, "stderr.txt"), finalMessage: path.join(artifactDir, "final.txt") };
  await mkdir(artifactDir, { recursive: true });
  const partial = { paths, argv: [executable, ...args] };
  let token;
  try { token = await readClaudeAccessToken({ env, marginMs: 0 }); }
  catch (error) { throw new ClaudeCodeExecutionError(error.message, partial, { cause: error }); }
  const result = await collectProcess(executable, args, { cwd: workspace, env: claudeChildEnv({ variant, harnessHome, workspace, workspaceRealPath, env }), token });
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
  const workspaceRealPath = await realpath(cwd);
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
    const plan = { turnId, argv: [executable, ...buildClaudeTurnArgs({ variant, workspace: cwd, workspaceRealPath, prompt, threadId })], eventsPath: path.join(turnDir, "stdout.jsonl"), stderrPath: path.join(turnDir, "stderr.txt"), finalPath: path.join(turnDir, "final.txt"), threadId };
    if (onPlan) await onPlan(plan);
    try {
      const result = await runClaudeTurn({ variant, workspace: cwd, workspaceRealPath, harnessHome: home, artifactDir: turnDir, prompt, threadId, executable, env });
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
  if (environmentOf(variant) === "clean" && !argv.includes("--safe-mode")) throw new Error("Clean Claude Code argv must run in safe mode");
  if (!argv.includes("--strict-mcp-config")) throw new Error("Claude Code argv must pin strict MCP configuration");
}

export async function verifyClaudeIdentity({ variant, result, cliVersion }) {
  if (result?.failure) throw new Error("Claude Code execution contains a failed turn");
  if (!UUID_PATTERN.test(result?.threadId ?? "")) throw new Error("Claude Code identity requires a valid result thread UUID");
  if (!result?.observedModel) throw new Error("Claude Code stream lacks the observed model");
  if (!Array.isArray(result.turns) || result.turns.length === 0) throw new Error("Claude Code identity requires observed evidence for every turn");
  const tiers = new Set();
  const auxiliaryModels = new Set();
  const outputStyles = new Set();
  for (const turn of result.turns) {
    const evidence = claudeTurnEvidence(turn.events ?? [], { threadId: result.threadId });
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
    verifiedBy: "claude-code-init-assistant-and-result-events",
  };
}
