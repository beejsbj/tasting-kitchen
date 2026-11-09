import { spawn } from "node:child_process";
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { killOnBudget } from "./budget.mjs";
import { NETWORK_ENV, WITHOUT_XDG_HOME, XDG_HOME_ENV, harnessEnv, liveEnv } from "./child-env.mjs";
import { DETACHED_CHILD, trackChild } from "./interrupt.mjs";
import { collectSetupChildren, collectSetupFile, createSetupBudget, setupDigest, toggleOn } from "./environments.mjs";
import { verifyObservedIdentity } from "./identity.mjs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requiredString(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value;
}

function absolutePath(value, name) {
  requiredString(value, name);
  if (!path.isAbsolute(value)) {
    throw new TypeError(`${name} must be an absolute path`);
  }
  return path.normalize(value);
}

function config(key, value) {
  return ["-c", `${key}=${JSON.stringify(value)}`];
}

/**
 * The clean environment also replaces HOME: Codex loads user skills from
 * $HOME/.agents/skills whatever CODEX_HOME says. The fresh home sits beside the
 * attempt's codex-home and starts empty. Other environments keep the real HOME.
 */
export function codexUserHome(variant, codexHome) {
  if (variant?.executionProfile?.environment !== "clean") return null;
  return path.join(path.dirname(absolutePath(codexHome, "codexHome")), "home");
}

/**
 * The Codex home a live run uses: his real one, exactly as it is. TASTE_CODEX_LIVE_HOME
 * points tests (and only tests) at a fake.
 */
export function codexLiveHome(env = {}) {
  return path.resolve(env.TASTE_CODEX_LIVE_HOME ?? process.env.TASTE_CODEX_LIVE_HOME ?? path.join(os.homedir(), ".codex"));
}

export const isLiveCodex = (variant) => variant?.executionProfile?.environment === "live";

/**
 * What a live run changes about his config, and only that. Memory off forces
 * the feature and both memory settings off; memory on leaves his config as it
 * is. Connections off disables plugins, apps and each MCP server his config
 * names; on leaves them as they are. Everything else (his AGENTS.md, rules,
 * skills, base URL, trust list) is his own and untouched.
 */
export function codexLiveOverrides({ memory, connections, disabledMcpServers = [] } = {}) {
  const args = [];
  if (memory === "off") args.push(...config("memories.use_memories", false), ...config("memories.generate_memories", false), "--disable", "memories");
  if (connections === "off") {
    args.push("--disable", "plugins", "--disable", "apps");
    for (const name of [...disabledMcpServers].sort()) args.push(...config(`mcp_servers.${name}.enabled`, false));
  }
  return args;
}

/**
 * An allowlisted environment (child-env.mjs): Codex holds no provider key,
 * token or agent socket from the Kitchen's environment, and its login comes
 * only from CODEX_HOME/auth.json. Clean also replaces HOME and drops the XDG
 * directories; the original profile keeps the real HOME and its XDG directories.
 * A live run keeps the whole environment, as he runs codex.
 */
function childEnv(env, codexHome, home, live = false) {
  if (live) return liveEnv({ env, set: { CODEX_HOME: codexHome } });
  if (home) return harnessEnv({ env, allow: NETWORK_ENV, set: { ...WITHOUT_XDG_HOME, CODEX_HOME: codexHome, HOME: home } });
  return harnessEnv({ env, allow: [...NETWORK_ENV, ...XDG_HOME_ENV], set: { CODEX_HOME: codexHome } });
}

function variantOptions(variant, recipe) {
  if (!variant || typeof variant !== "object") throw new TypeError("variant must be an object");
  if (!recipe || typeof recipe !== "object") throw new TypeError("recipe must be an object");
  const profile = variant.executionProfile;
  if (!profile || typeof profile !== "object") throw new TypeError("variant.executionProfile must be an object");
  if (profile.sandbox !== "danger-full-access") throw new Error("Codex fallback execution profile must declare danger-full-access");
  if (profile.approvalPolicy !== "never") throw new Error("Codex fallback execution profile must declare approvalPolicy never");
  if (profile.nativeWeb !== "disabled") throw new Error("Codex fallback execution profile must disable native web");
  return {
    model: requiredString(variant.model, "variant.model"),
    reasoningEffort: requiredString(variant.reasoningEffort, "variant.reasoningEffort"),
    personality: variant.personality ?? "none",
    modelVerbosity: variant.modelVerbosity ?? "low",
    web: "disabled",
    sandbox: profile.sandbox,
    approval: profile.approvalPolicy,
    serviceTier: variant.serviceTier ?? "default",
    live: isLiveCodex(variant) ? { memory: profile.memory, connections: profile.connections } : null,
  };
}

