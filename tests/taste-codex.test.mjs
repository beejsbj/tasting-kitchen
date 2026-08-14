import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  CodexExecutionError,
  buildCodexTurnArgs,
  getCodexVersion,
  parseCodexJsonl,
  planCodexTurn,
  runCodexSession,
  runCodexTurn,
} from "../lib/taste/codex.mjs";

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
if (process.env.FAKE_LOG) await appendFile(process.env.FAKE_LOG, JSON.stringify({ args, stdin, home: process.env.CODEX_HOME, cwd: process.cwd() }) + "\\n");
if (args[0] === "--version") { console.log("codex-cli 9.9.9-fake"); process.exit(0); }
const outputFlag = args.indexOf("--output-last-message");
if (outputFlag >= 0 && process.env.FAKE_NO_FINAL !== "1") await writeFile(args[outputFlag + 1], process.env.FAKE_FINAL ?? "finished");
const resumeIndex = args.indexOf("resume");
const threadId = resumeIndex >= 0 ? args[resumeIndex + 1] : process.env.FAKE_THREAD;
console.log(JSON.stringify({ type: "thread.started", thread_id: process.env.FAKE_REPORTED_THREAD ?? threadId }));
if (process.env.FAKE_EVENT) console.log(JSON.stringify(JSON.parse(process.env.FAKE_EVENT)));
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
  assert.throws(() => planCodexTurn({
    prompt: "x", model: "gpt-5.6-luna", reasoningEffort: "low", serviceTier: "default",
    workspace: f.workspace, codexHome: f.codexHome, artifactDir: path.join(f.root, "wrong-tier"),
  }), /explicitly request the fast/u);
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
