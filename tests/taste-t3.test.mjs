import assert from "node:assert/strict";
import { access, chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { computeRecipeHash } from "../lib/taste/catalog.mjs";
import { resolveHarnessAdapter } from "../lib/taste/harness-adapters.mjs";
import { executeRecipe } from "../lib/taste/runner.mjs";
import { buildT3TurnArgs, parseT3Turn, prepareT3Attempt, runT3Session, t3Settings, verifyT3Identity } from "../lib/taste/t3.mjs";

const TOKEN = "sk-ant-oat-access-token-for-tests";
const profile = {
  id: "t3-linux-host-clean-v1", label: "via T3 · scratch server · clean inner home", runtime: "linux-host", sandbox: "disabled", approvalPolicy: "full-access",
  nativeWeb: "not-enforced", networkPolicy: "not-enforced", filesystemBoundary: "not-a-secrecy-boundary", environment: "clean",
};
const viaClaude = {
  id: "t3-claude-code-opus-5-5-high-clean", label: "Opus 5.5 · High · via T3 → Claude Code · clean", provider: "anthropic", model: "claude-opus-5-5",
  harness: "t3", harnessPath: ["t3", "claude-code"], reasoningEffort: "high", serviceTier: "default", personality: "default", capabilities: ["files", "shell"],
  executionProfile: profile, configHash: `sha256:${"6".repeat(64)}`,
};
const viaCodex = {
  ...viaClaude, id: "t3-codex-sol-6-1-high-clean", label: "Sol 6.1 · High · via T3 → Codex CLI · clean", provider: "openai", model: "gpt-6.1-sol",
  harnessPath: ["t3", "codex-cli"], personality: "none",
};
const recipe = { setup: { instructions: "Respond in this fresh conversation." }, turns: [{ id: "respond", content: "Read the entry." }, { id: "follow", content: "Now say it plainer." }] };

// A fake t3: `serve` stays up until signalled; thread commands act as the one
// enabled provider would, writing that harness's own session files into the
// home the scratch settings name.
const FAKE_T3 = `#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("t3 v0.1.6 (fake)"); process.exit(0); }
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const base = flag("--base-dir");
const runtime = path.join(base, "userdata", "server-runtime.json");
const log = (entry) => appendFileSync(process.env.FAKE_LOG, JSON.stringify(entry) + "\\n");
if (args[0] === "serve") {
  mkdirSync(path.dirname(runtime), { recursive: true });
  writeFileSync(runtime, JSON.stringify({ pid: process.pid }));
  log({ cmd: "serve", args, browser: process.env.T3CODE_NO_BROWSER ?? null, leaked: process.env.ANTHROPIC_API_KEY ?? null, telemetry: process.env.T3CODE_TELEMETRY_ENABLED ?? null, doNotTrack: process.env.DO_NOT_TRACK ?? null, sessionEnv: [process.env.CLAUDECODE, process.env.T3_MCP_BEARER_TOKEN, process.env.CLAUDE_CODE_MESSAGING_TOKEN].filter(Boolean) });
  process.on("SIGTERM", () => process.exit(0));
  createServer((request, response) => response.end("ok")).listen(Number(flag("--port")), "127.0.0.1");
} else if (args[0] === "project") {
  process.exit(existsSync(runtime) ? 0 : 1);
} else if (args[0] === "thread" && args[1] === "show") {
  console.log(JSON.stringify({ thread: { threadId: args.at(-1) }, messages: [] }));
} else if (args[0] === "thread") {
  const settings = JSON.parse(readFileSync(path.join(base, "userdata", "settings.json"), "utf8"));
  const selection = settings.defaultModelSelection;
  const instance = settings.providerInstances[selection.instanceId];
  const prompt = readFileSync(0, "utf8");
  const threadId = args[1] === "start" ? "thread-0001" : args.at(-2);
  const served = process.env.FAKE_SERVED_MODEL || selection.model;
  const effort = process.env.FAKE_EFFORT || selection.options[0].value;
  if (selection.instanceId === "claudeAgent") {
    const env = Object.fromEntries(instance.environment.map((variable) => [variable.name, variable.value]));
    const dir = path.join(env.CLAUDE_CONFIG_DIR, "projects", "-attempt-workspace");
    mkdirSync(dir, { recursive: true });
    appendFileSync(path.join(dir, threadId + ".jsonl"), JSON.stringify({ type: "assistant", message: { model: served, content: [] } }) + "\\n");
    log({ cmd: args[1], args, prompt, selection, token: env.CLAUDE_CODE_OAUTH_TOKEN, config: env.CLAUDE_CONFIG_DIR });
  } else {
    const dir = path.join(instance.config.homePath, "sessions", "2026", "11", "08");
    mkdirSync(dir, { recursive: true });
    appendFileSync(path.join(dir, "rollout-" + threadId + ".jsonl"), JSON.stringify({ type: "turn_context", payload: { model: served, effort } }) + "\\n");
    log({ cmd: args[1], args, prompt, selection, home: instance.config.homePath });
  }
  if (process.env.FAKE_FAIL) { console.log(JSON.stringify({ threadId, runId: "run-1", status: "failed", reply: null, error: "provider exploded" })); process.exit(1); }
  console.log(JSON.stringify({ threadId, runId: "run-" + args[1], status: "completed", reply: "reply to: " + prompt, error: null }));
}
`;

async function setup(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "taste-t3-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = path.join(root, "bin");
  await mkdir(bin);
  const t3 = path.join(bin, "t3");
  await writeFile(t3, FAKE_T3, "utf8");
  for (const [name, version] of [["claude", "2.9.9 (Claude Code)"], ["codex", "codex-cli 9.9.9"]]) {
    await writeFile(path.join(bin, name), `#!/bin/sh\necho "${version}"\n`, "utf8");
    await chmod(path.join(bin, name), 0o755);
  }
  await chmod(t3, 0o755);
  const credentials = path.join(root, "credentials.json");
  await writeFile(credentials, JSON.stringify({ claudeAiOauth: { accessToken: TOKEN, refreshToken: "refresh-never-shared", expiresAt: Date.now() + 24 * 3600 * 1000 } }));
  const codexAuth = path.join(root, "codex-auth.json");
  await writeFile(codexAuth, "{}\n");
  const log = path.join(root, "calls.jsonl");
  const env = {
    FAKE_LOG: log, TASTE_CLAUDE_CREDENTIALS_PATH: credentials, TASTE_CODEX_AUTH_PATH: codexAuth,
    TASTE_T3_CLAUDE_BINARY: path.join(bin, "claude"), TASTE_T3_CODEX_BINARY: path.join(bin, "codex"), ANTHROPIC_API_KEY: "sk-ant-leak",
  };
  const calls = async () => (await readFile(log, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  return { root, t3, env, calls };
}

async function attempt(root, name) {
  const attemptDir = path.join(root, name);
  await mkdir(path.join(attemptDir, "workspace"), { recursive: true });
  return { attemptDir, workspace: path.join(attemptDir, "workspace"), privateDir: path.join(attemptDir, "raw"), codexHome: path.join(attemptDir, "codex-home") };
}

async function filesUnder(root) {
  const out = [];
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) if (entry.isFile()) out.push(path.join(entry.parentPath, entry.name));
  return out;
}

test("a T3 configuration must name its inner harness, and each inner harness keeps its own model rules", () => {
  assert.doesNotThrow(() => resolveHarnessAdapter(viaClaude));
  assert.doesNotThrow(() => resolveHarnessAdapter(viaCodex));
  assert.throws(() => resolveHarnessAdapter({ ...viaClaude, harnessPath: undefined }), /must name its harnessPath/);
  assert.throws(() => resolveHarnessAdapter({ ...viaClaude, harnessPath: ["t3", "cursor-agent"] }), /t3 cannot wrap cursor-agent/);
  assert.throws(() => resolveHarnessAdapter({ ...viaClaude, harnessPath: ["t3", "hermes"] }), /cannot wrap hermes/);
  assert.throws(() => resolveHarnessAdapter({ ...viaClaude, model: "anthropic/claude-opus-5.5" }), /full claude-\* model id/);
  assert.throws(() => resolveHarnessAdapter({ ...viaCodex, reasoningEffort: "max" }), /effort must be one of/);
  assert.throws(() => resolveHarnessAdapter({ ...viaClaude, harness: "claude-code" }), /execution profile.id must be one of/);
});

test("scratch settings enable one provider pinned to the tasted model and effort, and switch off what reaches outward", () => {
  const paths = { attemptDir: "/a", t3Home: "/a/t3-home", claudeHome: "/a/claude-home", codexHome: "/a/codex-home" };
  const claude = t3Settings({ variant: viaClaude, paths, token: TOKEN });
  assert.deepEqual(claude.defaultModelSelection, { instanceId: "claudeAgent", model: "claude-opus-5-5", options: [{ id: "effort", value: "high" }] });
  assert.deepEqual(claude.textGenerationModelSelection, claude.defaultModelSelection, "T3's own title calls use the tasted model");
  assert.deepEqual(Object.entries(claude.providerInstances).filter(([, instance]) => instance.enabled).map(([id]) => id), ["claudeAgent"]);
  assert.equal(claude.enableAgentBrowserAccess, false);
  assert.equal(claude.linkedEnvironmentsEnabled, false);
  assert.equal(claude.defaultAutoPull, false);
  assert.equal(claude.idleCompaction, "off", "no thread is compacted by a second model call");
  assert.equal(claude.fallbackModelSelection, null);
  assert.ok(claude.providerInstances.claudeAgent.environment.some((variable) => variable.name === "CLAUDE_CODE_OAUTH_TOKEN" && variable.value === TOKEN && variable.sensitive));
  assert.equal(JSON.stringify(t3Settings({ variant: viaClaude, paths })).includes(TOKEN), false, "the evidence copy is redacted");
  const codex = t3Settings({ variant: viaCodex, paths });
  assert.deepEqual(codex.defaultModelSelection.options, [{ id: "reasoningEffort", value: "high" }]);
  assert.equal(codex.providerInstances.codex.config.homePath, "/a/codex-home");
  assert.equal(codex.providerInstances.claudeAgent.enabled, false);
});

test("T3 turns start one thread and send to it exactly; results must complete with a reply", () => {
  assert.deepEqual(buildT3TurnArgs({ t3Home: "/a/t3-home", workspace: "/a/workspace", title: "Kitchen respond" }), ["thread", "start", "--base-dir", "/a/t3-home", "--wait", "--json", "--title", "Kitchen respond", "/a/workspace", "-"]);
  assert.deepEqual(buildT3TurnArgs({ t3Home: "/a/t3-home", workspace: "/a/workspace", threadId: "thread-0001" }), ["thread", "send", "--base-dir", "/a/t3-home", "--wait", "--json", "thread-0001", "-"]);
  assert.throws(() => buildT3TurnArgs({ t3Home: "/a/t3-home", workspace: "/a/workspace", threadId: "x; rm" }), /exact T3 thread id/);
  const done = JSON.stringify({ threadId: "thread-0001", runId: "r", status: "completed", reply: "Hi", error: null });
  assert.equal(parseT3Turn(done).finalMessage, "Hi");
  assert.throws(() => parseT3Turn(done, { threadId: "thread-0002" }), /not thread-0002/);
  assert.throws(() => parseT3Turn(JSON.stringify({ threadId: "thread-0001", status: "waiting", reply: null })), /ended waiting/);
  assert.throws(() => parseT3Turn(`${done}\n${done}`), /exactly one/);
});

test("T3 → Claude Code runs on a scratch server, keeps the refresh token out, scrubs the token, and verifies from Claude Code's own transcripts", async (t) => {
  const f = await setup(t);
  const a = await attempt(f.root, "claude");
  await prepareT3Attempt({ variant: viaClaude, cwd: a.attemptDir, env: f.env });
  await assert.rejects(access(path.join(a.attemptDir, ".git")), /ENOENT/, "no marker: the cook directory is outside any repository");
  const userSettings = JSON.parse(await readFile(path.join(a.attemptDir, "claude-home", "settings.json"), "utf8"));
  assert.equal(userSettings.disableAllHooks, true);
  assert.deepEqual(userSettings.permissions.deny, ["WebFetch", "WebSearch"]);
  const result = await runT3Session({ variant: viaClaude, recipe, workspace: a.workspace, privateDir: a.privateDir, executable: f.t3, env: { ...f.env, CLAUDECODE: "1", T3_MCP_BEARER_TOKEN: "real-server-bearer", CLAUDE_CODE_MESSAGING_TOKEN: "operator-channel" } });
  assert.equal(result.failure, null, result.failure?.message);
  assert.equal(result.threadId, "thread-0001");
  assert.equal(result.cliVersion, "t3 v0.1.6 (fake) › 2.9.9 (Claude Code)");
  assert.equal(result.observedModel, "claude-opus-5-5");
  assert.equal(result.turns[1].finalMessage, "reply to: Now say it plainer.");
  const calls = await f.calls();
  const serve = calls.find((call) => call.cmd === "serve");
  assert.equal(serve.args[serve.args.indexOf("--base-dir") + 1], path.join(a.attemptDir, "t3-home"));
  assert.equal(serve.args[serve.args.indexOf("--host") + 1], "127.0.0.1");
  assert.equal(serve.browser, "1");
  assert.equal(serve.leaked, null, "no inherited provider key reaches T3");
  assert.equal(serve.telemetry, "false", "T3 reports nothing to its vendor");
  assert.deepEqual(serve.sessionEnv, [], "the operator's own Claude Code and T3 session credentials never reach the scratch server");
  const [start, send] = calls.filter((call) => call.cmd !== "serve");
  assert.equal(start.cmd, "start");
  assert.equal(start.prompt, "Respond in this fresh conversation.\n\nRead the entry.");
  assert.equal(send.cmd, "send");
  assert.equal(send.args.at(-2), "thread-0001");
  assert.equal(start.token, TOKEN);
  assert.equal(start.config, path.join(a.attemptDir, "claude-home"));
  // The server is gone, the token-bearing settings are scrubbed, and no file holds the token or the refresh token.
  const { pid } = JSON.parse(await readFile(path.join(a.attemptDir, "t3-home", "userdata", "server-runtime.json"), "utf8"));
  assert.throws(() => process.kill(pid, 0), /ESRCH/);
  await assert.rejects(access(path.join(a.attemptDir, "t3-home", "userdata", "settings.json")), /ENOENT/);
  for (const file of await filesUnder(a.attemptDir)) {
    const text = await readFile(file, "utf8");
    assert.equal(text.includes(TOKEN), false, `${file} holds the access token`);
    assert.equal(text.includes("refresh-never-shared"), false, `${file} holds the refresh token`);
  }
  const evidence = JSON.parse(await readFile(path.join(a.privateDir, "t3-settings.json"), "utf8"));
  assert.equal(evidence.defaultModelSelection.model, "claude-opus-5-5");

  const observed = await verifyT3Identity({ codexHome: a.codexHome, variant: viaClaude, cliVersion: result.cliVersion, result });
  assert.deepEqual(observed.harnessPath, ["t3", "claude-code"]);
  assert.equal(observed.verifiedBy, "claude-code-session-transcripts");
  const altered = structuredClone(result);
  altered.turns[0].finalMessage = "altered";
  await assert.rejects(verifyT3Identity({ codexHome: a.codexHome, variant: viaClaude, cliVersion: result.cliVersion, result: altered }), /final message does not match/);
});

test("T3 stops on a substituted model, a wrong Codex effort, or a failed run", async (t) => {
  const f = await setup(t);
  const a = await attempt(f.root, "swapped");
  await prepareT3Attempt({ variant: viaClaude, cwd: a.attemptDir, env: f.env });
  const swapped = await runT3Session({ variant: viaClaude, recipe, workspace: a.workspace, privateDir: a.privateDir, executable: f.t3, env: { ...f.env, FAKE_SERVED_MODEL: "claude-haiku-5-5" } });
  await assert.rejects(verifyT3Identity({ codexHome: a.codexHome, variant: viaClaude, cliVersion: swapped.cliVersion, result: swapped }), /claude-code recorded claude-haiku-5-5/);

  const b = await attempt(f.root, "codex");
  await prepareT3Attempt({ variant: viaCodex, cwd: b.attemptDir, env: f.env });
  const lowered = await runT3Session({ variant: viaCodex, recipe, workspace: b.workspace, privateDir: b.privateDir, executable: f.t3, env: { ...f.env, FAKE_EFFORT: "low" } });
  assert.equal(lowered.failure, null);
  await assert.rejects(verifyT3Identity({ codexHome: b.codexHome, variant: viaCodex, cliVersion: lowered.cliVersion, result: lowered }), /effort requested high, codex-cli recorded low/);

  const c = await attempt(f.root, "failed");
  await prepareT3Attempt({ variant: viaClaude, cwd: c.attemptDir, env: f.env });
  const failed = await runT3Session({ variant: viaClaude, recipe, workspace: c.workspace, privateDir: c.privateDir, executable: f.t3, env: { ...f.env, FAKE_FAIL: "1" } });
  assert.match(failed.failure.message, /ended failed: provider exploded/);
  assert.equal(failed.turns.length, 1);
  await assert.rejects(access(path.join(c.attemptDir, "t3-home", "userdata", "settings.json")), /ENOENT/);
});

test("a multi-turn T3 → Codex run verifies: Codex appends every turn to one rollout", async (t) => {
  const f = await setup(t);
  const a = await attempt(f.root, "codex-two-turns");
  await prepareT3Attempt({ variant: viaCodex, cwd: a.attemptDir, env: f.env });
  const result = await runT3Session({ variant: viaCodex, recipe, workspace: a.workspace, privateDir: a.privateDir, executable: f.t3, env: f.env });
  assert.equal(result.failure, null, result.failure?.message);
  const observed = await verifyT3Identity({ codexHome: a.codexHome, variant: viaCodex, cliVersion: result.cliVersion, result });
  assert.equal(observed.verifiedBy, "codex-rollouts");
  assert.equal(observed.innerSessions, 1);
});

test("if the Kitchen is killed mid-run, the T3 server stops and the token-bearing settings are deleted", async (t) => {
  const f = await setup(t);
  const a = await attempt(f.root, "killed");
  const settings = path.join(a.attemptDir, "t3-home", "userdata", "settings.json");
  await mkdir(path.dirname(settings), { recursive: true });
  await writeFile(settings, JSON.stringify({ token: TOKEN }), "utf8");
  await mkdir(path.join(path.dirname(settings), "secrets"), { recursive: true });
  // A stand-in Kitchen: starts the scratch server, reports its port, then waits to be killed.
  const kitchen = path.join(f.root, "kitchen.mjs");
  const t3Module = new URL("../lib/taste/t3.mjs", import.meta.url).href;
  await writeFile(kitchen, `import { startT3Server } from ${JSON.stringify(t3Module)};
const server = await startT3Server({ executable: ${JSON.stringify(f.t3)}, t3Home: ${JSON.stringify(path.join(a.attemptDir, "t3-home"))}, workspace: ${JSON.stringify(a.workspace)}, env: { ...process.env, FAKE_LOG: ${JSON.stringify(path.join(f.root, "calls.jsonl"))} } });
console.log(server.port);
setInterval(() => {}, 1000);
`, "utf8");
  const { spawn } = await import("node:child_process");
  const child = spawn(process.execPath, [kitchen], { stdio: ["ignore", "pipe", "inherit"] });
  t.after(() => child.kill("SIGKILL"));
  const port = await new Promise((resolve, reject) => {
    child.stdout.once("data", (chunk) => resolve(Number(String(chunk).trim())));
    child.once("exit", () => reject(new Error("the stand-in Kitchen exited early")));
  });
  const { pid } = JSON.parse(await readFile(path.join(a.attemptDir, "t3-home", "userdata", "server-runtime.json"), "utf8"));
  assert.equal(process.kill(pid, 0), true, "the server is up");
  assert.ok((await fetch(`http://127.0.0.1:${port}/`)).ok);
  child.kill("SIGKILL");
  const deadline = Date.now() + 20_000;
  const alive = () => { try { process.kill(pid, 0); return true; } catch { return false; } };
  while (Date.now() < deadline && alive()) await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(alive(), false, "the orphaned server was stopped");
  while (Date.now() < deadline && (await access(settings).then(() => true, () => false))) await new Promise((resolve) => setTimeout(resolve, 100));
  await assert.rejects(access(settings), /ENOENT/, "the token-bearing settings were deleted");
  await assert.rejects(access(path.join(path.dirname(settings), "secrets")), /ENOENT/);
});

test("a T3 → Claude Code Dish publishes through the runner with its harness path frozen", async (t) => {
  const f = await setup(t);
  const repoRoot = path.join(f.root, "repo");
  const cooked = {
    schemaVersion: 1, id: "demo-conversation", version: "1.0.0", status: "ready", title: "A demo conversation", summary: "A runner test for the T3 path.",
    cuisines: ["conversation-journaling"], origin: "textbook", originNote: "Runner integration test.", tags: ["presence"], kind: "session",
    harness: { workspace: "read", web: "disabled", capabilities: [] }, setup: { instructions: "Respond in this fresh conversation.", fixtures: [] },
    turns: [{ id: "respond", role: "prompt", content: "Read the entry." }, { id: "follow", role: "correction", content: "Now say it plainer." }],
    output: { kind: "session", entry: "output/session.json", include: ["output/session.json"], limits: { maxFiles: 1, maxBytes: 65536 } },
    validation: { mode: "trace", checks: [{ id: "entry", type: "file-exists", required: true, description: "The transcript exists.", target: "output/session.json" }] },
    sourcePath: "catalog/recipes/conversation/demo/recipe.json", fixtureHashes: {},
  };
  cooked.recipeHash = computeRecipeHash(cooked, cooked.fixtureHashes);
  const catalog = { catalogHash: `sha256:${"4".repeat(64)}`, recipes: [cooked] };
  const run = await executeRecipe({ repoRoot, catalog, recipe: cooked, variant: viaClaude, executable: f.t3, env: f.env, nonce: "t3" });
  assert.equal(run.status, "accepted", run.error);
  const dish = JSON.parse(await readFile(path.join(run.dishDirectory, "dish.json"), "utf8"));
  assert.equal(dish.identity.harness, "t3");
  assert.equal(dish.identity.observedModel, "claude-opus-5-5");
  assert.equal(dish.identity.harnessVersion, "t3 v0.1.6 (fake) › 2.9.9 (Claude Code)");
  const attemptDir = path.join(repoRoot, "private/runtime/attempts", run.attemptId);
  const requested = JSON.parse(await readFile(path.join(attemptDir, "requested.json"), "utf8"));
  assert.deepEqual(requested.identity.harnessPath, ["t3", "claude-code"]);
  assert.equal(requested.execution.innerHarness, "claude-code");
  // The workspace and the scratch T3 home sit in the cook directory outside the repo, and the token is gone from it.
  const cook = requested.cookDirectory;
  assert.equal(path.relative(repoRoot, cook).startsWith(".."), true, "the cook directory is outside the repo");
  assert.equal((await readdir(path.join(cook, "t3-home", "userdata"))).includes("settings.json"), false);
  assert.equal(requested.execution.gitBoundary, "cook-directory-outside-repo");
  const receipt = JSON.parse(await readFile(path.join(run.dishDirectory, "receipt.json"), "utf8"));
  assert.deepEqual(receipt.configuration.harnessPath, ["t3", "claude-code"]);
});