/**
 * Build (but do not execute) one fully pinned Codex CLI invocation.
 *
 * A missing threadId creates a fresh session. Supplying a threadId always uses
 * `exec resume <exact UUID>`; this adapter intentionally has no `--last` path.
 */
export function planCodexTurn({
  prompt,
  threadId,
  model,
  reasoningEffort,
  personality = "none",
  modelVerbosity = "low",
  web = "disabled",
  sandbox = "danger-full-access",
  approval = "never",
  serviceTier,
  workspace,
  codexHome,
  home = null,
  artifactDir,
  executable = "codex",
  env = {},
  live = null,
} = {}) {
  requiredString(prompt, "prompt");
  requiredString(model, "model");
  requiredString(reasoningEffort, "reasoningEffort");
  requiredString(personality, "personality");
  requiredString(modelVerbosity, "modelVerbosity");
  requiredString(web, "web");
  requiredString(sandbox, "sandbox");
  requiredString(approval, "approval");
  requiredString(executable, "executable");
  if (sandbox !== "danger-full-access") throw new Error("Gate 4a Codex fallback requires danger-full-access");
  if (approval !== "never") throw new Error("Gate 4a Codex fallback requires approval policy never");
  if (web !== "disabled") throw new Error("Gate 4a Codex fallback requires native web disabled");

  if (threadId !== undefined && threadId !== null && !UUID_PATTERN.test(threadId)) {
    throw new TypeError("threadId must be an exact UUID");
  }

  const cwd = absolutePath(workspace, "workspace");
  const cleanHome = absolutePath(codexHome, "codexHome");
  const outputDirectory = absolutePath(artifactDir, "artifactDir");
  const paths = {
    stdout: path.join(outputDirectory, "stdout.jsonl"),
    stderr: path.join(outputDirectory, "stderr.txt"),
    finalMessage: path.join(outputDirectory, "final.txt"),
  };
  const pinnedTier = serviceTier ?? "default";
  requiredString(pinnedTier, "serviceTier");
  // Approval is a top-level Codex flag in CLI 0.145.0. Putting it after
  // `exec` is rejected by the parser. Sandbox is also pinned globally so the
  // same policy applies to resume, whose subcommand has no --sandbox option.
  const args = codexArgs({ approval, sandbox, threadId, finalMessage: paths.finalMessage, model, reasoningEffort, personality, modelVerbosity, web, serviceTier: pinnedTier, cwd, live });

  return {
    executable,
    args,
    cwd,
    env: childEnv(env, cleanHome, home ? absolutePath(home, "home") : null, Boolean(live)),
    stdin: prompt,
    threadId: threadId ?? null,
    serviceTier: pinnedTier,
    paths,
  };
}

export const buildCodexTurnPlan = planCodexTurn;

/**
 * Public dry-run contract used by the tasting runner. It returns argv only and
 * never touches the filesystem or starts Codex.
 */
export function buildCodexTurnArgs({ variant, recipe, workspace, finalPath, threadId, setup } = {}) {
  const finalMessage = absolutePath(finalPath, "finalPath");
  const cwd = absolutePath(workspace, "workspace");
  const values = variantOptions(variant, recipe);
  if (threadId !== undefined && threadId !== null && !UUID_PATTERN.test(threadId)) throw new TypeError("threadId must be an exact UUID");
  return codexArgs({
    approval: values.approval, sandbox: values.sandbox, threadId, finalMessage, model: values.model, reasoningEffort: values.reasoningEffort,
    personality: values.personality, modelVerbosity: values.modelVerbosity, web: values.web, serviceTier: values.serviceTier, cwd,
    live: values.live ? { ...values.live, disabledMcpServers: setup?.disabledMcpServers ?? [] } : null,
  });
}

