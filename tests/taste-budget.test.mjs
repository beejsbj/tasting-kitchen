import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { BudgetExpired, claudeReportedWaitMs, recipeBudget, startBudgetClock } from "../lib/taste/budget.mjs";
import { computeConfigHash, computeRecipeHash, sha256 } from "../lib/taste/catalog.mjs";
import { CLAUDE_CODE_TOOLS, buildClaudeTurnArgs, claudeChefFault } from "../lib/taste/claude-code.mjs";
import { runDirectApiSession } from "../lib/taste/direct-api.mjs";
import { CHEF_FAULTS, classifyFailure, KITCHEN_FAULTS } from "../lib/taste/faults.mjs";
import { compatibilityFor } from "../lib/taste/harness-adapters.mjs";
import { loadNoDishes, validateNoDish } from "../lib/taste/no-dishes.mjs";
import { executeRecipe } from "../lib/taste/runner.mjs";

// ---------------------------------------------------------------------------
// The declared budget and the recipe hash

const baseRecipe = () => ({
  schemaVersion: 1, id: "demo-session", version: "1.0.0", status: "ready", title: "A demo session recipe", summary: "A sufficiently detailed demo for budget testing.",
  origin: "textbook", originNote: "A budget integration test.", tags: ["presence"], kind: "session",
  harness: { workspace: "read", web: "disabled", capabilities: [] },
  setup: { instructions: "Read the mounted public context.", fixtures: [{ id: "context", path: "fixtures/context.txt", mountAs: "inputs/context.txt", public: true, mediaType: "text/plain" }] },
  turns: [{ id: "opening", role: "prompt", content: "Respond once." }, { id: "correction", role: "correction", content: "Now respond more directly." }],
  output: { kind: "session", entry: "output/session.json", include: ["output/session.json"], limits: { maxFiles: 2, maxBytes: 32768 } },
  validation: { mode: "completeness", checks: [{ id: "entry", type: "file-exists", required: true, description: "The transcript exists.", target: "output/session.json" }] },
  sourcePath: "catalog/recipes/conversation/demo/recipe.json",
  fixtureHashes: { context: sha256("public context\n") },
});

test("a declared budget joins the recipe hash; a Recipe without one keeps its hash", () => {
  const plain = baseRecipe();
  const hash = computeRecipeHash(plain, plain.fixtureHashes);
  assert.equal(computeRecipeHash({ ...plain, budget: undefined }, plain.fixtureHashes), hash, "no budget, no change");
  const timed = computeRecipeHash({ ...plain, budget: { seconds: 600 } }, plain.fixtureHashes);
  const turned = computeRecipeHash({ ...plain, budget: { seconds: 600, modelTurns: 40 } }, plain.fixtureHashes);
  assert.notEqual(timed, hash);
  assert.notEqual(turned, timed, "changing a budget makes a new cell");
  // Display metadata still does not move it.
  assert.equal(computeRecipeHash({ ...plain, budget: { seconds: 600 }, title: "Renamed recipe" }, plain.fixtureHashes), timed);
});

test("a budget declares whole seconds and model turns within bounds, and nothing else", () => {
  assert.equal(recipeBudget({}), null);
  assert.deepEqual(recipeBudget({ budget: { seconds: 600 } }), { seconds: 600 });
  assert.deepEqual(recipeBudget({ budget: { modelTurns: 40 } }), { modelTurns: 40 });
  assert.throws(() => recipeBudget({ budget: {} }), /at least one/);
  assert.throws(() => recipeBudget({ budget: { seconds: 5 } }), /seconds must be an integer from 30/);
  assert.throws(() => recipeBudget({ budget: { seconds: 60.5 } }), /seconds/);
  assert.throws(() => recipeBudget({ budget: { modelTurns: 0 } }), /modelTurns/);
  assert.throws(() => recipeBudget({ budget: { minutes: 10 } }), /unknown key minutes/);
  assert.throws(() => recipeBudget({ budget: [600] }), /must be an object/);
});

