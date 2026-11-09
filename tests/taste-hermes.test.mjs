import assert from "node:assert/strict";
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { computeRecipeHash, sha256 } from "../lib/taste/catalog.mjs";
import { resolveHarnessAdapter } from "../lib/taste/harness-adapters.mjs";
import {
  PERSONAL_WRITES_ENV, buildHermesTurnArgs, hermesEnvironment, hermesProcessEnv, parseHermesJsonl, prepareHermesAttempt, resolveHermesRuntime, runHermesSession, verifyHermesIdentity,
} from "../lib/taste/hermes.mjs";
import { executeRecipe } from "../lib/taste/runner.mjs";

const SESSION = "20261108_131309_66bdb7";
const base = { runtime: "linux-host", sandbox: "disabled", approvalPolicy: "yolo", nativeWeb: "disabled", networkPolicy: "not-enforced", filesystemBoundary: "not-a-secrecy-boundary" };
const cleanProfile = { id: "hermes-linux-host-clean-anthropic-v1", label: "via Hermes · clean home · Anthropic route", ...base, environment: "clean" };
const personalProfile = { id: "hermes-linux-host-personal-anthropic-v1", label: "via Hermes · personal profile · Anthropic route", ...base, environment: "personal", harnessProfile: "rose" };
const clean = {
  id: "hermes-haiku-5-5-high-clean", label: "Haiku 5.5 · High · via Hermes · clean (Anthropic)", provider: "anthropic", model: "claude-haiku-5-5",
  harness: "hermes", reasoningEffort: "high", serviceTier: "default", personality: "none", capabilities: ["files", "shell"], executionProfile: cleanProfile,
  configHash: `sha256:${"3".repeat(64)}`,
};
const openRouterProfile = { id: "hermes-linux-host-clean-openrouter-v1", label: "via Hermes · clean home · OpenRouter route", ...base, environment: "clean", route: "openrouter", upstream: "google-ai-studio" };
const viaOpenRouter = {
  ...clean, id: "hermes-openrouter-gemini-4-argon-high-clean", label: "Gemini 4 Argon · High · via Hermes · clean (OpenRouter)",
  provider: "google", model: "google/gemini-4-argon", executionProfile: openRouterProfile,
};
const personal = { ...clean, id: "hermes-haiku-5-5-high-rose", label: "Haiku 5.5 · High · via Hermes · rose profile (Anthropic)", executionProfile: personalProfile };

