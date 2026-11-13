import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  CodexExecutionError,
  buildCodexTurnArgs,
  codexUsageLimit,
  getCodexVersion,
  parseCodexJsonl,
  planCodexTurn,
  runCodexSession,
  runCodexTurn,
} from "../lib/taste/codex.mjs";
import { startBudgetClock } from "../lib/taste/budget.mjs";
import { classifyFailure } from "../lib/taste/faults.mjs";
import { getHarnessAdapter } from "../lib/taste/harness-adapters.mjs";

const THREAD_ID = "01901234-5678-7abc-8def-0123456789ab";
const EXECUTION_PROFILE = {
  id: "codex-linux-host-unsandboxed-v1",
  label: "via Codex CLI · host-unsandboxed fallback",
  runtime: "linux-host",
  sandbox: "danger-full-access",
  approvalPolicy: "never",
  nativeWeb: "disabled",
  networkPolicy: "not-enforced",
  filesystemBoundary: "not-a-secrecy-boundary",
};

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "taste-codex-"));
  const workspace = path.join(root, "workspace");
  const codexHome = path.join(root, "codex-home");
  const fake = path.join(root, "fake-codex.mjs");
  await Promise.all([
    import("node:fs/promises").then(({ mkdir }) => mkdir(workspace)),
    import("node:fs/promises").then(({ mkdir }) => mkdir(codexHome)),
  ]);
  await writeFile(fake, `#!/usr/bin/env node
import { appendFile, writeFile } from "node:fs/promises";
const args = process.argv.slice(2);
let stdin = "";
for await (const chunk of process.stdin) stdin += chunk;
if (process.env.FAKE_LOG) await appendFile(process.env.FAKE_LOG, JSON.stringify({ args, stdin, home: process.env.CODEX_HOME, userHome: process.env.HOME, xdgConfig: process.env.XDG_CONFIG_HOME ?? null, cwd: process.cwd() }) + "\\n");
if (args[0] === "--version") { console.log("codex-cli 9.9.9-fake"); process.exit(0); }
const outputFlag = args.indexOf("--output-last-message");
if (outputFlag >= 0 && process.env.FAKE_NO_FINAL !== "1") await writeFile(args[outputFlag + 1], process.env.FAKE_FINAL ?? "finished");
const resumeIndex = args.indexOf("resume");
const threadId = resumeIndex >= 0 ? args[resumeIndex + 1] : process.env.FAKE_THREAD;
console.log(JSON.stringify({ type: "thread.started", thread_id: process.env.FAKE_REPORTED_THREAD ?? threadId }));
if (process.env.FAKE_HANG) await new Promise(() => setInterval(() => {}, 1000));
if (process.env.FAKE_HANG_AFTER_ITEM) {
  // The model answered and is still working: an item in the stream, its identity in the private rollout.
  const { mkdir } = await import("node:fs/promises");
  await mkdir(process.env.CODEX_HOME + "/sessions/2026/11/09", { recursive: true });
  await writeFile(process.env.CODEX_HOME + "/sessions/2026/11/09/rollout-" + threadId + ".jsonl", [
    { type: "session_meta", payload: { id: threadId, model_provider: "openai", cli_version: "9.9.9-fake" } },
    { type: "turn_context", payload: { model: process.env.FAKE_ROLLOUT_MODEL ?? "gpt-5.6-luna", effort: "high", personality: "none" } },
  ].map((record) => JSON.stringify(record)).join("\\n") + "\\n");
  console.log(JSON.stringify({ type: "item.completed", item: { id: "item_0", type: process.env.FAKE_ITEM_TYPE ?? "agent_message", text: "Working." } }));
  if (process.env.FAKE_LINGER) console.log(JSON.stringify({ type: "turn.completed" }));
  if (process.env.FAKE_EVENT) for (const event of [JSON.parse(process.env.FAKE_EVENT)].flat()) console.log(JSON.stringify(event));
  await new Promise(() => setInterval(() => {}, 1000));
}
if (process.env.FAKE_EVENT) for (const event of [JSON.parse(process.env.FAKE_EVENT)].flat()) console.log(JSON.stringify(event));
else console.log(JSON.stringify({ type: "turn.completed" }));
if (process.env.FAKE_STDERR) console.error(process.env.FAKE_STDERR);
process.exit(Number(process.env.FAKE_EXIT ?? 0));
`, "utf8");
  await chmod(fake, 0o755);
  return { root, workspace, codexHome, fake, log: path.join(root, "calls.jsonl") };
}