// ---------------------------------------------------------------------------
// The clock

test("the clock aborts once the declared time has passed, credits reported waits, and records what it spent", () => {
  let now = 0;
  let pending = null;
  const clock = startBudgetClock({ seconds: 10, now: () => now, setTimer: (fn, ms) => { pending = { fn, at: now + ms }; return 1; }, clearTimer: () => { pending = null; } });
  const advance = (to) => { now = to; while (pending && pending.at <= now) { const { fn } = pending; pending = null; fn(); } };
  clock.resume();
  advance(9_000);
  clock.credit(5_000); // a 5 s rate-limit wait the harness reported
  advance(12_000);
  assert.equal(clock.expired, false, "credited time is not the model's");
  advance(14_999);
  assert.equal(clock.expired, false);
  advance(15_000);
  assert.equal(clock.expired, true);
  clock.credit(60_000);
  assert.deepEqual(clock.stop(), { seconds: 10, elapsedMs: 15_000, creditedMs: 5_000, expired: true }, "a credit after the budget ran out changes nothing");
});

test("the clock runs only while a harness or request is running: startup and Kitchen's work between turns are not the model's", () => {
  let now = 0;
  let pending = null;
  const clock = startBudgetClock({ seconds: 10, now: () => now, setTimer: (fn, ms) => { pending = { fn, at: now + ms }; return 1; }, clearTimer: () => { pending = null; } });
  const advance = (to) => { now = to; while (pending && pending.at <= now) { const { fn } = pending; pending = null; fn(); } };
  advance(60_000); // a version probe, a scratch server starting: the clock has not started
  assert.equal(clock.expired, false);
  clock.resume(); // the first turn's harness starts
  advance(66_000);
  clock.pause(); // the turn ends; Kitchen writes its files and reads the harness's records
  advance(200_000);
  assert.equal(clock.expired, false, "paused time is not the model's");
  clock.resume(); // the second turn
  advance(203_999);
  assert.equal(clock.expired, false);
  advance(204_000);
  assert.equal(clock.expired, true, "6 s + 4 s of running time spends the 10 s budget");
  assert.deepEqual(clock.stop(), { seconds: 10, elapsedMs: 10_000, creditedMs: 0, expired: true });
});

test("the real clock aborts with BudgetExpired, and a clock with no seconds never does", async () => {
  const clock = startBudgetClock({ seconds: 0.05 });
  clock.resume();
  await new Promise((resolve) => clock.signal.addEventListener("abort", resolve, { once: true }));
  assert.ok(clock.signal.reason instanceof BudgetExpired);
  assert.equal(clock.stop().expired, true);
  const open = startBudgetClock({});
  open.resume();
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(open.expired, false);
  assert.deepEqual(Object.keys(open.stop()), ["elapsedMs", "creditedMs", "expired"]);
});

test("Claude Code's reported retry and no-response waits are credited; nothing else is", () => {
  assert.equal(claudeReportedWaitMs({ type: "system", subtype: "api_retry", retry_delay_ms: 1500, error_status: 429 }), 1500);
  assert.equal(claudeReportedWaitMs({ type: "system", subtype: "api_retry", retry_delay_ms: 500, no_response: { waited_ms: 60_000 } }), 60_500);
  assert.equal(claudeReportedWaitMs({ type: "system", subtype: "init" }), 0);
  assert.equal(claudeReportedWaitMs({ type: "system", subtype: "api_retry", retry_delay_ms: "soon" }), 0);
});

// ---------------------------------------------------------------------------
// Classification

test("out-of-time is a chef fault only by tag; a limit nobody declared is Kitchen's and names itself", () => {
  assert.deepEqual(classifyFailure({ chefFault: "out-of-time" }), { class: "chef", code: "out-of-time", stage: "execution", reason: CHEF_FAULTS["out-of-time"], retryable: false });
  const limit = classifyFailure({ message: "Claude Code reported failure: error_max_turns", kitchenFault: "harness-limit", limit: "Claude Code max turns" });
  assert.deepEqual(limit, { class: "kitchen", code: "harness-limit", stage: "execution", reason: KITCHEN_FAULTS["harness-limit"], retryable: true, limit: "Claude Code max turns" });
  assert.equal(classifyFailure({ message: "The Recipe's time budget of 600 s ran out" }).class, "kitchen", "a message never makes a chef fault");
});