// A fake Hermes: records its invocation, writes the session rows real Hermes writes, and emits stream-json.
const FAKE = `#!/usr/bin/env node
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("Hermes Agent v9.9.9 (fake)"); console.log("Install directory: /nowhere"); process.exit(0); }
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
appendFileSync(process.env.FAKE_LOG, JSON.stringify({ args, cwd: process.cwd(), home: process.env.HERMES_HOME ?? null, lazy: process.env.HERMES_DISABLE_LAZY_INSTALLS ?? null, leaked: process.env.ANTHROPIC_API_KEY ?? null, routeKey: process.env.OPENROUTER_API_KEY ?? null }) + "\\n");
const profile = flag("-p");
const home = profile ? path.join(process.env.TASTE_HERMES_ROOT, "profiles", profile) : process.env.HERMES_HOME;
mkdirSync(home, { recursive: true });
const resume = flag("--resume");
const session = resume ?? process.env.FAKE_SESSION;
const requested = flag("-m");
const served = (resume ? process.env.FAKE_RESUMED_MODEL : process.env.FAKE_FIRST_MODEL) || requested;
const db = new DatabaseSync(path.join(home, "state.db"));
db.exec("CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, source TEXT, model TEXT, model_config TEXT, billing_provider TEXT, billing_base_url TEXT); CREATE TABLE IF NOT EXISTS session_model_usage (session_id TEXT, model TEXT, billing_provider TEXT, billing_base_url TEXT, task TEXT, api_call_count INTEGER, PRIMARY KEY (session_id, model, billing_provider, billing_base_url, task))");
const baseUrl = process.env.FAKE_BASE_URL || "https://api.anthropic.com";
db.prepare("INSERT OR IGNORE INTO sessions VALUES (?, 'tool', ?, ?, ?, ?)").run(session, requested, JSON.stringify({ reasoning_config: { enabled: true, effort: process.env.FAKE_EFFORT || flag("--reasoning") } }), flag("--provider"), baseUrl);
const fellBack = served !== requested;
if (!(resume && process.env.FAKE_BLOCKED_RESUME)) db.prepare("INSERT INTO session_model_usage VALUES (?, ?, ?, ?, '', 1) ON CONFLICT DO UPDATE SET api_call_count = api_call_count + 1").run(session, served, fellBack ? "openai-codex" : flag("--provider"), fellBack ? "https://chatgpt.com/backend-api/codex" : baseUrl);
if (process.env.FAKE_AUX) db.prepare("INSERT OR IGNORE INTO session_model_usage VALUES (?, 'claude-haiku-5-5', 'anthropic', 'https://api.anthropic.com', 'title', 1)").run(session);
db.close();
if (!profile) writeFileSync(path.join(home, "auth.json"), "{}");
const query = readFileSync(flag("--query-file"), "utf8");
const emit = (event) => console.log(JSON.stringify({ ...event, timestamp: 1 }));
emit({ type: "system", subtype: "init", model: requested, session_id: session });
emit({ type: "tool_use", name: "read_file", input: { path: "inputs/context.txt" } });
emit({ type: "text", text: "answer" });
if (process.env.FAKE_FAIL) emit({ type: "result", session_id: session, exit_code: 1, text: "", error: "provider exploded", tokens: {}, duration_ms: 1 });
else emit({ type: "result", session_id: session, exit_code: 0, text: "answer to: " + query, tokens: { input: 3, output: 2, total: 5, cache_read: 0, cache_write: 0 }, duration_ms: 5 });
process.exit(process.env.FAKE_FAIL ? 1 : 0);
`;