function configValues(args) {
  const values = [];
  args.forEach((arg, index) => {
    if (arg === "-c") values.push(args[index + 1]);
  });
  return values;
}

test("plans a fresh, fully pinned Codex invocation without executing it", async () => {
  const f = await fixture();
  const plan = planCodexTurn({
    prompt: "Cook this",
    model: "gpt-5.6-sol",
    reasoningEffort: "high",
    personality: "none",
    modelVerbosity: "low",
    web: "disabled",
    sandbox: "danger-full-access",
    approval: "never",
    workspace: f.workspace,
    codexHome: f.codexHome,
    artifactDir: path.join(f.root, "artifact"),
    executable: f.fake,
    env: { ONLY_FOR_FAKE: "yes" },
  });

  assert.equal(plan.executable, f.fake);
  assert.deepEqual(plan.args.slice(0, 5), ["--ask-for-approval", "never", "--sandbox", "danger-full-access", "exec"]);
  assert.equal(plan.args.includes("resume"), false);
  assert.equal(plan.args.at(-1), "-");
  assert.equal(plan.stdin, "Cook this");
  assert.equal(plan.cwd, f.workspace);
  assert.equal(plan.env.CODEX_HOME, f.codexHome);
  assert.equal(plan.env.ONLY_FOR_FAKE, "yes");
  assert.deepEqual(configValues(plan.args), [
    'model_reasoning_effort="high"',
    'personality="none"',
    'model_verbosity="low"',
    'web_search="disabled"',
    'shell_environment_policy.inherit="none"',
    'shell_environment_policy.include_only=["PATH","LANG","LC_ALL","TERM","TZ"]',
    'service_tier="default"',
  ]);
  assert.ok(plan.args.includes("--ignore-rules"));
  assert.ok(plan.args.includes("--skip-git-repo-check"));
  await assert.rejects(readFile(f.log), /ENOENT/u);
});

test("resume plans name the exact UUID and force Luna fast on every turn", async () => {
  const f = await fixture();
  for (const threadId of [undefined, THREAD_ID]) {
    const plan = planCodexTurn({
      prompt: "Next",
      threadId,
      model: "gpt-5.6-luna",
      reasoningEffort: "xhigh",
      serviceTier: "fast",
      workspace: f.workspace,
      codexHome: f.codexHome,
      artifactDir: path.join(f.root, threadId ? "resume" : "fresh"),
    });
    if (threadId) assert.equal(plan.args[plan.args.indexOf("resume") + 1], THREAD_ID);
    assert.ok(configValues(plan.args).includes('service_tier="fast"'));
    assert.ok(plan.args.includes("fast_mode"));
  }
  assert.throws(() => planCodexTurn({
    prompt: "x", threadId: "--last", model: "gpt-5.6-luna", reasoningEffort: "low",
    workspace: f.workspace, codexHome: f.codexHome, artifactDir: path.join(f.root, "bad"),
  }), /exact UUID/u);
});