const claudeModel = "claude-opus-5-5";
const jsonl = (...events) => events.map((event) => JSON.stringify(event)).join("\n");
const sessionId = "11111111-1111-4111-8111-111111111111";
const init = { type: "system", subtype: "init", model: claudeModel, permissionMode: "bypassPermissions", cwd: "/attempt/workspace", tools: [...CLAUDE_CODE_TOOLS], mcp_servers: [], session_id: sessionId, claude_code_version: "2.1.312", output_style: "default", plugins: [], skills: [], agents: [] };
const spoke = { type: "assistant", message: { model: claudeModel, content: [{ type: "text", text: "Working." }] } };
const spent = { type: "result", subtype: "error_max_turns", is_error: true };
const claudeOptions = { variant: { model: claudeModel, personality: "default", serviceTier: "default", executionProfile: { environment: "clean" } }, workspaces: ["/attempt/workspace"], cliVersion: "claude-code 2.1.312" };

test("Claude Code's exhausted turns are the model's only when Kitchen set the turn budget", () => {
  assert.equal(claudeChefFault(jsonl(init, spoke, spent), { ...claudeOptions, turnBudget: 40 }), "out-of-turns");
  assert.equal(claudeChefFault(jsonl(init, spoke, spent), claudeOptions), undefined, "a limit nobody set for the Run is not the model's");
});

test("Claude Code ran out of time only with an expired budget and the requested model's own message in the killed turn", () => {
  const timedOut = { ...claudeOptions, timeExpired: true };
  assert.equal(claudeChefFault(jsonl(init, spoke), timedOut), "out-of-time");
  assert.equal(claudeChefFault(jsonl(init), timedOut), undefined, "no model reply: the route may never have answered");
  assert.equal(claudeChefFault(jsonl(init, spoke), claudeOptions), undefined, "killed by something other than the budget");
  assert.equal(claudeChefFault(jsonl({ ...init, model: "claude-sonnet-5-5" }, { ...spoke, message: { ...spoke.message, model: "claude-sonnet-5-5" } }), timedOut), undefined, "another model's Run");
  assert.equal(claudeChefFault(jsonl(init, { ...spoke, parent_tool_use_id: "toolu_1" }), timedOut), undefined, "only a subagent spoke");
  assert.equal(claudeChefFault(jsonl(init, spoke, { type: "result", subtype: "success", is_error: false }), timedOut), undefined, "the turn had finished; only the process lingered");
});

test("Kitchen pins --max-turns only when the Recipe declares a turn budget", () => {
  const variant = claudeVariant();
  const options = { variant, workspace: "/var/tmp/tk/ws", harnessHome: "/var/tmp/tk/home", prompt: "Cook" };
  assert.equal(buildClaudeTurnArgs(options).includes("--max-turns"), false);
  const args = buildClaudeTurnArgs({ ...options, maxTurns: 40 });
  assert.equal(args[args.indexOf("--max-turns") + 1], "40");
  assert.ok(args.indexOf("--max-turns") < args.indexOf("--"), "the flag precedes the prompt separator");
});

// ---------------------------------------------------------------------------
// Compatibility: a turn budget only where the harness can hold it

const codexVariant = {
  id: "codex-sol-high", label: "Sol high", provider: "openai", model: "gpt-5.6-sol", harness: "codex-cli", reasoningEffort: "high", serviceTier: "default", personality: "none", capabilities: ["files", "shell"],
  executionProfile: { id: "codex-linux-host-unsandboxed-v1", label: "via Codex CLI · host-unsandboxed fallback", runtime: "linux-host", sandbox: "danger-full-access", approvalPolicy: "never", nativeWeb: "disabled", networkPolicy: "not-enforced", filesystemBoundary: "not-a-secrecy-boundary" },
  configHash: `sha256:${"3".repeat(64)}`,
};