/**
 * The one argv both planners build. A clean or original run ignores his user
 * config and rules; a live run loads them (that is what live means) and adds
 * only the toggle overrides, with every pin below still winning over his config.
 */
function codexArgs({ approval, sandbox, threadId, finalMessage, model, reasoningEffort, personality, modelVerbosity, web, serviceTier, cwd, live }) {
  const args = ["--ask-for-approval", approval, "--sandbox", sandbox, "exec"];
  if (threadId !== undefined && threadId !== null) {
    if (!UUID_PATTERN.test(threadId)) throw new TypeError("threadId must be an exact UUID");
    args.push("resume", threadId);
  }
  if (!live) args.push("--ignore-user-config", "--ignore-rules", "--strict-config");
  args.push(
    "--skip-git-repo-check",
    "--json",
    "--output-last-message",
    finalMessage,
    "--model",
    model,
    ...config("model_reasoning_effort", reasoningEffort),
    ...config("personality", personality),
    ...config("model_verbosity", modelVerbosity),
    ...config("web_search", web),
    ...config("shell_environment_policy.inherit", "none"),
    ...config("shell_environment_policy.include_only", ["PATH", "LANG", "LC_ALL", "TERM", "TZ"]),
    ...config("service_tier", serviceTier),
  );
  args.push(serviceTier === "fast" ? "--enable" : "--disable", "fast_mode");
  if (live) args.push(...codexLiveOverrides(live));
  if (!threadId) args.push("-C", cwd);
  args.push("-");
  return args;
}

/** Parse a successful Codex JSONL stream and return its one session UUID. */
export function parseCodexJsonl(stdout) {
  if (typeof stdout !== "string") {
    throw new TypeError("stdout must be a string");
  }

  const events = stdout
    .split(/\r?\n/u)
    .filter((line) => line.trim() !== "")
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Invalid Codex JSONL on line ${index + 1}: ${error.message}`);
      }
    });

  const failed = events.find((event) => event?.type === "error" || event?.type === "turn.failed");
  if (failed) {
    const detail = failed.message ?? failed.error?.message ?? failed.type;
    throw new Error(`Codex reported ${failed.type}: ${detail}`);
  }

  const starts = events.filter((event) => event?.type === "thread.started");
  if (starts.length !== 1) {
    throw new Error(`Expected exactly one thread.started event; received ${starts.length}`);
  }

  const threadId = starts[0].thread_id;
  if (!UUID_PATTERN.test(threadId ?? "")) {
    throw new Error("thread.started did not contain a valid thread_id UUID");
  }

  return { events, threadId };
}

function collectProcess(executable, args, options, stdin) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    // In its own process group, so an interruption or the Recipe's time budget stops the tools it started too.
    const child = trackChild(spawn(executable, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      ...DETACHED_CHILD,
    }));
    const budget = killOnBudget(child, options.clock, { group: true });

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      budget.dispose();
      if (!settled) {
        settled = true;
        resolve({ exitCode: null, signal: null, stdout, stderr, spawnError: error, budgetKilled: budget.killed });
      }
    });
    child.on("close", (exitCode, signal) => {
      budget.dispose();
      if (!settled) {
        settled = true;
        resolve({ exitCode, signal, stdout, stderr, spawnError: null, budgetKilled: budget.killed });
      }
    });
    child.stdin.on("error", () => {});
    child.stdin.end(stdin);
  });
}

export class CodexExecutionError extends Error {
  constructor(message, result, options) {
    super(message, options);
    this.name = "CodexExecutionError";
    this.result = result;
  }
}

/** Execute one planned turn, preserving raw process evidence before validation. */
export async function runCodexTurn(options) {
  const plan = planCodexTurn(options);
  await mkdir(path.dirname(plan.paths.stdout), { recursive: true });

  const processResult = await collectProcess(
    plan.executable,
    plan.args,
    { cwd: plan.cwd, env: plan.env, clock: options.clock },
    plan.stdin,
  );
  await Promise.all([
    writeFile(plan.paths.stdout, processResult.stdout, "utf8"),
    writeFile(plan.paths.stderr, processResult.stderr, "utf8"),
  ]);

  const partial = { ...processResult, paths: plan.paths, argv: [plan.executable, ...plan.args] };
  if (processResult.spawnError) {
    throw new CodexExecutionError(
      `Could not start Codex: ${processResult.spawnError.message}`,
      partial,
      { cause: processResult.spawnError },
    );
  }
  if (processResult.budgetKilled) throw new CodexExecutionError(`Codex was stopped by the Recipe's time budget${processResult.signal ? ` (${processResult.signal})` : ""}`, partial);
  if (processResult.exitCode !== 0) {
    throw new CodexExecutionError(
      `Codex exited with code ${processResult.exitCode}${processResult.signal ? ` (${processResult.signal})` : ""}`,
      partial,
    );
  }

  let parsed;
  try {
    parsed = parseCodexJsonl(processResult.stdout);
  } catch (error) {
    throw new CodexExecutionError(error.message, partial, { cause: error });
  }
  if (plan.threadId && parsed.threadId !== plan.threadId) {
    throw new CodexExecutionError(
      `Resumed thread ${plan.threadId}, but Codex reported ${parsed.threadId}`,
      { ...partial, events: parsed.events, threadId: parsed.threadId },
    );
  }

  try {
    await access(plan.paths.finalMessage);
  } catch (error) {
    throw new CodexExecutionError(
      "Codex succeeded without writing the final-message artifact",
      { ...partial, events: parsed.events, threadId: parsed.threadId },
      { cause: error },
    );
  }

  const finalMessage = await readFile(plan.paths.finalMessage, "utf8");
  return {
    ...partial,
    events: parsed.events,
    threadId: parsed.threadId,
    finalMessage,
    serviceTier: plan.serviceTier,
  };
}

