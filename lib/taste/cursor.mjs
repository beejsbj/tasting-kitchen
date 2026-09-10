import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function requiredString(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} must be a non-empty string`);
  return value;
}

function absolutePath(value, name) {
  requiredString(value, name);
  if (!path.isAbsolute(value)) throw new TypeError(`${name} must be an absolute path`);
  return path.normalize(value);
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

export class CursorExecutionError extends Error {
  constructor(message, result, options) {
    super(message, options);
    this.name = "CursorExecutionError";
    this.result = result;
  }
}

export function cursorTurnEvidence(events, { threadId } = {}) {
  const inits = events.filter((event) => event?.type === "system" && event?.subtype === "init");
  if (inits.length === 0 || !UUID_PATTERN.test(inits[0]?.session_id ?? "")) throw new Error("Cursor init event did not contain a valid session UUID");
  if (inits.length !== 1) throw new Error(`Cursor stream contained ${inits.length} init events; expected exactly one`);
  const results = events.filter((event) => event?.type === "result");
  if (results.length !== 1) throw new Error(`Cursor stream contained ${results.length} final result events; expected exactly one`);
  const result = results[0];
  if (result.subtype !== "success" || typeof result.result !== "string") throw new Error("Cursor succeeded without one final result event");
  if (result.session_id !== inits[0].session_id) throw new Error("Cursor result session did not match its init session");
  if (threadId !== undefined && (inits[0].session_id !== threadId || result.session_id !== threadId)) throw new Error(`Cursor turn session did not match result thread ${threadId}`);
  return { init: inits[0], result };
}

export function parseCursorJsonl(stdout) {
  if (typeof stdout !== "string") throw new TypeError("stdout must be a string");
  const events = stdout.split(/\r?\n/u).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); }
    catch (error) { throw new Error(`Invalid Cursor JSONL on line ${index + 1}: ${error.message}`); }
  });
  const failure = events.find((event) => event?.type === "error" || (event?.type === "result" && event.is_error));
  if (failure) throw new Error(`Cursor reported failure: ${failure.result ?? failure.message ?? failure.subtype ?? failure.type}`);
  const { init, result } = cursorTurnEvidence(events);
  return { events, threadId: init.session_id, model: requiredString(init.model, "Cursor observed model"), finalMessage: result.result, usage: result.usage ?? null };
}

export function buildCursorTurnArgs({ variant, workspace, prompt, threadId } = {}) {
  if (!variant || variant.harness !== "cursor-agent") throw new Error("Cursor adapter requires a cursor-agent configuration");
  if (variant.executionProfile?.sandbox !== "disabled") throw new Error("Cursor execution profile must declare sandbox disabled");
  if (variant.executionProfile?.approvalPolicy !== "force") throw new Error("Cursor execution profile must declare force approval");
  const args = ["--print", "--output-format", "stream-json", "--trust", "--force", "--sandbox", "disabled", "--model", requiredString(variant.model, "variant.model"), "--workspace", absolutePath(workspace, "workspace")];
  if (threadId !== undefined && threadId !== null) {
    if (!UUID_PATTERN.test(threadId)) throw new TypeError("threadId must be an exact UUID");
    args.push("--resume", threadId);
  }
  args.push(requiredString(prompt, "prompt"));
  return args;
}

export async function getCursorVersion({ executable = "cursor-agent", env = {}, cwd } = {}) {
  const result = await collectProcess(requiredString(executable, "executable"), ["--version"], { cwd: cwd ? absolutePath(cwd, "cwd") : process.cwd(), env: { ...process.env, ...env } });
  if (result.spawnError) throw new CursorExecutionError(`Could not start Cursor: ${result.spawnError.message}`, result, { cause: result.spawnError });
  if (result.exitCode !== 0) throw new CursorExecutionError(`cursor-agent --version exited with code ${result.exitCode}`, result);
  const version = result.stdout.trim();
  if (!version) throw new CursorExecutionError("cursor-agent --version returned an empty version", result);
  return `cursor-agent ${version}`;
}

async function runCursorTurn({ variant, workspace, artifactDir, prompt, threadId, executable = "cursor-agent", env = {} }) {
  const args = buildCursorTurnArgs({ variant, workspace, prompt, threadId });
  const paths = { stdout: path.join(artifactDir, "stdout.jsonl"), stderr: path.join(artifactDir, "stderr.txt"), finalMessage: path.join(artifactDir, "final.txt") };
  await mkdir(artifactDir, { recursive: true });
  const result = await collectProcess(executable, args, { cwd: workspace, env: { ...process.env, ...env } });
  await Promise.all([writeFile(paths.stdout, result.stdout, "utf8"), writeFile(paths.stderr, result.stderr, "utf8")]);
  const partial = { ...result, paths, argv: [executable, ...args] };
  if (result.spawnError) throw new CursorExecutionError(`Could not start Cursor: ${result.spawnError.message}`, partial, { cause: result.spawnError });
  if (result.exitCode !== 0) throw new CursorExecutionError(`Cursor exited with code ${result.exitCode}${result.signal ? ` (${result.signal})` : ""}`, partial);
  let parsed;
  try { parsed = parseCursorJsonl(result.stdout); }
  catch (error) { throw new CursorExecutionError(error.message, partial, { cause: error }); }
  if (threadId && parsed.threadId !== threadId) throw new CursorExecutionError(`Resumed session ${threadId}, but Cursor reported ${parsed.threadId}`, { ...partial, ...parsed });
  await writeFile(paths.finalMessage, parsed.finalMessage, "utf8");
  return { ...partial, ...parsed };
}

export async function runCursorSession({ variant, recipe, workspace, privateDir, executable = "cursor-agent", env = {}, onPlan } = {}) {
  if (!Array.isArray(recipe?.turns) || recipe.turns.length === 0) throw new TypeError("recipe.turns must be a non-empty array");
  const cwd = absolutePath(workspace, "workspace");
  const root = absolutePath(privateDir, "privateDir");
  await mkdir(root, { recursive: true });
  const cliVersion = await getCursorVersion({ executable, env, cwd });
  let threadId = null;
  let observedModel = null;
  const turns = [];
  let failure = null;
  for (const [index, turn] of recipe.turns.entries()) {
    const turnId = requiredString(turn?.id, `recipe.turns[${index}].id`);
    const content = requiredString(turn?.content, `recipe.turns[${index}].content`);
    const prompt = index === 0 ? `${requiredString(recipe.setup?.instructions, "recipe.setup.instructions")}\n\n${content}` : content;
    const turnDir = path.join(root, "turns", `${String(index + 1).padStart(3, "0")}-${turnId}`);
    const plan = { turnId, argv: [executable, ...buildCursorTurnArgs({ variant, workspace: cwd, prompt, threadId })], eventsPath: path.join(turnDir, "stdout.jsonl"), stderrPath: path.join(turnDir, "stderr.txt"), finalPath: path.join(turnDir, "final.txt"), threadId };
    if (onPlan) await onPlan(plan);
    try {
      const result = await runCursorTurn({ variant, workspace: cwd, artifactDir: turnDir, prompt, threadId, executable, env });
      if (!cursorModelsEquivalent(result.model, variant.model)) {
        throw new CursorExecutionError(`Effective Cursor model mismatch: requested ${variant.model}, observed ${result.model}`, result);
      }
      threadId = result.threadId;
      observedModel = result.model;
      turns.push({ turnId, argv: result.argv, eventsPath: result.paths.stdout, stderrPath: result.paths.stderr, finalPath: result.paths.finalMessage, events: result.events, finalMessage: result.finalMessage, usage: result.usage });
    } catch (error) {
      if (!(error instanceof CursorExecutionError)) throw error;
      turns.push({ turnId, argv: error.result?.argv ?? plan.argv, eventsPath: error.result?.paths?.stdout ?? plan.eventsPath, stderrPath: error.result?.paths?.stderr ?? plan.stderrPath, finalPath: error.result?.paths?.finalMessage ?? plan.finalPath, events: [], finalMessage: null, usage: null });
      failure = { turnId, message: error.message, exitCode: error.result?.exitCode ?? null, signal: error.result?.signal ?? null };
      break;
    }
  }
  return { threadId, cliVersion, observedModel, turns, failure };
}

export function normalizedCursorModel(value) {
  return String(value).replace(/\[.*\]$/u, "").replace(/[^a-z0-9]+/giu, "").toLowerCase();
}

export function cursorModelsEquivalent(left, right) {
  return normalizedCursorModel(left) === normalizedCursorModel(right);
}

export function assertCursorModelInvocation(argv, expectedModel) {
  if (!Array.isArray(argv)) throw new Error("Cursor identity requires recorded argv for every turn");
  const selectors = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") break;
    if (arg === "--model" || arg === "-m") {
      const value = argv[++index];
      if (typeof value !== "string" || value.length === 0) throw new Error("Cursor argv has a model selector without a value");
      selectors.push(value);
    } else if (typeof arg === "string" && arg.startsWith("--model=")) selectors.push(arg.slice(8));
    else if (typeof arg === "string" && arg.startsWith("-m") && arg.length > 2) selectors.push(arg.slice(2));
  }
  if (selectors.length !== 1 || selectors[0] !== expectedModel) throw new Error(`Cursor argv must contain exactly one --model ${expectedModel} selector`);
}

export async function verifyCursorIdentity({ variant, result, cliVersion }) {
  if (result?.failure) throw new Error("Cursor execution contains a failed turn");
  if (!result?.observedModel) throw new Error("Cursor stream lacks the observed model");
  if (!Array.isArray(result.turns) || result.turns.length === 0) throw new Error("Cursor identity requires observed evidence for every turn");
  for (const turn of result.turns) {
    const evidence = cursorTurnEvidence(turn.events ?? [], { threadId: result.threadId });
    const observed = evidence.init.model;
    if (!observed || !cursorModelsEquivalent(observed, variant.model)) {
      throw new Error(`Effective Cursor model mismatch in turn ${turn.turnId}: requested ${variant.model}, observed ${observed ?? "missing"}`);
    }
    assertCursorModelInvocation(turn.argv, variant.model);
  }
  if (!cursorModelsEquivalent(result.observedModel, variant.model)) throw new Error(`Effective Cursor model mismatch: requested ${variant.model}, observed ${result.observedModel}`);
  if (!String(variant.model).includes("fast=false")) throw new Error("Cursor configuration does not pin non-fast execution");
  if (result.cliVersion !== cliVersion) throw new Error(`Cursor CLI evidence mismatch: ${cliVersion} versus ${result.cliVersion}`);
  return {
    model: result.observedModel,
    provider: variant.provider,
    reasoningEffort: variant.reasoningEffort,
    personality: variant.personality,
    serviceTier: variant.serviceTier,
    requestedServiceTier: variant.serviceTier,
    serviceTierEvidence: "pinned-fast-false-argv",
    verifiedBy: "cursor-init-event-and-pinned-argv",
  };
}