test("a turn budget is offered only to harnesses that hold it; a time budget to every one", () => {
  const recipe = baseRecipe();
  assert.equal(compatibilityFor({ variant: claudeVariant(), recipe: { ...recipe, budget: { modelTurns: 40 } } }).supported, true);
  const codex = compatibilityFor({ variant: codexVariant, recipe: { ...recipe, budget: { modelTurns: 40 } } });
  assert.equal(codex.supported, false);
  assert.match(codex.reasons.join("; "), /codex-cli cannot hold a Recipe's model-turn budget/);
  assert.equal(compatibilityFor({ variant: codexVariant, recipe: { ...recipe, budget: { seconds: 600 } } }).supported, true);
});

// ---------------------------------------------------------------------------
// The runner: the same budget, classified fairly

async function fixture({ budget, variant = codexVariant } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "taste-budget-"));
  const recipeDir = path.join(root, "catalog/recipes/conversation/demo");
  await mkdir(path.join(recipeDir, "fixtures"), { recursive: true });
  await writeFile(path.join(recipeDir, "fixtures/context.txt"), "public context\n");
  const authPath = path.join(root, "source-auth.json");
  await writeFile(authPath, "{}\n", { mode: 0o600 });
  const recipe = { ...baseRecipe(), ...(budget ? { budget } : {}) };
  recipe.recipeHash = computeRecipeHash(recipe, recipe.fixtureHashes);
  return { root, recipe, variant, authPath, catalog: { catalogHash: `sha256:${"4".repeat(64)}`, recipes: [recipe] } };
}

const observed = async () => ({ model: "gpt-5.6-sol", provider: "openai", reasoningEffort: "high", serviceTier: "default", verifiedBy: "test" });
// The test clock: the declared budget, run at a fraction of a second.
const quickClock = (seconds = 0.15) => (options) => startBudgetClock({ ...options, seconds: options.seconds === undefined ? undefined : seconds });

async function cook(f, t, options) {
  t.after(() => rm(f.root, { recursive: true, force: true }));
  return executeRecipe({ repoRoot: f.root, catalog: f.catalog, recipe: f.recipe, variant: f.variant, now: new Date("2026-11-09T12:00:00.000Z"), nonce: "fixed", authPath: f.authPath, verifyIdentity: observed, ...options });
}

const failedTurn = (message, extra = {}) => ({
  threadId: "01901234-5678-7abc-8def-0123456789ab", cliVersion: "codex-cli 9.9.9-fake",
  failure: { turnId: "opening", message, exitCode: null, signal: "SIGKILL", ...extra },
  turns: [{ finalMessage: null, usage: null, events: [] }],
});

test("the session receives the declared budget and the clock; time spent before and after the session is not counted", async (t) => {
  const f = await fixture({ budget: { seconds: 600 } });
  let seen;
  const result = await cook(f, t, {
    budgetClock: quickClock(5),
    runSession: async ({ budget, clock }) => {
      seen = { budget, aborted: clock.signal.aborted };
      return { threadId: "01901234-5678-7abc-8def-0123456789ab", cliVersion: "codex-cli 9.9.9-fake", failure: null, turns: [{ finalMessage: "One.", usage: null, events: [] }, { finalMessage: "Two.", usage: null, events: [] }] };
    },
  });
  assert.equal(result.status, "accepted", result.error);
  assert.deepEqual(seen, { budget: { seconds: 600 }, aborted: false });
  const execution = JSON.parse(await readFile(path.join(f.root, "private/runtime/attempts", result.attemptId, "execution.json"), "utf8"));
  assert.equal(execution.budget.seconds, 600);
  assert.equal(execution.budget.expired, false);
  assert.equal(typeof execution.budget.elapsedMs, "number");
  const requested = JSON.parse(await readFile(path.join(f.root, "private/runtime/attempts", result.attemptId, "requested.json"), "utf8"));
  assert.deepEqual(requested.recipe.budget, { seconds: 600 });
});