/** Run fixed turns sequentially in one fresh persistent Codex session. */
function rawEvents(stdout) {
  if (typeof stdout !== "string") return [];
  return stdout.split(/\r?\n/u).filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

function usageFrom(events) {
  return [...events].reverse().find((event) => event?.usage)?.usage ?? null;
}

/** Run a recipe's fixed turns sequentially in one fresh persistent Codex session. */
export async function runCodexSession({
  variant,
  recipe,
  workspace,
  privateDir,
  codexHome,
  executable = "codex",
  env = {},
  onPlan,
  setup = null,
  clock,
} = {}) {
  const values = variantOptions(variant, recipe);
  if (!Array.isArray(recipe.turns) || recipe.turns.length === 0) {
    throw new TypeError("recipe.turns must be a non-empty array");
  }
  const cwd = absolutePath(workspace, "workspace");
  const root = absolutePath(privateDir, "privateDir");
  // Live runs in his real Codex home, with his real HOME; the attempt's own codex-home is not used.
  const cleanHome = values.live ? codexLiveHome(env) : absolutePath(codexHome, "codexHome");
  await access(cleanHome);
  const home = codexUserHome(variant, cleanHome);
  if (home) await access(home);
  await mkdir(root, { recursive: true });

  const cliVersion = await getCodexVersion({ executable, env, codexHome: cleanHome, home, cwd, live: Boolean(values.live) });
  let threadId = null;
  const turns = [];
  let failure = null;

  for (const [index, turn] of recipe.turns.entries()) {
    const turnId = requiredString(turn?.id, `recipe.turns[${index}].id`);
    const content = requiredString(turn?.content, `recipe.turns[${index}].content`);
    const prompt = index === 0
      ? `${requiredString(recipe.setup?.instructions, "recipe.setup.instructions")}\n\n${content}`
      : content;
    const turnDir = path.join(root, "turns", `${String(index + 1).padStart(3, "0")}-${turnId}`);
    const finalPath = path.join(turnDir, "final.txt");
    const argv = buildCodexTurnArgs({ variant, recipe, workspace: cwd, finalPath, threadId, setup });
    const plan = {
      turnId,
      argv: [executable, ...argv],
      stdin: prompt,
      eventsPath: path.join(turnDir, "stdout.jsonl"),
      stderrPath: path.join(turnDir, "stderr.txt"),
      finalPath,
      threadId,
    };
    if (onPlan) await onPlan(plan);

    try {
      const result = await runCodexTurn({
        prompt,
        threadId,
        ...values,
        live: values.live ? { ...values.live, disabledMcpServers: setup?.disabledMcpServers ?? [] } : null,
        workspace: cwd,
        codexHome: cleanHome,
        home,
        artifactDir: turnDir,
        executable,
        env,
        clock,
      });
      threadId = result.threadId;
      turns.push({
        turnId,
        argv: result.argv,
        eventsPath: result.paths.stdout,
        stderrPath: result.paths.stderr,
        finalPath: result.paths.finalMessage,
        events: result.events,
        finalMessage: result.finalMessage,
        usage: usageFrom(result.events),
      });
    } catch (error) {
      if (!(error instanceof CodexExecutionError)) throw error;
      const events = error.result?.events ?? rawEvents(error.result?.stdout);
      const reportedThread = events.find((event) => event?.type === "thread.started")?.thread_id;
      if (!threadId && UUID_PATTERN.test(reportedThread ?? "")) threadId = reportedThread;
      turns.push({
        turnId,
        argv: error.result?.argv ?? plan.argv,
        eventsPath: error.result?.paths?.stdout ?? plan.eventsPath,
        stderrPath: error.result?.paths?.stderr ?? plan.stderrPath,
        finalPath: error.result?.paths?.finalMessage ?? plan.finalPath,
        events,
        finalMessage: null,
        usage: usageFrom(events),
      });
      const outOfTime = error.result?.budgetKilled === true && await codexServedBeforeBudget({ events, threadId, codexHome: cleanHome, variant, cliVersion });
      failure = {
        turnId,
        message: error.message,
        exitCode: error.result?.exitCode ?? null,
        signal: error.result?.signal ?? null,
        ...(outOfTime ? { chefFault: "out-of-time" } : {}),
      };
      break;
    }
  }

  return { threadId, cliVersion, turns, failure };
}

/** Items the harness itself reports rather than the model producing them. */
const NOT_THE_MODELS_ITEMS = new Set(["error"]);

/**
 * Whether the requested model was serving a turn the Recipe's time budget
 * stopped: the turn's own stream shows an item the model produced (a message,
 * reasoning, a command or edit it asked for), and the private rollout of that
 * thread already records the requested identity, the same check a finished
 * Run gets. Anything less is not the model's.
 */
async function codexServedBeforeBudget({ events, threadId, codexHome, variant, cliVersion }) {
  if (!UUID_PATTERN.test(threadId ?? "")) return false;
  const produced = events.some((event) => ["item.started", "item.completed"].includes(event?.type) && typeof event.item?.type === "string" && !NOT_THE_MODELS_ITEMS.has(event.item.type));
  if (!produced) return false;
  try {
    await verifyObservedIdentity({ codexHome, threadId, variant, cliVersion });
    return true;
  } catch {
    return false;
  }
}

/** Return the exact CLI version string used for collection provenance. */
export async function getCodexVersion({ executable = "codex", env = {}, codexHome, home = null, cwd, live = false } = {}) {
  requiredString(executable, "executable");
  const processEnv = codexHome !== undefined
    ? childEnv(env, absolutePath(codexHome, "codexHome"), home ? absolutePath(home, "home") : null, live)
    : harnessEnv({ env, allow: [...NETWORK_ENV, ...XDG_HOME_ENV] });
  const processResult = await collectProcess(
    executable,
    ["--version"],
    { cwd: cwd ? absolutePath(cwd, "cwd") : process.cwd(), env: processEnv },
    "",
  );
  if (processResult.spawnError) {
    throw new CodexExecutionError(`Could not start Codex: ${processResult.spawnError.message}`, processResult);
  }
  if (processResult.exitCode !== 0) {
    throw new CodexExecutionError(`codex --version exited with code ${processResult.exitCode}`, processResult);
  }
  const version = processResult.stdout.trim();
  if (!version) {
    throw new CodexExecutionError("codex --version returned an empty version", processResult);
  }
  return version;
}

/** Names of the MCP servers his Codex config defines, from Codex itself, so a name in any config layer is found. */
export async function listCodexMcpServers({ executable = "codex", env = {}, cwd } = {}) {
  const home = codexLiveHome(env);
  const result = await collectProcess(requiredString(executable, "executable"), ["mcp", "list", "--json"], { cwd: cwd ? absolutePath(cwd, "cwd") : process.cwd(), env: childEnv(env, home, null, true) }, "");
  const fail = (reason) => new Error(`Cannot list Codex MCP servers (${reason}); connections off cannot be honoured without their names`);
  if (result.spawnError) throw fail(result.spawnError.message);
  if (result.exitCode !== 0) throw fail(`codex mcp list exited with code ${result.exitCode}`);
  let servers;
  try { servers = JSON.parse(result.stdout); }
  catch { throw fail("its output was not JSON"); }
  if (!Array.isArray(servers) || servers.some((server) => typeof server?.name !== "string" || server.name === "")) throw fail("its output was not a list of named servers");
  // `-c` cannot address a server whose name needs quoting; refuse rather than break his config load.
  const unaddressable = servers.map((server) => server.name).filter((name) => !/^[A-Za-z0-9_-]+$/u.test(name));
  if (unaddressable.length) throw fail(`server name ${unaddressable.map((name) => JSON.stringify(name)).join(", ")} cannot be named in a -c override`);
  return servers.map((server) => server.name).sort();
}

/**
 * The files of his Codex setup that speak to the model, for the receipt's "at start" digest:
 * AGENTS.md, rules, skills and (memory on) memories. Not config.toml, which Codex rewrites
 * (its trust list grows with every workspace). Null when the setup is too large to hash.
 */
export async function liveCodexDigest({ variant, env = {} } = {}) {
  const home = codexLiveHome(env);
  const budget = createSetupBudget();
  try {
    const files = [];
    for (const name of ["AGENTS.md", "AGENTS.override.md"]) files.push(...await collectSetupFile(path.join(home, name), name, budget));
    files.push(...await collectSetupChildren(path.join(home, "rules"), "rules", budget));
    files.push(...await collectSetupChildren(path.join(home, "skills"), "skills", budget));
    if (toggleOn(variant, "memory")) files.push(...await collectSetupChildren(path.join(home, "memories"), "memories", budget));
    return setupDigest(files);
  } catch (error) {
    if (/Snapshot would copy/u.test(error.message)) return null;
    throw error;
  }
}

/**
 * Prepare a live attempt: nothing is created or copied. His real home must hold a login, and with
 * connections off the MCP servers his config defines are listed so each can be switched off by name.
 */
export async function prepareCodexLiveAttempt({ variant, executable = "codex", env = {}, cwd } = {}) {
  const home = codexLiveHome(env);
  const auth = await stat(path.join(home, "auth.json")).catch(() => null);
  if (!auth?.isFile()) throw new Error(`Codex live runs use his real login, but ${path.join(home, "auth.json")} is absent; log in to Codex before cooking`);
  const { memory, connections } = variant.executionProfile;
  const disabledMcpServers = connections === "off" ? await listCodexMcpServers({ executable, env, cwd }) : [];
  const digestAtStart = await liveCodexDigest({ variant, env });
  return { setup: { environment: "live", memory, connections, home: "real", ...(digestAtStart ? { digestAtStart } : {}), ...(connections === "off" ? { disabledMcpServers } : {}) } };
}

export function codexRequestedExecution(variant) {
  if (!isLiveCodex(variant)) return { codexHome: "fresh-per-attempt", home: variant.executionProfile.environment === "clean" ? "fresh-per-attempt" : "inherited" };
  const { memory, connections } = variant.executionProfile;
  return {
    codexHome: "real-home",
    home: "real",
    setup: "real ~/.codex and HOME as they are: AGENTS.md, rules, skills, config.toml; sessions, history and logs are written to it",
    configOverrides: "pins only; his config.toml is loaded",
    memory: memory === "off" ? "forced off" : "as his config has it, writes kept",
    connections: connections === "off" ? "plugins, apps and each MCP server his config names are switched off" : "as his config has them",
  };
}