test("Luna default tier stays non-fast", async () => {
  const f = await fixture();
  const plan = planCodexTurn({
    prompt: "Cook without Fast mode",
    model: "gpt-5.6-luna",
    reasoningEffort: "xhigh",
    serviceTier: "default",
    workspace: f.workspace,
    codexHome: f.codexHome,
    artifactDir: path.join(f.root, "luna-default"),
  });

  assert.ok(configValues(plan.args).includes('service_tier="default"'));
  assert.equal(plan.args.some((arg, index) => arg === "--enable" && plan.args[index + 1] === "fast_mode"), false);
  assert.deepEqual(plan.args.slice(plan.args.indexOf("--disable"), plan.args.indexOf("--disable") + 2), ["--disable", "fast_mode"]);
});

test("runner argv maps recipe boundaries and variant identity without execution", async () => {
  const f = await fixture();
  const args = buildCodexTurnArgs({
    variant: { model: "gpt-5.6-terra", reasoningEffort: "high", personality: "none", serviceTier: "default", executionProfile: EXECUTION_PROFILE },
    recipe: { harness: { workspace: "read", web: "enabled" } },
    workspace: f.workspace,
    finalPath: path.join(f.root, "final.txt"),
  });
  assert.equal(args.includes("exec"), true);
  assert.ok(configValues(args).includes('web_search="disabled"'));
  assert.equal(args[args.indexOf("--sandbox") + 1], "danger-full-access");
  assert.ok(args.includes("-C"));
  await assert.rejects(readFile(f.log), /ENOENT/u);
});

test("JSONL parsing requires exactly one valid thread.started and rejects failure events", () => {
  const ok = parseCodexJsonl(`${JSON.stringify({ type: "thread.started", thread_id: THREAD_ID })}\n${JSON.stringify({ type: "turn.completed" })}\n`);
  assert.equal(ok.threadId, THREAD_ID);
  assert.throws(() => parseCodexJsonl('{"type":"turn.completed"}\n'), /exactly one/u);
  assert.throws(() => parseCodexJsonl(`${JSON.stringify({ type: "thread.started", thread_id: THREAD_ID })}\n${JSON.stringify({ type: "thread.started", thread_id: THREAD_ID })}\n`), /received 2/u);
  assert.throws(() => parseCodexJsonl('{not-json}\n'), /line 1/u);
  assert.throws(() => parseCodexJsonl(`${JSON.stringify({ type: "thread.started", thread_id: THREAD_ID })}\n${JSON.stringify({ type: "turn.failed", error: { message: "bad turn" } })}\n`), /bad turn/u);
  assert.throws(() => parseCodexJsonl(`${JSON.stringify({ type: "thread.started", thread_id: THREAD_ID })}\n${JSON.stringify({ type: "error", message: "provider broke" })}\n`), /provider broke/u);
});

test("executes through an injected binary and captures stdout, stderr, and final message", async () => {
  const f = await fixture();
  const artifactDir = path.join(f.root, "artifact");
  const result = await runCodexTurn({
    prompt: "First prompt",
    model: "gpt-5.6-sol",
    reasoningEffort: "high",
    workspace: f.workspace,
    codexHome: f.codexHome,
    artifactDir,
    executable: f.fake,
    env: { FAKE_THREAD: THREAD_ID, FAKE_STDERR: "diagnostic", FAKE_FINAL: "the answer" },
  });

  assert.equal(result.threadId, THREAD_ID);
  assert.equal(result.finalMessage, "the answer");
  assert.match(await readFile(result.paths.stdout, "utf8"), /thread\.started/u);
  assert.equal((await readFile(result.paths.stderr, "utf8")).trim(), "diagnostic");
  assert.equal(await readFile(result.paths.finalMessage, "utf8"), "the answer");
});

