import { spawn } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

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

function isLuna(model) {
  return /(?:^|[-_/])luna(?:$|[-_/])/i.test(model);
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
  artifactDir,
  executable = "codex",
  env = {},
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
  if (isLuna(model) && pinnedTier !== "fast") throw new Error("Luna tasting variants must explicitly request the fast service tier");

  // Approval is a top-level Codex flag in CLI 0.145.0. Putting it after
  // `exec` is rejected by the parser. Sandbox is also pinned globally so the
  // same policy applies to resume, whose subcommand has no --sandbox option.
  const args = ["--ask-for-approval", approval, "--sandbox", sandbox, "exec"];
  if (threadId) args.push("resume", threadId);
  args.push(
    "--ignore-user-config",
    "--ignore-rules",
    "--strict-config",
    "--skip-git-repo-check",
    "--json",
    "--output-last-message",
    paths.finalMessage,
    "--model",
    model,
    ...config("model_reasoning_effort", reasoningEffort),
    ...config("personality", personality),
    ...config("model_verbosity", modelVerbosity),
    ...config("web_search", web),
    ...config("shell_environment_policy.inherit", "none"),
    ...config("shell_environment_policy.include_only", ["PATH", "LANG", "LC_ALL", "TERM", "TZ"]),
    ...config("service_tier", pinnedTier),
  );
  if (isLuna(model)) args.push("--enable", "fast_mode");
  if (!threadId) args.push("-C", cwd);
  args.push("-");

  return {
    executable,
    args,
    cwd,
    env: { ...process.env, ...env, CODEX_HOME: cleanHome },
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
export function buildCodexTurnArgs({ variant, recipe, workspace, finalPath, threadId } = {}) {
  const finalMessage = absolutePath(finalPath, "finalPath");
  const cwd = absolutePath(workspace, "workspace");
  const values = variantOptions(variant, recipe);
  if (isLuna(values.model) && values.serviceTier !== "fast") throw new Error("Luna tasting variants must explicitly request the fast service tier");
  const args = ["--ask-for-approval", values.approval, "--sandbox", values.sandbox, "exec"];
  if (threadId !== undefined && threadId !== null) {
    if (!UUID_PATTERN.test(threadId)) throw new TypeError("threadId must be an exact UUID");
    args.push("resume", threadId);
  }
  args.push(
    "--ignore-user-config",
    "--ignore-rules",
    "--strict-config",
    "--skip-git-repo-check",
    "--json",
    "--output-last-message",
    finalMessage,
    "--model",
    values.model,
    ...config("model_reasoning_effort", values.reasoningEffort),
    ...config("personality", values.personality),
    ...config("model_verbosity", values.modelVerbosity),
    ...config("web_search", values.web),
    ...config("shell_environment_policy.inherit", "none"),
    ...config("shell_environment_policy.include_only", ["PATH", "LANG", "LC_ALL", "TERM", "TZ"]),
    ...config("service_tier", values.serviceTier),
  );
  if (isLuna(values.model)) args.push("--enable", "fast_mode");
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
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      if (!settled) {
        settled = true;
        resolve({ exitCode: null, signal: null, stdout, stderr, spawnError: error });
      }
    });
    child.on("close", (exitCode, signal) => {
      if (!settled) {
        settled = true;
        resolve({ exitCode, signal, stdout, stderr, spawnError: null });
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
    { cwd: plan.cwd, env: plan.env },
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
} = {}) {
  const values = variantOptions(variant, recipe);
  if (!Array.isArray(recipe.turns) || recipe.turns.length === 0) {
    throw new TypeError("recipe.turns must be a non-empty array");
  }
  const cwd = absolutePath(workspace, "workspace");
  const root = absolutePath(privateDir, "privateDir");
  const cleanHome = absolutePath(codexHome, "codexHome");
  await access(cleanHome);
  await mkdir(root, { recursive: true });

  const cliVersion = await getCodexVersion({ executable, env, codexHome: cleanHome, cwd });
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
    const argv = buildCodexTurnArgs({ variant, recipe, workspace: cwd, finalPath, threadId });
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
        workspace: cwd,
        codexHome: cleanHome,
        artifactDir: turnDir,
        executable,
        env,
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
      failure = {
        turnId,
        message: error.message,
        exitCode: error.result?.exitCode ?? null,
        signal: error.result?.signal ?? null,
      };
      break;
    }
  }

  return { threadId, cliVersion, turns, failure };
}

/** Return the exact CLI version string used for collection provenance. */
export async function getCodexVersion({ executable = "codex", env = {}, codexHome, cwd } = {}) {
  requiredString(executable, "executable");
  const processEnv = { ...process.env, ...env };
  if (codexHome !== undefined) {
    processEnv.CODEX_HOME = absolutePath(codexHome, "codexHome");
  }
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
