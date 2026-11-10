import { spawn } from "node:child_process";
import { mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";

import { killOnBudget } from "./budget.mjs";
import { NETWORK_ENV, WITHOUT_XDG_HOME, XDG_HOME_ENV, harnessEnv } from "./child-env.mjs";
import { CLAUDE_CODE_EFFORTS, readClaudeAccessToken } from "./claude-code.mjs";
import { ensurePrivateDirectory, walkFiles } from "./files.mjs";
import { extractObservedIdentity } from "./identity.mjs";

/**
 * T3 Code as an outer harness layer: `t3 → claude-code` or `t3 → codex-cli`.
 *
 * T3 wraps a provider harness with its own system prompt and orchestration
 * tools. Each attempt runs its own throwaway T3 server (`t3 serve --base-dir`)
 * on a loopback port with a Kitchen-written settings.json, so no thread, project
 * or setting ever reaches the T3 app Burooj uses. Turns go through T3's own CLI
 * (`thread start` / `thread send --wait --json`). The inner harness runs in a
 * fresh per-attempt home (CLAUDE_CONFIG_DIR or CODEX_HOME), and its own session
 * files there are the identity evidence: the model that answered, by the inner
 * harness's own account.
 *
 * Claude Code gets the existing access token only, never the refresh token, so
 * a run cannot rotate Burooj's login; the scratch settings holding it are
 * scrubbed once the server stops.
 */

export const T3_INNER = {
  "claude-code": { instanceId: "claudeAgent", driver: "claudeAgent", effortOption: "effort", efforts: CLAUDE_CODE_EFFORTS, home: "claude-home", binary: "claude", binaryEnv: "TASTE_T3_CLAUDE_BINARY" },
  "codex-cli": { instanceId: "codex", driver: "codex", effortOption: "reasoningEffort", efforts: ["low", "medium", "high", "xhigh"], home: "codex-home", binary: "codex", binaryEnv: "TASTE_T3_CODEX_BINARY" },
};
// Every other provider a fresh T3 home might enable on its own.
const OTHER_DRIVERS = ["cursor", "opencode", "antigravity", "grok", "muse"];
const THREAD_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{5,127}$/u;
const READY_TIMEOUT_MS = 60_000;
const DEFAULT_TURN_TIMEOUT_MS = 60 * 60 * 1000;

function requiredString(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} must be a non-empty string`);
  return value;
}

function absolutePath(value, name) {
  requiredString(value, name);
  if (!path.isAbsolute(value)) throw new TypeError(`${name} must be an absolute path`);
  return path.normalize(value);
}

export function t3Inner(variant) {
  const inner = variant?.harnessPath?.[1];
  const spec = T3_INNER[inner];
  if (!spec || variant.harnessPath.length !== 2) throw new Error(`T3 wraps exactly one of ${Object.keys(T3_INNER).join(", ")}; got ${variant?.harnessPath?.slice(1).join(" → ")}`);
  return { inner, ...spec };
}

/** The model selection T3 starts every thread with, effort included. */
export function t3ModelSelection(variant) {
  const spec = t3Inner(variant);
  return { instanceId: spec.instanceId, model: requiredString(variant.model, "variant.model"), options: [{ id: spec.effortOption, value: variant.reasoningEffort }] };
}

export function t3Paths(attemptDir) {
  const root = absolutePath(attemptDir, "attemptDir");
  return { attemptDir: root, t3Home: path.join(root, "t3-home"), claudeHome: path.join(root, "claude-home"), codexHome: path.join(root, "codex-home"), codexUserHome: path.join(root, "codex-user-home") };
}

function innerBinary(spec, env) {
  return env[spec.binaryEnv] ?? process.env[spec.binaryEnv] ?? spec.binary;
}

/**
 * The inner harness as an absolute path, resolved once on the Kitchen's PATH.
 * T3 prepends its login shell's PATH, so a bare name could run a different
 * binary than the one whose version is recorded.
 */
async function resolveInnerBinary(spec, env, processEnv) {
  const name = innerBinary(spec, env);
  if (name.includes("/")) return path.resolve(name);
  for (const directory of (processEnv.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(directory, name);
    if ((await stat(candidate).catch(() => null))?.isFile()) return candidate;
  }
  throw new Error(`${name} was not found on PATH; set ${spec.binaryEnv}`);
}

/**
 * The scratch server's settings: one provider enabled, pinned to the tasted
 * model and effort for threads and for T3's own title calls, and every
 * background or outward-facing feature off. `token` is set only in the copy
 * T3 reads; the copy kept as evidence redacts it.
 */
export function t3Settings({ variant, paths, env = {}, token, binaryPath }) {
  const spec = t3Inner(variant);
  const selection = t3ModelSelection(variant);
  const binary = binaryPath ?? innerBinary(spec, env);
  const instances = Object.fromEntries(OTHER_DRIVERS.map((driver) => [driver, { driver, enabled: false }]));
  for (const [inner, other] of Object.entries(T3_INNER)) {
    if (inner !== spec.inner) instances[other.instanceId] = { driver: other.driver, enabled: false };
  }
  instances[spec.instanceId] = spec.inner === "claude-code"
    ? {
      driver: spec.driver, enabled: true,
      environment: [
        { name: "CLAUDE_CONFIG_DIR", value: paths.claudeHome, sensitive: false },
        { name: "CLAUDE_CODE_OAUTH_TOKEN", value: token ?? "<redacted>", sensitive: true },
      ],
      config: { binaryPath: binary },
    }
    : { driver: spec.driver, enabled: true, config: { binaryPath: binary, homePath: paths.codexHome } };
  return {
    defaultModelSelection: selection,
    textGenerationModelSelection: selection,
    defaultRuntimeMode: "full-access",
    defaultAutoPull: false,
    enableProviderUpdateChecks: false,
    enableAgentBrowserAccess: false,
    enableAgentDeviceAccess: false,
    linkedEnvironmentsEnabled: false,
    guestSharingEnabled: false,
    reviewGuidesEnabled: false,
    idleCompaction: "off",
    fallbackModelSelection: null,
    autoResumeLimitedThreads: false,
    snoozeLimitedThreads: false,
    continueThreadsAfterServerUpdate: false,
    providerInstances: instances,
  };
}

/**
 * An allowlisted environment (child-env.mjs): nothing from the operator's own
 * Claude Code or T3 session, no provider key, token or agent socket. The inner
 * harness gets its login only from the scratch settings or its own home.
 * `userHome` replaces HOME for a Codex inner harness: Codex loads user skills
 * from $HOME/.agents/skills whatever CODEX_HOME says (codex.mjs does the same
 * for its clean environment). Claude Code takes everything from CLAUDE_CONFIG_DIR.
 */
export function scrubbedEnv(env = {}, { userHome, base = process.env } = {}) {
  // T3 reports usage to ingest.t3.codes unless told otherwise; nothing leaves a Kitchen attempt.
  const set = { T3CODE_NO_BROWSER: "1", T3CODE_TELEMETRY_ENABLED: "false", DO_NOT_TRACK: "1", ...(userHome ? { ...WITHOUT_XDG_HOME, HOME: userHome } : {}) };
  return harnessEnv({ env, base, allow: userHome ? NETWORK_ENV : [...NETWORK_ENV, ...XDG_HOME_ENV], set });
}

function runProcess(executable, args, { cwd, env, input, timeoutMs, clock }) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    const child = spawn(executable, args, { cwd, env, shell: false, stdio: ["pipe", "pipe", "pipe"] });
    const timer = timeoutMs ? setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, timeoutMs) : null;
    // The turn itself runs in the scratch server, which the session stops on its way out.
    const budget = killOnBudget(child, clock);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.stdin.on("error", () => {});
    child.stdin.end(input ?? "");
    const done = (result) => { budget.dispose(); if (!settled) { settled = true; if (timer) clearTimeout(timer); resolve({ ...result, timedOut, budgetKilled: budget.killed }); } };
    child.on("error", (error) => done({ exitCode: null, signal: null, stdout, stderr, spawnError: error }));
    child.on("close", (exitCode, signal) => done({ exitCode, signal, stdout, stderr, spawnError: null }));
  });
}

export async function freeLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

export class T3ExecutionError extends Error {
  constructor(message, result, options) {
    super(message, options);
    this.name = "T3ExecutionError";
    this.result = result;
  }
}

// The server runs under this supervisor, in its own process group. Its stdin is
// a pipe held only by the Kitchen: when the Kitchen exits for any reason,
// SIGKILL and Ctrl-C included, the pipe closes, the supervisor stops the server
// (and T3 reaps its provider children), then deletes the token-bearing settings
// and T3's secret store. It silences its own output once the server runs (the
// pipe is dead then, and a failed write would end it before the delete).
// It silences its own output once the server runs: the pipe is dead by then, and
// a failed write would end it before the delete. Arguments: settings, secrets,
// then the server command.
const SUPERVISOR = `settings=$1; secrets=$2; shift 2
exec 3<&0
"$@" &
server=$!
( read -r _ <&3; kill -TERM $server 2>/dev/null; sleep 10; kill -KILL $server 2>/dev/null ) &
watcher=$!
exec >/dev/null 2>&1
wait $server
kill $watcher 2>/dev/null
rm -rf "$settings" "$secrets"
`;

async function serverAnswers(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2_000) });
    return response.ok;
  } catch { return false; }
}

/**
 * Start a scratch T3 server and wait until it answers on its own loopback port
 * and accepts the workspace as its one project. (`t3 project add` alone proves
 * nothing: with no server it writes the database directly.) Its process group
 * is stopped by `stop()`, and by the supervisor if the Kitchen dies first.
 */
export async function startT3Server({ executable, t3Home, workspace, env, logPath, port: chosenPort, readyTimeoutMs = READY_TIMEOUT_MS }) {
  const port = chosenPort ?? await freeLoopbackPort();
  const args = ["serve", "--base-dir", t3Home, "--host", "127.0.0.1", "--port", String(port), "--no-browser", workspace];
  const userdata = path.join(t3Home, "userdata");
  const child = spawn("/bin/sh", ["-c", SUPERVISOR, "t3-supervisor", path.join(userdata, "settings.json"), path.join(userdata, "secrets"), executable, ...args], { cwd: workspace, env, shell: false, stdio: ["pipe", "pipe", "pipe"], detached: true });
  let log = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { log += chunk; });
  child.stderr.on("data", (chunk) => { log += chunk; });
  child.stdin.on("error", () => {});
  let exited = null;
  const closed = new Promise((resolve) => child.on("close", (code, signal) => { exited = { code, signal }; resolve(); }));
  child.on("error", (error) => { exited = { code: null, signal: null, error }; });
  const stop = async () => {
    try {
      if (exited === null && child.pid) {
        try { process.kill(-child.pid, "SIGTERM"); } catch { /* already gone */ }
        const killed = await Promise.race([closed.then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), 10_000))]);
        if (!killed) { try { process.kill(-child.pid, "SIGKILL"); } catch { /* already gone */ } await closed; }
      }
    } finally {
      if (logPath) await writeFile(logPath, log, "utf8").catch(() => {});
    }
  };
  const deadline = Date.now() + readyTimeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    if (exited !== null) { await stop(); throw new Error(`T3 server exited before it was ready (code ${exited.code ?? "none"})`); }
    if (await serverAnswers(port)) {
      last = await runProcess(executable, ["project", "add", "--base-dir", t3Home, workspace], { cwd: workspace, env, timeoutMs: 30_000 });
      if (last.exitCode === 0) return { port, argv: [executable, ...args], stop };
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  await stop();
  throw new Error(`T3 server did not accept the workspace project within ${readyTimeoutMs} ms${last?.stderr ? `: ${last.stderr.trim().split("\n").at(-1)}` : ""}`);
}

/** One turn's CLI result: `{threadId, runId, status, reply, error}`, completed with a reply. */
export function parseT3Turn(text, { threadId } = {}) {
  if (typeof text !== "string") throw new TypeError("T3 turn evidence must be a string");
  const lines = text.split(/\r?\n/u).filter(Boolean);
  if (lines.length !== 1) throw new Error(`T3 turn evidence held ${lines.length} records; expected exactly one`);
  let record;
  try { record = JSON.parse(lines[0]); }
  catch (error) { throw new Error(`Invalid T3 turn JSON: ${error.message}`); }
  if (!THREAD_PATTERN.test(record?.threadId ?? "")) throw new Error("T3 turn result lacks a valid thread id");
  if (threadId !== undefined && threadId !== null && record.threadId !== threadId) throw new Error(`T3 answered in thread ${record.threadId}, not ${threadId}`);
  if (record.status !== "completed") throw new Error(`T3 run ended ${record.status}${record.error ? `: ${record.error}` : ""}`);
  if (typeof record.reply !== "string" || record.reply.trim() === "") throw new Error("T3 run completed without a reply");
  return { events: [record], threadId: record.threadId, runId: record.runId ?? null, model: null, finalMessage: record.reply, usage: null };
}

export function buildT3TurnArgs({ t3Home, workspace, threadId, title } = {}) {
  const base = ["--base-dir", absolutePath(t3Home, "t3Home"), "--wait", "--json"];
  if (threadId === undefined || threadId === null) return ["thread", "start", ...base, ...(title ? ["--title", title] : []), absolutePath(workspace, "workspace"), "-"];
  if (!THREAD_PATTERN.test(threadId)) throw new TypeError("threadId must be an exact T3 thread id");
  return ["thread", "send", ...base, threadId, "-"];
}

async function versionOf(executable, env, cwd) {
  const result = await runProcess(executable, ["--version"], { cwd, env, timeoutMs: 30_000 });
  const version = result.stdout.split(/\r?\n/u).map((line) => line.trim()).find(Boolean);
  if (result.spawnError || result.exitCode !== 0 || !version) throw new Error(`${executable} --version failed${result.spawnError ? `: ${result.spawnError.message}` : ""}`);
  return version;
}

async function scrubSecrets(paths) {
  // The token lives only in the scratch settings T3 read and whatever secret store it moved it to.
  await Promise.all([
    rm(path.join(paths.t3Home, "userdata", "settings.json"), { force: true }),
    rm(path.join(paths.t3Home, "userdata", "secrets"), { recursive: true, force: true }),
  ]);
}

/**
 * The runner's cleanup, and the next Cook's prune for an attempt whose Kitchen
 * died: if even the supervisor was killed before its delete, the token-bearing
 * settings and T3's secret store are removed here.
 */
export function cleanupT3Attempt({ cwd }) {
  return scrubSecrets(t3Paths(cwd));
}

export async function runT3Session({ variant, recipe, workspace, privateDir, executable = "t3", env = {}, onPlan, budget = null, clock } = {}) {
  if (!Array.isArray(recipe?.turns) || recipe.turns.length === 0) throw new TypeError("recipe.turns must be a non-empty array");
  const cwd = absolutePath(workspace, "workspace");
  const root = absolutePath(privateDir, "privateDir");
  await mkdir(root, { recursive: true });
  const spec = t3Inner(variant);
  const paths = t3Paths(path.dirname(cwd));
  const processEnv = scrubbedEnv(env, { userHome: spec.inner === "codex-cli" ? paths.codexUserHome : undefined });
  const t3Version = await versionOf(executable, processEnv, cwd);
  const innerPath = await resolveInnerBinary(spec, env, processEnv);
  const innerVersion = await versionOf(innerPath, processEnv, cwd);
  const cliVersion = `${t3Version} › ${innerVersion}`;
  const token = spec.inner === "claude-code" ? await readClaudeAccessToken({ env }) : undefined;
  await mkdir(path.join(paths.t3Home, "userdata"), { recursive: true });
  await writeFile(path.join(root, "t3-settings.json"), `${JSON.stringify(t3Settings({ variant, paths, env, binaryPath: innerPath }), null, 2)}\n`, "utf8");
  // A declared time budget is the limit; Kitchen's own turn timeout would end the Run first and blame nobody.
  const turnTimeoutMs = budget?.seconds !== undefined ? null : Number(env.TASTE_T3_TURN_TIMEOUT_MS ?? process.env.TASTE_T3_TURN_TIMEOUT_MS ?? DEFAULT_TURN_TIMEOUT_MS);
  let threadId = null;
  const turns = [];
  let failure = null;
  let server = null;
  // Chosen first, so nothing slow sits between the token reaching disk and the supervisor that deletes it.
  const port = await freeLoopbackPort();
  try {
    // The token reaches disk only here, inside the try whose finally deletes it.
    await writeFile(path.join(paths.t3Home, "userdata", "settings.json"), `${JSON.stringify(t3Settings({ variant, paths, env, token, binaryPath: innerPath }), null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    try { server = await startT3Server({ executable, t3Home: paths.t3Home, workspace: cwd, env: processEnv, logPath: path.join(root, "t3-serve.log"), port }); }
    catch (error) {
      return { threadId: null, cliVersion, observedModel: null, turns: [], failure: { turnId: recipe.turns[0].id, message: error.message, exitCode: null, signal: null } };
    }
    for (const [index, turn] of recipe.turns.entries()) {
      const turnId = requiredString(turn?.id, `recipe.turns[${index}].id`);
      const content = requiredString(turn?.content, `recipe.turns[${index}].content`);
      const prompt = index === 0 ? `${requiredString(recipe.setup?.instructions, "recipe.setup.instructions")}\n\n${content}` : content;
      const turnDir = path.join(root, "turns", `${String(index + 1).padStart(3, "0")}-${turnId}`);
      const turnPaths = { events: path.join(turnDir, "t3.jsonl"), stderr: path.join(turnDir, "stderr.txt"), final: path.join(turnDir, "final.txt") };
      const args = buildT3TurnArgs({ t3Home: paths.t3Home, workspace: cwd, threadId, title: `Kitchen ${turnId}` });
      const argv = [executable, ...args];
      if (onPlan) await onPlan({ turnId, argv, eventsPath: turnPaths.events, stderrPath: turnPaths.stderr, finalPath: turnPaths.final, threadId });
      await mkdir(turnDir, { recursive: true });
      const result = await runProcess(executable, args, { cwd, env: processEnv, input: prompt, timeoutMs: turnTimeoutMs, clock });
      await Promise.all([writeFile(turnPaths.events, result.stdout, "utf8"), writeFile(turnPaths.stderr, result.stderr, "utf8")]);
      try {
        if (result.spawnError) throw new Error(`Could not start T3: ${result.spawnError.message}`);
        if (result.budgetKilled) throw new Error("T3 was stopped by the Recipe's time budget");
        if (result.timedOut) throw Object.assign(new Error(`T3 turn timeout ended the turn after ${turnTimeoutMs} ms`), { limit: `T3 turn timeout (${turnTimeoutMs} ms)` });
        const parsed = parseT3Turn(result.stdout, { threadId });
        if (result.exitCode !== 0) throw new Error(`T3 exited with code ${result.exitCode}`);
        threadId = parsed.threadId;
        await writeFile(turnPaths.final, parsed.finalMessage, "utf8");
        turns.push({ turnId, argv, eventsPath: turnPaths.events, stderrPath: turnPaths.stderr, finalPath: turnPaths.final, events: parsed.events, finalMessage: parsed.finalMessage, usage: null });
      } catch (error) {
        turns.push({ turnId, argv, eventsPath: turnPaths.events, stderrPath: turnPaths.stderr, finalPath: turnPaths.final, events: [], finalMessage: null, usage: null });
        failure = { turnId, message: error.message, exitCode: result.exitCode, signal: result.signal, ...(error.limit ? { kitchenFault: "harness-limit", limit: error.limit } : {}) };
        break;
      }
    }
    if (!failure && threadId) {
      // T3's own record of the conversation, beside the inner harness's.
      const shown = await runProcess(executable, ["thread", "show", "--base-dir", paths.t3Home, "--json", "--messages", String(recipe.turns.length * 2 + 10), threadId], { cwd, env: processEnv, timeoutMs: 60_000 });
      await writeFile(path.join(root, "t3-thread.json"), shown.stdout, "utf8");
    }
  } finally {
    try { if (server) await server.stop(); }
    finally { await scrubSecrets(paths); }
  }
  const identity = failure ? null : await readInnerIdentity({ variant, paths }).catch(() => null);
  return { threadId, cliVersion, observedModel: identity?.models.length === 1 ? identity.models[0] : null, turns, failure };
}

/** The models the inner harness itself recorded answering, from its own session files in the attempt home. */
export async function readInnerIdentity({ variant, paths }) {
  const spec = t3Inner(variant);
  if (spec.inner === "claude-code") {
    const projects = path.join(paths.claudeHome, "projects");
    const files = (await walkFiles(projects).catch(() => [])).filter((file) => file.endsWith(".jsonl"));
    const models = new Set();
    let replies = 0;
    for (const file of files) {
      for (const line of (await readFile(path.join(projects, file), "utf8")).split(/\r?\n/u).filter(Boolean)) {
        let entry;
        try { entry = JSON.parse(line); } catch { continue; }
        const model = entry?.type === "assistant" ? entry.message?.model : undefined;
        if (typeof model !== "string" || model === "<synthetic>") continue;
        models.add(model);
        replies += 1;
      }
    }
    return { sessions: files.length, replies, models: [...models], efforts: [], evidence: "claude-code-session-transcripts" };
  }
  const sessions = path.join(paths.codexHome, "sessions");
  const files = (await walkFiles(sessions).catch(() => [])).filter((file) => file.endsWith(".jsonl"));
  const models = new Set();
  const efforts = new Set();
  let replies = 0;
  for (const file of files) {
    const text = await readFile(path.join(sessions, file), "utf8");
    const observed = extractObservedIdentity(text);
    if (observed.model) models.add(observed.model);
    if (observed.reasoningEffort) efforts.add(observed.reasoningEffort);
    // One thread appends every turn to one rollout; each turn opens with its own turn_context.
    for (const line of text.split(/\r?\n/u)) {
      let record;
      try { record = JSON.parse(line); } catch { continue; }
      if (record?.type !== "turn_context") continue;
      replies += 1;
      // Every turn's own context counts: the rollout's last one alone would hide an earlier substitution.
      const context = typeof record.payload === "object" && record.payload !== null ? record.payload : record;
      if (typeof context.model === "string") models.add(context.model);
      const effort = context.effort ?? context.reasoning_effort;
      if (typeof effort === "string") efforts.add(effort);
    }
  }
  return { sessions: files.length, replies, models: [...models], efforts: [...efforts], evidence: "codex-rollouts" };
}

/**
 * Prepare one attempt: a fresh inner home inside the cook directory, which sits
 * outside any repository (runtime-root.mjs checks that no ancestor holds project
 * instructions). Nothing from Burooj's T3 or harness setup is copied.
 */
export async function prepareT3Attempt({ variant, cwd, env = {} } = {}) {
  const spec = t3Inner(variant);
  const paths = t3Paths(cwd);
  if (spec.inner === "claude-code") {
    await readClaudeAccessToken({ env });
    await ensurePrivateDirectory(paths.claudeHome);
    // Claude Code reads user settings from its config dir: no hooks, no git
    // context, and no web tools.
    await writeFile(path.join(paths.claudeHome, "settings.json"), `${JSON.stringify({
      disableAllHooks: true, includeGitInstructions: false, permissions: { deny: ["WebFetch", "WebSearch"] },
    }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    return;
  }
  const authSource = path.resolve(env.TASTE_CODEX_AUTH_PATH ?? process.env.TASTE_CODEX_AUTH_PATH ?? path.join(os.homedir(), ".codex", "auth.json"));
  if (!(await stat(authSource).catch(() => null))?.isFile()) throw new Error(`Codex auth source is unavailable: ${authSource}`);
  await ensurePrivateDirectory(paths.codexHome);
  await ensurePrivateDirectory(paths.codexUserHome);
  await symlink(authSource, path.join(paths.codexHome, "auth.json"));
}

export function t3RequestedExecution(variant) {
  const spec = t3Inner(variant);
  return {
    t3Server: "scratch-base-dir-per-attempt",
    t3Settings: "kitchen-written; one provider; browser, device, linked environments and auto-pull off",
    innerHarness: spec.inner,
    innerHome: `${spec.home} fresh-per-attempt`,
    providerAuth: spec.inner === "claude-code" ? "existing-oauth-access-token-in-scratch-settings" : "existing-codex-auth-symlink",
    gitBoundary: "cook-directory-outside-repo",
  };
}

export function reconstructT3Turn(eventsText) {
  return parseT3Turn(eventsText);
}

/**
 * Verify every turn from T3's own results, then the inner harness's session
 * files: every reply recorded there came from the requested model (and, for
 * Codex, at the requested effort).
 */
export async function verifyT3Identity({ codexHome, variant, cliVersion, result } = {}) {
  if (result?.failure) throw new Error("T3 execution contains a failed turn");
  if (!THREAD_PATTERN.test(result?.threadId ?? "")) throw new Error("T3 identity requires a valid thread id");
  if (!Array.isArray(result.turns) || result.turns.length === 0) throw new Error("T3 identity requires evidence for every turn");
  if (result.cliVersion !== cliVersion) throw new Error(`T3 CLI evidence mismatch: ${cliVersion} versus ${result.cliVersion}`);
  for (const turn of result.turns) {
    const parsed = parseT3Turn((turn.events ?? []).map((event) => JSON.stringify(event)).join("\n"), { threadId: result.threadId });
    if (turn.finalMessage !== parsed.finalMessage) throw new Error(`T3 turn ${turn.turnId} final message does not match its result`);
  }
  const spec = t3Inner(variant);
  // The runner names an attempt-local codex-home path; its parent is the attempt directory.
  const paths = t3Paths(path.dirname(absolutePath(codexHome, "codexHome")));
  const identity = await readInnerIdentity({ variant, paths });
  const mismatches = [];
  if (identity.replies < result.turns.length) mismatches.push(`${spec.inner} recorded ${identity.replies} replies for ${result.turns.length} turns`);
  for (const model of identity.models) if (model !== variant.model) mismatches.push(`model requested ${variant.model}, ${spec.inner} recorded ${model}`);
  if (identity.models.length === 0) mismatches.push(`${spec.inner} recorded no model`);
  for (const effort of identity.efforts) if (effort !== variant.reasoningEffort) mismatches.push(`effort requested ${variant.reasoningEffort}, ${spec.inner} recorded ${effort}`);
  if (mismatches.length) throw new Error(`Effective T3 identity mismatch: ${[...new Set(mismatches)].join("; ")}`);
  return {
    model: variant.model,
    provider: variant.provider,
    harnessPath: [...variant.harnessPath],
    reasoningEffort: variant.reasoningEffort,
    reasoningEffortEvidence: spec.inner === "codex-cli" ? "codex-rollout" : "requested-t3-model-selection",
    personality: variant.personality,
    serviceTier: variant.serviceTier,
    requestedServiceTier: variant.serviceTier,
    serviceTierEvidence: "requested-default",
    environment: "clean",
    innerSessions: identity.sessions,
    verifiedBy: identity.evidence,
  };
}