test("a scripted session starts fresh then resumes only the returned UUID", async () => {
  const f = await fixture();
  const plans = [];
  const session = await runCodexSession({
    variant: { model: "gpt-5.6-luna", reasoningEffort: "high", personality: "none", serviceTier: "fast", executionProfile: EXECUTION_PROFILE },
    recipe: {
      harness: { workspace: "write", web: "disabled" },
      setup: { instructions: "Mounted context" },
      turns: [{ id: "opening", content: "One" }, { id: "correction", content: "Two" }],
    },
    workspace: f.workspace,
    codexHome: f.codexHome,
    privateDir: path.join(f.root, "session"),
    executable: f.fake,
    env: { FAKE_THREAD: THREAD_ID, FAKE_LOG: f.log },
    onPlan: (plan) => plans.push(plan),
  });
  const calls = (await readFile(f.log, "utf8")).trim().split("\n").map(JSON.parse).filter(({ args }) => args.includes("exec"));

  assert.equal(session.threadId, THREAD_ID);
  assert.equal(session.cliVersion, "codex-cli 9.9.9-fake");
  assert.equal(session.failure, null);
  assert.equal(session.turns.length, 2);
  assert.equal(calls[0].args.includes("resume"), false);
  assert.equal(calls[1].args[calls[1].args.indexOf("resume") + 1], THREAD_ID);
  assert.equal(calls[0].stdin, "Mounted context\n\nOne");
  assert.equal(calls[1].stdin, "Two");
  assert.equal(calls.every(({ home }) => home === f.codexHome), true);
  assert.equal(calls.every(({ args }) => configValues(args).includes('service_tier="fast"')), true);
  assert.equal(plans.length, 2);
  assert.deepEqual(plans.map(({ argv }) => argv), session.turns.map(({ argv }) => argv));
  assert.equal(session.turns[0].turnId, "opening");
  assert.equal(session.turns[0].eventsPath.endsWith("stdout.jsonl"), true);
});

test("a clean Codex session runs with a fresh HOME beside its fresh CODEX_HOME; the original profile keeps the real HOME", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  const auth = path.join(f.root, "auth.json");
  await writeFile(auth, "{}");
  const recipe = { harness: { workspace: "write", web: "disabled" }, setup: { instructions: "Context" }, turns: [{ id: "opening", content: "One" }, { id: "correction", content: "Two" }] };
  const cleanProfile = { ...EXECUTION_PROFILE, id: "codex-linux-host-clean-v1", label: "via Codex CLI · clean", environment: "clean" };
  const variant = { model: "gpt-5.6-sol", reasoningEffort: "high", personality: "none", serviceTier: "default", executionProfile: cleanProfile };
  const adapter = getHarnessAdapter("codex-cli");
  const codexHome = path.join(f.root, "cook", "codex-home");
  await mkdir(path.dirname(codexHome));
  await adapter.prepareAttempt({ variant, codexHome, authPath: auth });
  const home = path.join(f.root, "cook", "home");
  assert.deepEqual(await readdir(home), [], "the fresh home starts empty");
  assert.deepEqual(await readdir(codexHome), ["auth.json"]);
  assert.deepEqual(adapter.requestedExecution(variant), { codexHome: "fresh-per-attempt", home: "fresh-per-attempt" });

  const env = { FAKE_THREAD: THREAD_ID, FAKE_LOG: f.log, XDG_CONFIG_HOME: "/elsewhere/.config" };
  const session = await runCodexSession({ variant, recipe, workspace: f.workspace, codexHome, privateDir: path.join(f.root, "clean"), executable: f.fake, env });
  assert.equal(session.failure, null);
  const calls = (await readFile(f.log, "utf8")).trim().split("\n").map(JSON.parse);
  assert.equal(calls.length, 3, "version query and both turns");
  for (const call of calls) {
    assert.equal(call.home, codexHome);
    assert.equal(call.userHome, home, "user skills under the real HOME stay out of reach");
    assert.equal(call.xdgConfig, null);
  }
  for (const call of calls.filter(({ args }) => args.includes("exec"))) {
    assert.ok(call.args.includes("--ignore-user-config"));
    assert.ok(call.args.includes("--ignore-rules"));
  }

  await rm(f.log);
  const original = { ...variant, executionProfile: EXECUTION_PROFILE };
  assert.deepEqual(adapter.requestedExecution(original), { codexHome: "fresh-per-attempt", home: "inherited" });
  await runCodexSession({ variant: original, recipe, workspace: f.workspace, codexHome, privateDir: path.join(f.root, "original"), executable: f.fake, env: { FAKE_THREAD: THREAD_ID, FAKE_LOG: f.log } });
  for (const call of (await readFile(f.log, "utf8")).trim().split("\n").map(JSON.parse)) assert.equal(call.userHome, process.env.HOME);
});