test("an expired time budget with the adapter's evidence is a chef fault, published as a No Dish that names its budget", async (t) => {
  const f = await fixture({ budget: { seconds: 600 } });
  const result = await cook(f, t, {
    budgetClock: quickClock(),
    runSession: async ({ clock }) => {
      clock.resume(); // as an adapter does when its harness starts
      await new Promise((resolve) => clock.signal.addEventListener("abort", resolve, { once: true }));
      return failedTurn("codex-cli was stopped by the Recipe's time budget", { chefFault: "out-of-time" });
    },
  });
  assert.equal(result.fault.class, "chef");
  assert.equal(result.fault.code, "out-of-time");
  const manifest = JSON.parse(await readFile(path.join(f.root, "no-dishes", result.noDishId, "no-dish.json"), "utf8"));
  assert.deepEqual(manifest.fault, { class: "chef", code: "out-of-time", stage: "execution", reason: CHEF_FAULTS["out-of-time"], turn: "opening", budget: { seconds: 600 } });
  const loaded = await loadNoDishes(f.root);
  assert.equal(loaded.length, 1, "the loader accepts a budget on a budget fault");
  const directory = path.join(f.root, "no-dishes", result.noDishId);
  const unnamed = { ...manifest.fault };
  delete unnamed.budget;
  await assert.rejects(validateNoDish(directory, { ...manifest, fault: unnamed }), /out-of-time fault must name the time budget/);
  await assert.rejects(validateNoDish(directory, { ...manifest, fault: { ...manifest.fault, budget: { modelTurns: 40 } } }), /fault\.budget must name only the seconds budget/);
});

test("an expired time budget without evidence that the requested model was serving stays Kitchen's", async (t) => {
  const f = await fixture({ budget: { seconds: 600 } });
  const result = await cook(f, t, {
    budgetClock: quickClock(),
    runSession: async ({ clock }) => {
      clock.resume(); // as an adapter does when its harness starts
      await new Promise((resolve) => clock.signal.addEventListener("abort", resolve, { once: true }));
      return failedTurn("Codex exited with code null (SIGKILL)");
    },
  });
  assert.equal(result.fault.class, "kitchen");
  assert.equal(result.fault.code, "timeout");
  assert.match(result.fault.limit, /time budget of 600 s/);
  assert.equal(result.noDishId, undefined);
});

test("an adapter cannot claim out-of-time before the budget ran out, or out-of-turns when no turn budget was declared", async (t) => {
  const early = await fixture({ budget: { seconds: 600 } });
  const premature = await cook(early, t, { budgetClock: quickClock(5), runSession: async () => failedTurn("stopped", { chefFault: "out-of-time" }) });
  assert.equal(premature.fault.class, "kitchen");
  assert.equal(premature.noDishId, undefined);

  const unbudgeted = await fixture();
  const turns = await cook(unbudgeted, t, { runSession: async () => failedTurn("Claude Code reported failure: error_max_turns", { chefFault: "out-of-turns" }) });
  assert.deepEqual({ class: turns.fault.class, code: turns.fault.code }, { class: "kitchen", code: "harness-limit" });
  assert.equal(turns.noDishId, undefined, "a limit nobody set for the Run never stains the model");
});

test("a harness's own limit firing first is a kitchen fault that names the limit", async (t) => {
  const f = await fixture({ budget: { seconds: 600 } });
  const result = await cook(f, t, { budgetClock: quickClock(5), runSession: async () => failedTurn("T3 turn timeout ended the turn", { kitchenFault: "harness-limit", limit: "T3 turn timeout (3600000 ms)" }) });
  assert.deepEqual({ class: result.fault.class, code: result.fault.code, limit: result.fault.limit }, { class: "kitchen", code: "harness-limit", limit: "T3 turn timeout (3600000 ms)" });
});