async function setup(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "taste-hermes-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const executable = path.join(root, "fake-hermes.mjs");
  await writeFile(executable, FAKE, "utf8");
  await chmod(executable, 0o755);
  const claudeDir = path.join(root, "claude");
  await mkdir(claudeDir);
  await writeFile(path.join(claudeDir, ".credentials.json"), "{}\n");
  const hermesRoot = path.join(root, "hermes-root");
  await mkdir(path.join(hermesRoot, "profiles", "rose"), { recursive: true });
  await writeFile(path.join(hermesRoot, "profiles", "rose", "config.yaml"), "model: {}\n");
  const log = path.join(root, "calls.jsonl");
  const env = { FAKE_LOG: log, FAKE_SESSION: SESSION, CLAUDE_CONFIG_DIR: claudeDir, TASTE_HERMES_ROOT: hermesRoot };
  const calls = async () => (await readFile(log, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  return { root, executable, env, calls, hermesRoot };
}

async function attempt(root, name) {
  const attemptDir = path.join(root, name);
  await mkdir(path.join(attemptDir, "workspace"), { recursive: true });
  return { attemptDir, workspace: path.join(attemptDir, "workspace"), privateDir: path.join(attemptDir, "raw"), codexHome: path.join(attemptDir, "codex-home") };
}

const recipe = { setup: { instructions: "Set the table." }, turns: [{ id: "make", content: "Cook" }, { id: "correct", content: "Correct" }] };

test("Hermes plans pin route, model, effort and toolsets; clean ignores rules, personal selects its profile", () => {
  const fresh = buildHermesTurnArgs({ variant: clean, workspace: "/tmp/work", queryFile: "/tmp/q.txt" });
  assert.deepEqual(fresh, ["chat", "--query-file", "/tmp/q.txt", "--oneshot", "--format", "stream-json", "--provider", "anthropic", "-m", "claude-haiku-5-5",
    "--reasoning", "high", "-t", "file,terminal", "--yolo", "--source", "tool", "--in", "/tmp/work", "--ignore-rules"]);
  const resumed = buildHermesTurnArgs({ variant: clean, workspace: "/tmp/work", queryFile: "/tmp/q.txt", threadId: SESSION });
  assert.equal(resumed[resumed.indexOf("--resume") + 1], SESSION);
  const mine = buildHermesTurnArgs({ variant: personal, workspace: "/tmp/work", queryFile: "/tmp/q.txt" });
  assert.deepEqual(mine.slice(0, 3), ["-p", "rose", "chat"]);
  assert.equal(mine.includes("--ignore-rules"), false);
  assert.throws(() => buildHermesTurnArgs({ variant: clean, workspace: "/tmp/work", queryFile: "/tmp/q.txt", threadId: "latest; rm" }), /exact Hermes session id/);
  assert.throws(() => buildHermesTurnArgs({ variant: clean, workspace: "relative", queryFile: "/tmp/q.txt" }), /absolute path/);
});

test("Hermes configurations validate model, effort, tier and the personal profile name", () => {
  assert.doesNotThrow(() => resolveHarnessAdapter(clean));
  assert.doesNotThrow(() => resolveHarnessAdapter(personal));
  assert.throws(() => resolveHarnessAdapter({ ...clean, model: "gpt-6-luna" }), /Anthropic model/);
  assert.throws(() => resolveHarnessAdapter({ ...clean, reasoningEffort: "adaptive" }), /reasoning effort/);
  assert.throws(() => resolveHarnessAdapter({ ...clean, serviceTier: "fast" }), /default tier/);
  assert.throws(() => resolveHarnessAdapter({ ...clean, executionProfile: { ...cleanProfile, environment: "personal" } }), /environment must be clean/);
  const unnamed = { ...personalProfile };
  delete unnamed.harnessProfile;
  assert.throws(() => resolveHarnessAdapter({ ...personal, executionProfile: unnamed }), /must name its harnessProfile/);
});

test("a caller's env cannot bring back a credential or a Hermes home, and the environment must be declared", () => {
  const env = { ANTHROPIC_API_KEY: "sk-leak", HERMES_HOME: "/real/.hermes", OPENROUTER_API_KEY: "or-leak", FAKE_LOG: "/tmp/log" };
  const processEnv = hermesProcessEnv({ variant: clean, hermesHome: "/tmp/attempt/hermes-home", env });
  assert.equal(processEnv.ANTHROPIC_API_KEY, undefined);
  assert.equal(processEnv.OPENROUTER_API_KEY, undefined);
  assert.equal(processEnv.HERMES_HOME, "/tmp/attempt/hermes-home");
  assert.equal(processEnv.FAKE_LOG, "/tmp/log");
  assert.equal(hermesProcessEnv({ variant: personal, hermesHome: "/x", env }).HERMES_HOME, undefined);
  assert.equal(hermesEnvironment(clean), "clean");
  assert.equal(hermesEnvironment(personal), "personal");
  const undeclared = { ...clean, executionProfile: { ...cleanProfile, environment: undefined } };
  assert.throws(() => hermesEnvironment(undeclared), /clean or personal environment/);
});

test("Hermes JSONL requires one init and one successful result, and an exact resume", () => {
  const lines = (...events) => events.map((event) => JSON.stringify(event)).join("\n");
  const init = { type: "system", subtype: "init", model: "claude-haiku-5-5", session_id: SESSION };
  const result = { type: "result", session_id: SESSION, exit_code: 0, text: "Done", tokens: { input: 1, output: 1 } };
  const parsed = parseHermesJsonl(lines(init, { type: "text", text: "Done" }, result));
  assert.equal(parsed.threadId, SESSION);
  assert.equal(parsed.finalMessage, "Done");
  assert.deepEqual(parsed.usage, { input: 1, output: 1 });
  assert.throws(() => parseHermesJsonl(lines(init, { ...result, exit_code: 1, error: "boom" })), /reported failure: boom/);
  assert.throws(() => parseHermesJsonl(lines(init, init, result)), /exactly one/);
  assert.throws(() => parseHermesJsonl(lines(result, init)), /before its init/);
  assert.throws(() => parseHermesJsonl(lines(init, result), { resumedFrom: "20261108_000000_aaaaaa" }), /resumed/);
  assert.throws(() => parseHermesJsonl("not json"), /Invalid Hermes JSONL/);
});

test("clean Hermes runs both turns in one fresh home, resumes exactly, verifies the recorded route, and drops the borrowed login", async (t) => {
  const f = await setup(t);
  const a = await attempt(f.root, "clean");
  await prepareHermesAttempt({ variant: clean, cwd: a.attemptDir, env: f.env });
  const config = await readFile(path.join(a.attemptDir, "hermes-home", "config.yaml"), "utf8");
  assert.match(config, /provider: anthropic\n {2}default: claude-haiku-5-5/u);
  assert.doesNotMatch(config, /fallback|secrets|plugins|mcp/u);
  await access(path.join(a.attemptDir, ".git"));
  const result = await runHermesSession({ variant: clean, recipe, workspace: a.workspace, privateDir: a.privateDir, executable: f.executable, env: { ...f.env, FAKE_AUX: "1" } });
  assert.equal(result.failure, null);
  assert.equal(result.threadId, SESSION);
  assert.equal(result.cliVersion, "Hermes Agent v9.9.9 (fake)");
  assert.equal(result.turns[0].finalMessage, "answer to: Set the table.\n\nCook");
  assert.equal(result.turns[1].finalMessage, "answer to: Correct");
  const calls = await f.calls();
  assert.equal(calls[0].args.includes("--resume"), false);
  assert.equal(calls[1].args[calls[1].args.indexOf("--resume") + 1], SESSION);
  for (const call of calls) {
    assert.equal(call.home, path.join(a.attemptDir, "hermes-home"));
    assert.equal(call.lazy, "1");
    assert.equal(call.cwd, a.workspace);
  }
  await assert.rejects(access(path.join(a.attemptDir, "hermes-home", "auth.json")), /ENOENT/);
  const observed = await verifyHermesIdentity({ codexHome: a.codexHome, variant: clean, cliVersion: result.cliVersion, result, env: f.env });
  assert.equal(observed.model, "claude-haiku-5-5");
  assert.equal(observed.route, "anthropic");
  assert.equal(observed.mainLoopCalls, 2);
  assert.deepEqual(observed.auxiliaryCalls, [{ task: "title", model: "claude-haiku-5-5", provider: "anthropic", apiCalls: 1 }]);
  assert.equal(observed.verifiedBy, "hermes-state-db-session-model-usage");

  const tampered = structuredClone(result);
  tampered.turns[1].argv[tampered.turns[1].argv.indexOf("-m") + 1] = "claude-opus-5-5";
  await assert.rejects(verifyHermesIdentity({ codexHome: a.codexHome, variant: clean, cliVersion: result.cliVersion, result: tampered, env: f.env }), /exactly one -m claude-haiku-5-5/);
  const altered = structuredClone(result);
  altered.turns[0].finalMessage = "altered";
  await assert.rejects(verifyHermesIdentity({ codexHome: a.codexHome, variant: clean, cliVersion: result.cliVersion, result: altered, env: f.env }), /final message does not match/);
});

test("Hermes stops on a silent fallback, a different recorded effort, or a failed result", async (t) => {
  const f = await setup(t);
  const fallback = await attempt(f.root, "fallback");
  const fellBack = await runHermesSession({ variant: clean, recipe, workspace: fallback.workspace, privateDir: fallback.privateDir, executable: f.executable, env: { ...f.env, FAKE_FIRST_MODEL: "gpt-6-astra" } });
  assert.match(fellBack.failure.message, /model requested claude-haiku-5-5, observed gpt-6-astra/);
  assert.match(fellBack.failure.message, /provider route requested anthropic, observed openai-codex/);
  assert.equal(fellBack.turns.length, 1, "stop before spending a second turn");
  await assert.rejects(verifyHermesIdentity({ codexHome: fallback.codexHome, variant: clean, cliVersion: fellBack.cliVersion, result: fellBack, env: f.env }), /failed turn/);

  const late = await attempt(f.root, "late-fallback");
  const lateResult = await runHermesSession({ variant: clean, recipe, workspace: late.workspace, privateDir: late.privateDir, executable: f.executable, env: { ...f.env, FAKE_RESUMED_MODEL: "claude-sonnet-5-5" } });
  assert.match(lateResult.failure.message, /observed claude-sonnet-5-5/);
  assert.equal(lateResult.turns.length, 2);

  const blocked = await attempt(f.root, "blocked");
  const hooked = await runHermesSession({ variant: clean, recipe, workspace: blocked.workspace, privateDir: blocked.privateDir, executable: f.executable, env: { ...f.env, FAKE_BLOCKED_RESUME: "1" } });
  assert.match(hooked.failure.message, /this turn recorded no new main-loop API call/, "an earlier turn's call cannot vouch for a turn that never reached the model");
  assert.equal(hooked.turns.length, 2);

  const effort = await attempt(f.root, "effort");
  const clamped = await runHermesSession({ variant: clean, recipe, workspace: effort.workspace, privateDir: effort.privateDir, executable: f.executable, env: { ...f.env, FAKE_EFFORT: "medium" } });
  assert.match(clamped.failure.message, /effort requested high, session .* recorded medium/);

  const failed = await attempt(f.root, "failed");
  const broken = await runHermesSession({ variant: clean, recipe, workspace: failed.workspace, privateDir: failed.privateDir, executable: f.executable, env: { ...f.env, FAKE_FAIL: "1" } });
  assert.match(broken.failure.message, /provider exploded/);
  await assert.rejects(access(path.join(failed.attemptDir, "hermes-home", "auth.json")), /ENOENT/, "the borrowed login is removed after a failure too");
});

test("personal Hermes refuses without explicit consent to profile writes and needs an existing profile", async (t) => {
  const f = await setup(t);
  const a = await attempt(f.root, "refused");
  const withoutConsent = { ...f.env };
  const saved = process.env[PERSONAL_WRITES_ENV];
  delete process.env[PERSONAL_WRITES_ENV];
  t.after(() => { if (saved !== undefined) process.env[PERSONAL_WRITES_ENV] = saved; });
  await assert.rejects(prepareHermesAttempt({ variant: personal, cwd: a.attemptDir, env: withoutConsent }), /Refusing a personal Hermes run.*state\.db/);
  const b = await attempt(f.root, "missing-profile");
  const ghost = { ...personal, executionProfile: { ...personalProfile, harnessProfile: "ghost" } };
  await assert.rejects(prepareHermesAttempt({ variant: ghost, cwd: b.attemptDir, env: { ...f.env, [PERSONAL_WRITES_ENV]: "1" } }), /profile ghost does not exist/);
  const c = await attempt(f.root, "no-login");
  await assert.rejects(prepareHermesAttempt({ variant: clean, cwd: c.attemptDir, env: { ...f.env, CLAUDE_CONFIG_DIR: path.join(f.root, "nowhere") } }), /borrows the Claude Code login/);
});

test("clean runs use the committed Hermes environment's own entry point unless an executable is pinned", async (t) => {
  const f = await setup(t);
  const venv = path.join(f.hermesRoot, "installs", "abc", "environments", "gen", "venv");
  await mkdir(path.join(venv, "bin"), { recursive: true });
  await writeFile(path.join(venv, "bin", "hermes"), "#!/bin/sh\n");
  await writeFile(path.join(f.hermesRoot, "installs", "abc", "facts.json"), JSON.stringify({ packages: { venv: { environment: venv } } }));
  assert.equal(await resolveHermesRuntime({ variant: clean, env: f.env }), path.join(venv, "bin", "hermes"));
  assert.equal(await resolveHermesRuntime({ variant: personal, env: f.env }), "hermes");
  assert.equal(await resolveHermesRuntime({ variant: clean, executable: "/opt/hermes", env: f.env }), "/opt/hermes");
  await rm(path.join(f.hermesRoot, "installs"), { recursive: true });
  await assert.rejects(resolveHermesRuntime({ variant: clean, env: f.env }), /found 0/);
});

async function kitchen(root) {
  const recipeDir = path.join(root, "catalog/recipes/conversation/demo");
  await mkdir(path.join(recipeDir, "fixtures"), { recursive: true });
  await writeFile(path.join(recipeDir, "fixtures/context.txt"), "public context\n");
  const cooked = {
    schemaVersion: 1, id: "demo-session", version: "1.0.0", status: "ready", title: "A demo session recipe",
    summary: "A sufficiently detailed demo for runner testing.", domain: "conversation", origin: "textbook", originNote: "A conventional runner integration test.",
    tags: ["presence"], kind: "session", harness: { workspace: "read", web: "disabled", capabilities: [] },
    setup: { instructions: "Read the mounted public context.", fixtures: [{ id: "context", path: "fixtures/context.txt", mountAs: "inputs/context.txt", public: true, mediaType: "text/plain" }] },
    turns: [{ id: "opening", role: "prompt", content: "Respond once." }, { id: "correction", role: "correction", content: "Now respond more directly." }],
    output: { kind: "session", entry: "output/session.json", include: ["output/session.json"], limits: { maxFiles: 2, maxBytes: 32768 } },
    validation: { mode: "completeness", checks: [{ id: "entry", type: "file-exists", required: true, description: "The transcript exists.", target: "output/session.json" }] },
    sourcePath: "catalog/recipes/conversation/demo/recipe.json", fixtureHashes: { context: sha256("public context\n") },
  };
  cooked.recipeHash = computeRecipeHash(cooked, cooked.fixtureHashes);
  return { recipe: cooked, catalog: { catalogHash: `sha256:${"4".repeat(64)}`, recipes: [cooked] } };
}

test("a cooked clean Hermes Dish is public; a personal one goes to private/dishes and runs as its profile", async (t) => {
  const f = await setup(t);
  const repoRoot = path.join(f.root, "repo");
  const { recipe: cooked, catalog } = await kitchen(repoRoot);

  const cleanRun = await executeRecipe({ repoRoot, catalog, recipe: cooked, variant: clean, executable: f.executable, env: f.env, nonce: "clean" });
  assert.equal(cleanRun.status, "accepted", cleanRun.error);
  assert.equal(path.relative(repoRoot, cleanRun.dishDirectory).split(path.sep)[0], "dishes");
  const attemptDir = path.join(repoRoot, "private/runtime/attempts", cleanRun.attemptId);
  const requested = JSON.parse(await readFile(path.join(attemptDir, "requested.json"), "utf8"));
  assert.equal(requested.execution.hermesHome, "fresh-per-attempt");
  assert.equal(requested.execution.providerAuth, "borrowed-claude-code-login");
  assert.equal(requested.execution.toolsets, "file,terminal");
  const observed = JSON.parse(await readFile(path.join(attemptDir, "observed.json"), "utf8"));
  assert.equal(observed.environment, "clean");
  await assert.rejects(access(path.join(attemptDir, "hermes-home", "auth.json")), /ENOENT/);
  const dish = JSON.parse(await readFile(path.join(cleanRun.dishDirectory, "dish.json"), "utf8"));
  assert.equal(dish.identity.observedModel, "claude-haiku-5-5");
  assert.equal(dish.identity.harnessVersion, "Hermes Agent v9.9.9 (fake)");
  assert.equal("visibility" in dish, false);

  const personalRun = await executeRecipe({ repoRoot, catalog, recipe: cooked, variant: personal, executable: f.executable, env: { ...f.env, [PERSONAL_WRITES_ENV]: "1" }, nonce: "rose" });
  assert.equal(personalRun.status, "accepted", personalRun.error);
  assert.equal(path.relative(repoRoot, personalRun.dishDirectory).split(path.sep).slice(0, 2).join("/"), "private/dishes");
  const personalDish = JSON.parse(await readFile(path.join(personalRun.dishDirectory, "dish.json"), "utf8"));
  assert.equal(personalDish.visibility, "private");
  const personalCalls = (await f.calls()).filter((call) => call.args[0] === "-p");
  assert.equal(personalCalls.length, 2);
  for (const call of personalCalls) {
    assert.deepEqual(call.args.slice(0, 2), ["-p", "rose"]);
    assert.equal(call.home, null, "a personal run inherits no HERMES_HOME");
    assert.equal(call.args.includes("--ignore-rules"), false);
  }
  const personalObserved = JSON.parse(await readFile(path.join(repoRoot, "private/runtime/attempts", personalRun.attemptId, "observed.json"), "utf8"));
  assert.equal(personalObserved.harnessProfile, "rose");
});

test("the OpenRouter route pins its maker's slug, carries only the route key, and verifies the recorded OpenRouter route", async (t) => {
  assert.doesNotThrow(() => resolveHarnessAdapter(viaOpenRouter));
  assert.doesNotThrow(() => resolveHarnessAdapter({ ...viaOpenRouter, provider: "anthropic", model: "anthropic/claude-opus-5.5" }));
  assert.throws(() => resolveHarnessAdapter({ ...viaOpenRouter, provider: "openrouter" }), /provider must be the model's maker google/);
  assert.throws(() => resolveHarnessAdapter({ ...viaOpenRouter, model: "~google/gemini-latest" }), /pinned maker\/model slug/);
  assert.throws(() => resolveHarnessAdapter({ ...viaOpenRouter, executionProfile: { ...openRouterProfile, route: undefined } }), /route must be openrouter \(omitted\)/);
  assert.throws(() => resolveHarnessAdapter({ ...clean, executionProfile: { ...cleanProfile, route: "openrouter" } }), /must omit route/);
  assert.throws(() => resolveHarnessAdapter({ ...viaOpenRouter, executionProfile: { ...openRouterProfile, upstream: undefined } }), /upstream pin must be one of/);
  assert.throws(() => resolveHarnessAdapter({ ...clean, executionProfile: { ...cleanProfile, upstream: "anthropic" } }), /must omit upstream/);
  assert.deepEqual(buildHermesTurnArgs({ variant: viaOpenRouter, workspace: "/tmp/work", queryFile: "/tmp/q.txt" }).slice(6, 10), ["--provider", "openrouter", "-m", "google/gemini-4-argon"]);

  const f = await setup(t);
  const a = await attempt(f.root, "openrouter");
  await assert.rejects(prepareHermesAttempt({ variant: viaOpenRouter, cwd: a.attemptDir, env: { ...f.env, OPENROUTER_API_KEY: "" } }), /needs OPENROUTER_API_KEY/);
  await rm(path.join(a.attemptDir, ".git"));
  // The route key is the only credential that survives the scrub; Anthropic's does not.
  const env = { ...f.env, OPENROUTER_API_KEY: "sk-or-test", ANTHROPIC_API_KEY: "sk-ant-leak", FAKE_BASE_URL: "https://openrouter.ai/api/v1" };
  await prepareHermesAttempt({ variant: viaOpenRouter, cwd: a.attemptDir, env });
  const config = await readFile(path.join(a.attemptDir, "hermes-home", "config.yaml"), "utf8");
  assert.match(config, /provider: openrouter\n {2}default: google\/gemini-4-argon/u);
  assert.match(config, /adopt_external_logins: false/u);
  assert.match(config, /provider_routing:\n {2}only:\n {4}- google-ai-studio\n/u);
  const result = await runHermesSession({ variant: viaOpenRouter, recipe, workspace: a.workspace, privateDir: a.privateDir, executable: f.executable, env });
  assert.equal(result.failure, null, result.failure?.message);
  for (const call of await f.calls()) {
    assert.equal(call.routeKey, "sk-or-test");
    assert.equal(call.leaked, null);
  }
  const observed = await verifyHermesIdentity({ codexHome: a.codexHome, variant: viaOpenRouter, cliVersion: result.cliVersion, result, env });
  assert.equal(observed.route, "openrouter");
  assert.equal(observed.endpoint, "https://openrouter.ai/api/v1");
  assert.equal(observed.provider, "google");

  const b = await attempt(f.root, "openrouter-elsewhere");
  await prepareHermesAttempt({ variant: viaOpenRouter, cwd: b.attemptDir, env });
  const elsewhere = await runHermesSession({ variant: viaOpenRouter, recipe, workspace: b.workspace, privateDir: b.privateDir, executable: f.executable, env: { ...env, FAKE_BASE_URL: "https://api.anthropic.com" } });
  assert.match(elsewhere.failure.message, /endpoint requested https:\/\/openrouter.ai\/api\/v1, observed https:\/\/api.anthropic.com/);
});