test("session returns a terminal failure and does not send later turns", async () => {
  const f = await fixture();
  const session = await runCodexSession({
    variant: { model: "gpt-5.6-sol", reasoningEffort: "high", personality: "none", serviceTier: "default", executionProfile: EXECUTION_PROFILE },
    recipe: {
      harness: { workspace: "write", web: "disabled" },
      setup: { instructions: "Setup" },
      turns: [{ id: "first", content: "One" }, { id: "never", content: "Two" }],
    },
    workspace: f.workspace,
    codexHome: f.codexHome,
    privateDir: path.join(f.root, "failed-session"),
    executable: f.fake,
    env: { FAKE_THREAD: THREAD_ID, FAKE_EXIT: "9" },
  });
  assert.equal(session.turns.length, 1);
  assert.equal(session.failure.turnId, "first");
  assert.equal(session.failure.exitCode, 9);
});

test("detects nonzero exits, failure events, thread substitution, and missing final output", async () => {
  const f = await fixture();
  const common = {
    prompt: "Fail safely",
    model: "gpt-5.6-sol",
    reasoningEffort: "high",
    workspace: f.workspace,
    codexHome: f.codexHome,
    executable: f.fake,
  };

  await assert.rejects(runCodexTurn({
    ...common, artifactDir: path.join(f.root, "nonzero"), env: { FAKE_THREAD: THREAD_ID, FAKE_EXIT: "7" },
  }), (error) => error instanceof CodexExecutionError && /code 7/u.test(error.message));
  assert.match(await readFile(path.join(f.root, "nonzero", "stdout.jsonl"), "utf8"), /thread\.started/u);

  await assert.rejects(runCodexTurn({
    ...common, artifactDir: path.join(f.root, "event"), env: { FAKE_THREAD: THREAD_ID, FAKE_EVENT: JSON.stringify({ type: "turn.failed", error: { message: "nope" } }) },
  }), /nope/u);

  await assert.rejects(runCodexTurn({
    ...common, threadId: THREAD_ID, artifactDir: path.join(f.root, "swapped"), env: { FAKE_REPORTED_THREAD: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" },
  }), /but Codex reported/u);

  await assert.rejects(runCodexTurn({
    ...common, artifactDir: path.join(f.root, "missing"), env: { FAKE_THREAD: THREAD_ID, FAKE_NO_FINAL: "1" },
  }), /without writing/u);
});

test("captures an injected codex --version without running real Codex", async () => {
  const f = await fixture();
  assert.equal(await getCodexVersion({ executable: f.fake, codexHome: f.codexHome }), "codex-cli 9.9.9-fake");
});

test("the Recipe's time budget stops a hung Codex turn and the Run; without identity evidence it names no chef fault", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  const clock = startBudgetClock({ seconds: 0.5 });
  const started = Date.now();
  const session = await runCodexSession({
    variant: { model: "gpt-5.6-luna", reasoningEffort: "high", personality: "none", serviceTier: "default", executionProfile: EXECUTION_PROFILE },
    recipe: { harness: { workspace: "write", web: "disabled" }, setup: { instructions: "Context" }, turns: [{ id: "opening", content: "One" }, { id: "correction", content: "Two" }] },
    workspace: f.workspace, codexHome: f.codexHome, privateDir: path.join(f.root, "raw"), executable: f.fake, env: { FAKE_THREAD: THREAD_ID, FAKE_HANG: "1" }, clock,
  });
  clock.stop();
  assert.ok(Date.now() - started < 10_000);
  assert.match(session.failure.message, /stopped by the Recipe's time budget/);
  assert.equal(session.failure.chefFault, undefined);
  assert.equal(session.turns.length, 1);
});

test("the Recipe's time budget is the model's on Codex only when it answered and the rollout proves the requested identity", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  const variant = { provider: "openai", model: "gpt-5.6-luna", reasoningEffort: "high", personality: "none", serviceTier: "default", executionProfile: EXECUTION_PROFILE };
  const recipe = { harness: { workspace: "write", web: "disabled" }, setup: { instructions: "Context" }, turns: [{ id: "opening", content: "One" }] };
  for (const [name, env, expected, kitchenFault] of [
    ["serving", {}, "out-of-time"],
    ["another model", { FAKE_ROLLOUT_MODEL: "gpt-5.6-sol" }, undefined],
    ["only an error item", { FAKE_ITEM_TYPE: "error" }, undefined],
    ["finished, then lingered", { FAKE_LINGER: "1" }, undefined],
    // The account ran out mid-turn: even with the requested model's item in the stream, the stop is not the model's.
    ["usage limit", { FAKE_EVENT: JSON.stringify([{ type: "error", message: "You've hit your usage limit. Try again at 3:05 PM." }]) }, undefined, "usage-limit"],
  ]) {
    await rm(path.join(f.codexHome, "sessions"), { recursive: true, force: true });
    // Long enough for a loaded machine to start the fake and write its rollout before the budget ends.
    const clock = startBudgetClock({ seconds: 3 });
    const session = await runCodexSession({ variant, recipe, workspace: f.workspace, codexHome: f.codexHome, privateDir: path.join(f.root, `raw-${name}`), executable: f.fake, env: { FAKE_THREAD: THREAD_ID, FAKE_HANG_AFTER_ITEM: "1", ...env }, clock });
    clock.stop();
    assert.match(session.failure.message, /stopped by the Recipe's time budget/, name);
    assert.equal(session.failure.chefFault, expected, name);
    assert.equal(session.failure.kitchenFault, kitchenFault, name);
  }
});

// The shape Codex gave on 2026-11-13: an `error` event, the `turn.failed` that repeats it, then exit 1.
const USAGE_LIMIT = "You've hit your usage limit. Upgrade to Pro or try again at Nov 21st, 2026.";
const usageLimitEvents = (message = USAGE_LIMIT) => [{ type: "error", message }, { type: "turn.failed", error: { message } }];

test("a usage limit is read from Codex's error events, with the reset time only when Codex states one", () => {
  assert.deepEqual(codexUsageLimit(usageLimitEvents()), { message: USAGE_LIMIT, resetsAt: "Nov 21st, 2026" });
  assert.deepEqual(codexUsageLimit([{ type: "turn.failed", error: { message: USAGE_LIMIT } }]), { message: USAGE_LIMIT, resetsAt: "Nov 21st, 2026" });
  assert.deepEqual(codexUsageLimit([{ type: "error", message: "You've hit your usage limit. Try again at 3:05 PM" }]), { message: "You've hit your usage limit. Try again at 3:05 PM", resetsAt: "3:05 PM" });
  assert.deepEqual(codexUsageLimit([{ type: "error", message: "You've hit your usage limit. Try again later." }]), { message: "You've hit your usage limit. Try again later." });
  // The reset is the stated time alone: not an alternative offered after it, not a later line, not words without a time.
  for (const [tail, resetsAt] of [
    ["try again at Nov 21st, 2026 or upgrade to Pro (https://example.test/pricing).", "Nov 21st, 2026"],
    ["try again at 3:05 PM (UTC).", "3:05 PM"],
    ["try again at 3:05 PM; see your plan.", "3:05 PM"],
    ["Try again at 3:05 PM.\nRequest id: abc", "3:05 PM"],
    ["try again at .", undefined],
    ["try again at a later time.", undefined],
    [`try again at ${"9".repeat(81)}`, undefined],
  ]) {
    const message = `You've hit your usage limit, ${tail}`;
    assert.deepEqual(codexUsageLimit([{ type: "error", message }]), { message, ...(resetsAt ? { resetsAt } : {}) }, tail);
  }
  const started = Date.now();
  assert.deepEqual(codexUsageLimit([{ type: "error", message: `usage limit, try again at ${" .".repeat(40_000)}\n` }]), { message: `usage limit, try again at ${" .".repeat(40_000)}\n` });
  assert.ok(Date.now() - started < 1000, "a long message is read in linear time");
  // Only the harness's own error events count: never an item the model wrote, never another error.
  assert.equal(codexUsageLimit([{ type: "item.completed", item: { type: "agent_message", text: USAGE_LIMIT } }]), null);
  assert.equal(codexUsageLimit([{ type: "error", message: "stream disconnected; try again at Nov 21st, 2026" }]), null);
  assert.equal(codexUsageLimit([{ type: "error", message: { text: USAGE_LIMIT } }, { type: "turn.failed", error: USAGE_LIMIT }, null, "error"]), null);
  assert.equal(codexUsageLimit(undefined), null);
});

test("a Codex turn that ends on a usage limit is Kitchen's usage-limit fault, not harness-changed", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  const variant = { model: "gpt-5.6-luna", reasoningEffort: "low", personality: "none", serviceTier: "default", executionProfile: EXECUTION_PROFILE };
  const recipe = { harness: { workspace: "write", web: "disabled" }, setup: { instructions: "Context" }, turns: [{ id: "opening", content: "One" }, { id: "correction", content: "Two" }] };
  const run = (name, env) => runCodexSession({ variant, recipe, workspace: f.workspace, codexHome: f.codexHome, privateDir: path.join(f.root, name), executable: f.fake, env: { FAKE_THREAD: THREAD_ID, ...env } });

  const limited = await run("limited", { FAKE_EVENT: JSON.stringify(usageLimitEvents()), FAKE_EXIT: "1" });
  assert.equal(limited.turns.length, 1, "the next turn is not attempted");
  assert.deepEqual(limited.failure, { turnId: "opening", message: `Codex exited with code 1: ${USAGE_LIMIT}`, exitCode: 1, signal: null, kitchenFault: "usage-limit", resetsAt: "Nov 21st, 2026" });
  const fault = classifyFailure({ message: `codex-cli turn opening failed: ${limited.failure.message}`, kitchenFault: limited.failure.kitchenFault, resetsAt: limited.failure.resetsAt });
  assert.deepEqual({ class: fault.class, code: fault.code, resetsAt: fault.resetsAt }, { class: "kitchen", code: "usage-limit", resetsAt: "Nov 21st, 2026" });

  // The same events with exit 0 are caught while parsing; the message already quotes Codex, so it is not repeated.
  const parsed = await run("parsed", { FAKE_EVENT: JSON.stringify(usageLimitEvents("You've hit your usage limit.")) });
  assert.deepEqual(parsed.failure, { turnId: "opening", message: "Codex reported error: You've hit your usage limit.", exitCode: 0, signal: null, kitchenFault: "usage-limit" });

  // Any other failed turn is tagged nothing and reads as before.
  const other = await run("other", { FAKE_EVENT: JSON.stringify([{ type: "error", message: "stream disconnected" }]), FAKE_EXIT: "1" });
  assert.deepEqual(other.failure, { turnId: "opening", message: "Codex exited with code 1", exitCode: 1, signal: null });
  assert.equal(classifyFailure({ message: `codex-cli turn opening failed: ${other.failure.message}` }).code, "harness-changed");
});