test("a turn budget the harness cannot hold refuses the Run before anything starts", async (t) => {
  const f = await fixture({ budget: { modelTurns: 40 } });
  t.after(() => rm(f.root, { recursive: true, force: true }));
  await assert.rejects(executeRecipe({ repoRoot: f.root, catalog: f.catalog, recipe: f.recipe, variant: f.variant, authPath: f.authPath, runSession: async () => assert.fail("never runs") }), /cannot hold a Recipe's model-turn budget/);
});

// ---------------------------------------------------------------------------
// Claude Code end to end, against a fake claude

const TOKEN = "sk-ant-oat01-fake-token-for-tests-only";

function claudeVariant() {
  const variant = {
    id: "claude-code-haiku-5-5-high-clean", label: "Haiku 5.5 · High · via Claude Code · clean", provider: "anthropic", model: "claude-haiku-5-5", harness: "claude-code",
    reasoningEffort: "high", serviceTier: "default", personality: "default", capabilities: ["files", "shell"],
    executionProfile: { id: "claude-code-linux-host-clean-v1", label: "via Claude Code · clean", runtime: "linux-host", sandbox: "disabled", approvalPolicy: "bypass-permissions", nativeWeb: "disabled", networkPolicy: "not-enforced", filesystemBoundary: "not-a-secrecy-boundary", environment: "clean" },
  };
  return { ...variant, configHash: computeConfigHash(variant) };
}

// FAKE_MODE: "max-turns" spends its turns; "hang" replies once then never finishes;
// "silent" never replies; "retry" reports a rate-limit wait, sleeps through it, then finishes.
const FAKE_CLAUDE = `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("2.1.312 (Claude Code)"); process.exit(0); }
appendFileSync(process.env.FAKE_LOG, JSON.stringify(args) + "\\n");
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const resume = flag("--resume");
const session = resume ?? process.env.FAKE_SESSION;
const model = flag("--model");
const emit = (event) => console.log(JSON.stringify(event));
emit({ type: "system", subtype: "init", session_id: session, cwd: process.cwd(), model, permissionMode: "bypassPermissions", output_style: "default", tools: flag("--tools").split(","), mcp_servers: [] });
const mode = process.env.FAKE_MODE;
if (mode === "silent") await new Promise(() => setInterval(() => {}, 1000));
if (mode === "retry") { emit({ type: "system", subtype: "api_retry", attempt: 1, max_retries: 10, retry_delay_ms: Number(process.env.FAKE_WAIT_MS), error_status: 429, error: "rate_limit", session_id: session }); await new Promise((resolve) => setTimeout(resolve, Number(process.env.FAKE_WAIT_MS))); }
emit({ type: "assistant", parent_tool_use_id: null, session_id: session, message: { model, content: [{ type: "text", text: "Working on it." }] } });
if (mode === "hang") {
  // A tool the model started: the budget's stop must take it down too.
  const { spawn } = await import("node:child_process");
  const tool = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  appendFileSync(process.env.FAKE_LOG + ".tool", String(tool.pid));
  await new Promise(() => setInterval(() => {}, 1000));
}
if (mode === "max-turns") { emit({ type: "result", subtype: "error_max_turns", is_error: true, session_id: session, num_turns: Number(flag("--max-turns") ?? 99) }); process.exit(1); }
const prompt = args.at(-1);
emit({ type: "result", subtype: "success", is_error: false, result: prompt, session_id: session, usage: { input_tokens: 5, output_tokens: 2, service_tier: "standard" }, modelUsage: { [model]: { inputTokens: 5, outputTokens: 2 } } });
`;

async function claudeFixture(t, budget) {
  const f = await fixture({ budget, variant: claudeVariant() });
  t.after(() => rm(f.root, { recursive: true, force: true }));
  const executable = path.join(f.root, "fake-claude.mjs");
  await writeFile(executable, FAKE_CLAUDE, "utf8");
  await chmod(executable, 0o755);
  const credentials = path.join(f.root, "credentials.json");
  await writeFile(credentials, JSON.stringify({ claudeAiOauth: { accessToken: TOKEN, refreshToken: "refresh-secret", expiresAt: Date.now() + 4 * 60 * 60 * 1000, scopes: ["user:inference"] } }), { mode: 0o600 });
  const log = path.join(f.root, "calls.jsonl");
  const env = { FAKE_LOG: log, FAKE_SESSION: "6f1c2a8e-3b4d-4e5f-8a9b-0c1d2e3f4a5b", TASTE_CLAUDE_CREDENTIALS_PATH: credentials };
  const run = (extraEnv, options = {}) => executeRecipe({
    repoRoot: f.root, catalog: f.catalog, recipe: f.recipe, variant: f.variant, executable, env: { ...env, ...extraEnv },
    now: new Date("2026-11-09T12:00:00.000Z"), nonce: `n${Math.random().toString(16).slice(2, 8)}`, ...options,
  });
  const calls = async () => (await readFile(log, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  return { ...f, run, calls };
}

test("Claude Code: a declared turn budget is pinned on every turn, and spending it is a No Dish", async (t) => {
  const f = await claudeFixture(t, { modelTurns: 12 });
  const result = await f.run({ FAKE_MODE: "max-turns" });
  assert.equal(result.fault?.code, "out-of-turns", result.error);
  assert.equal(result.fault.class, "chef");
  const [call] = await f.calls();
  assert.equal(call[call.indexOf("--max-turns") + 1], "12");
  const manifest = JSON.parse(await readFile(path.join(f.root, "no-dishes", result.noDishId, "no-dish.json"), "utf8"));
  assert.deepEqual(manifest.fault.budget, { modelTurns: 12 });
});

test("Claude Code: with no declared budget, exhausted turns are Kitchen's harness limit and stay private", async (t) => {
  const f = await claudeFixture(t);
  const result = await f.run({ FAKE_MODE: "max-turns" });
  assert.deepEqual({ class: result.fault.class, code: result.fault.code }, { class: "kitchen", code: "harness-limit" });
  assert.match(result.fault.limit, /Claude Code/);
  assert.equal(result.noDishId, undefined);
  assert.equal((await f.calls())[0].includes("--max-turns"), false);
});

test("Claude Code: a model still working when the time budget runs out is killed and gets a No Dish", async (t) => {
  const f = await claudeFixture(t, { seconds: 600 });
  const started = Date.now();
  // Generous enough that a loaded machine still starts the fake and hears it speak before the budget ends.
  const result = await f.run({ FAKE_MODE: "hang" }, { budgetClock: quickClock(2) });
  assert.ok(Date.now() - started < 20_000, "the hung harness was killed");
  assert.equal(result.fault?.code, "out-of-time", result.error);
  const manifest = JSON.parse(await readFile(path.join(f.root, "no-dishes", result.noDishId, "no-dish.json"), "utf8"));
  assert.deepEqual(manifest.fault.budget, { seconds: 600 });
  const tool = Number(await readFile(path.join(f.root, "calls.jsonl.tool"), "utf8"));
  const alive = () => { try { process.kill(tool, 0); return true; } catch { return false; } };
  for (let wait = 0; alive() && wait < 50; wait += 1) await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(alive(), false, "the tool the harness started died with its process group");
});

test("Claude Code: a route that never answered within the budget is Kitchen's timeout", async (t) => {
  const f = await claudeFixture(t, { seconds: 600 });
  const result = await f.run({ FAKE_MODE: "silent" }, { budgetClock: quickClock(1) });
  assert.deepEqual({ class: result.fault.class, code: result.fault.code }, { class: "kitchen", code: "timeout" });
  assert.equal(result.noDishId, undefined);
});

test("Claude Code: a reported rate-limit wait is credited back to the model", async (t) => {
  const f = await claudeFixture(t, { seconds: 600 });
  // Without the credit, the 3 s wait alone would spend the 2 s budget; startup gets the rest.
  const result = await f.run({ FAKE_MODE: "retry", FAKE_WAIT_MS: "3000" }, { budgetClock: quickClock(2) });
  assert.equal(result.status, "accepted", result.error);
  const execution = JSON.parse(await readFile(path.join(f.root, "private/runtime/attempts", result.attemptId, "execution.json"), "utf8"));
  assert.equal(execution.budget.creditedMs, 6000, "one wait per turn");
  assert.equal(execution.budget.expired, false);
});

// ---------------------------------------------------------------------------
// Direct API: one request per prompt turn, no evidence while it waits

const directVariant = {
  id: "direct-api-or-test", provider: "anthropic", model: "anthropic/claude-haiku-5.5", harness: "direct-api", reasoningEffort: "high", serviceTier: "default", personality: "none", capabilities: [],
  executionProfile: { id: "direct-api-openrouter-v1", label: "Direct API · OpenRouter route · no harness", runtime: "linux-host", sandbox: "no-tools", approvalPolicy: "no-tools", nativeWeb: "disabled", networkPolicy: "no-tools", filesystemBoundary: "no-workspace", environment: "clean", route: "openrouter", upstream: "anthropic" },
};
const directRecipe = { setup: { instructions: "Set the table." }, turns: [{ id: "make", content: "Cook" }] };
// A real request holds a socket open; this stand-in holds the event loop instead, since Node 22's AbortSignal.timeout does not.
const hangingFetch = (_url, { signal }) => new Promise((_resolve, reject) => {
  const socket = setInterval(() => {}, 1000);
  signal.addEventListener("abort", () => { clearInterval(socket); reject(signal.reason); }, { once: true });
});

test("Direct API: Kitchen's own request timeout is a named harness limit; the budget's abort is not the model's", async (t) => {
  const privateDir = await mkdtemp(path.join(os.tmpdir(), "taste-budget-direct-"));
  t.after(() => rm(privateDir, { recursive: true, force: true }));
  const env = { OPENROUTER_API_KEY: "sk-or-test", TASTE_DIRECT_API_TIMEOUT_MS: "50" };
  const own = await runDirectApiSession({ variant: directVariant, recipe: directRecipe, privateDir, env, endpoint: "http://127.0.0.1:9/chat/completions", fetchImpl: hangingFetch });
  assert.equal(own.failure.kitchenFault, "harness-limit");
  assert.match(own.failure.limit, /Direct API request timeout \(50 ms\)/);

  const clock = startBudgetClock({ seconds: 0.05 });
  const budgeted = await runDirectApiSession({ variant: directVariant, recipe: directRecipe, privateDir, env, budget: { seconds: 600 }, clock, endpoint: "http://127.0.0.1:9/chat/completions", fetchImpl: hangingFetch });
  assert.equal(budgeted.failure.chefFault, undefined, "a request that never answered proves nothing about the model");
  assert.equal(budgeted.failure.kitchenFault, undefined);
  assert.match(budgeted.failure.message, /time budget/);
  clock.stop();
});

test("Direct API: with a declared time budget, the budget is the limit, not Kitchen's shorter request timeout", async (t) => {
  const privateDir = await mkdtemp(path.join(os.tmpdir(), "taste-budget-direct-"));
  t.after(() => rm(privateDir, { recursive: true, force: true }));
  let signal;
  const fetchImpl = async (_url, options) => { signal = options.signal; await new Promise((resolve) => setTimeout(resolve, 120)); return new Response(JSON.stringify({ error: { message: "stand-in" } }), { status: 500 }); };
  const clock = startBudgetClock({ seconds: 5 });
  const result = await runDirectApiSession({ variant: directVariant, recipe: directRecipe, privateDir, env: { OPENROUTER_API_KEY: "sk-or-test", TASTE_DIRECT_API_TIMEOUT_MS: "50" }, budget: { seconds: 600 }, clock, endpoint: "http://127.0.0.1:9/chat/completions", fetchImpl });
  clock.stop();
  assert.equal(signal.aborted, false, "the 50 ms request timeout did not apply");
  assert.match(result.failure.message, /HTTP 500/);
});
