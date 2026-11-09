import assert from "node:assert/strict";
import { access, chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { computeRecipeHash, sha256 } from "../lib/taste/catalog.mjs";
import { resolveHarnessAdapter } from "../lib/taste/harness-adapters.mjs";
import {
  buildHermesTurnArgs, currentHermesSetupDigest, hermesEnvironment, hermesProcessEnv, parseHermesJsonl, prepareHermesAttempt, resolveHermesRuntime, runHermesSession, verifyHermesIdentity,
} from "../lib/taste/hermes.mjs";
import { executeRecipe } from "../lib/taste/runner.mjs";

const SESSION = "20261108_131309_66bdb7";
const base = { runtime: "linux-host", sandbox: "disabled", approvalPolicy: "yolo", nativeWeb: "disabled", networkPolicy: "not-enforced", filesystemBoundary: "not-a-secrecy-boundary" };
const cleanProfile = { id: "hermes-linux-host-clean-anthropic-v1", label: "via Hermes · clean home · Anthropic route", ...base, environment: "clean" };
const snapshotProfile = { id: "hermes-linux-host-snapshot-anthropic-v1", label: "via Hermes · profile snapshot · Anthropic route", ...base, environment: "snapshot", harnessProfile: "rose", memory: "on", connections: "off" };
const clean = {
  id: "hermes-haiku-5-5-high-clean", label: "Haiku 5.5 · High · via Hermes · clean (Anthropic)", provider: "anthropic", model: "claude-haiku-5-5",
  harness: "hermes", reasoningEffort: "high", serviceTier: "default", personality: "none", capabilities: ["files", "shell"], executionProfile: cleanProfile,
  configHash: `sha256:${"3".repeat(64)}`,
};
const snapshot = { ...clean, id: "hermes-haiku-5-5-high-snapshot-rose", label: "Haiku 5.5 · High · via Hermes · rose snapshot (Anthropic)", executionProfile: snapshotProfile };
const withToggles = (toggles) => ({ ...snapshot, id: `${snapshot.id}-${Object.values(toggles).join("-")}`, executionProfile: { ...snapshotProfile, ...toggles } });
const openRouterProfile = { id: "hermes-linux-host-clean-openrouter-v1", label: "via Hermes · clean home · OpenRouter route", ...base, environment: "clean", route: "openrouter", upstream: "google-ai-studio" };
const viaOpenRouter = {
  ...clean, id: "hermes-openrouter-gemini-4-argon-high-clean", label: "Gemini 4 Argon · High · via Hermes · clean (OpenRouter)",
  provider: "google", model: "google/gemini-4-argon", executionProfile: openRouterProfile,
};

// A fake Hermes: records its invocation and the soul its home holds, writes the
// session rows real Hermes writes (plus a borrowed login and a credential file a
// later Hermes might add), and emits stream-json. It refuses -p: Kitchen never
// runs a profile in place.
const FAKE = `#!/usr/bin/env node
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("Hermes Agent v9.9.9 (fake)"); console.log("Install directory: /nowhere"); process.exit(0); }
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
if (args.includes("-p")) process.exit(64);
const home = process.env.HERMES_HOME;
let soul = null;
try { soul = readFileSync(path.join(home, "SOUL.md"), "utf8"); } catch {}
appendFileSync(process.env.FAKE_LOG, JSON.stringify({ args, cwd: process.cwd(), home: home ?? null, soul, lazy: process.env.HERMES_DISABLE_LAZY_INSTALLS ?? null, leaked: process.env.ANTHROPIC_API_KEY ?? null, routeKey: process.env.OPENROUTER_API_KEY ?? null }) + "\\n");
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
writeFileSync(path.join(home, "auth.json"), "{}");
writeFileSync(path.join(home, ".anthropic_oauth.json"), "{}");
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
  await fakeRose(root, path.join(hermesRoot, "profiles", "rose"));
  const log = path.join(root, "calls.jsonl");
  const env = { FAKE_LOG: log, FAKE_SESSION: SESSION, CLAUDE_CONFIG_DIR: claudeDir, TASTE_HERMES_ROOT: hermesRoot };
  const calls = async () => (await readFile(log, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  return { root, executable, env, calls, hermesRoot };
}

/** A stand-in rose profile: soul by symlink, skills, memories, plugins, secrets and gateway state Kitchen must leave behind. */
async function fakeRose(root, rose) {
  await mkdir(path.join(rose, "skills", "tududi"), { recursive: true });
  await mkdir(path.join(rose, "memories"), { recursive: true });
  await mkdir(path.join(rose, "plugins", "journal"), { recursive: true });
  await mkdir(path.join(rose, "sessions"), { recursive: true });
  const soul = path.join(root, "rose-soul.md");
  await writeFile(soul, "I am Rose.\n");
  await symlink(soul, path.join(rose, "SOUL.md"));
  await writeFile(path.join(rose, ".no-bundled-skills"), "kept off\n");
  await writeFile(path.join(rose, "skills", "tududi", "SKILL.md"), "---\nname: tududi\n---\nTasks.\n");
  await writeFile(path.join(rose, "memories", "MEMORY.md"), "Burooj cooks on Sundays.\n");
  await writeFile(path.join(rose, "memories", "USER.md"), "Prefers plain answers.\n");
  await writeFile(path.join(rose, "memories", "MEMORY.md.lock"), "");
  await writeFile(path.join(rose, "plugins", "journal", "plugin.yaml"), "name: journal\n");
  await writeFile(path.join(rose, ".env"), "TELEGRAM_TOKEN=never-copied\n");
  await writeFile(path.join(rose, "auth.json"), "{\"secret\":\"never-copied\"}\n");
  await writeFile(path.join(rose, "sessions", "old.json"), "{}\n");
  await writeFile(path.join(rose, "config.yaml"), [
    "model:", "  provider: anthropic", "  default: claude-opus-5-5",
    "fallback_providers:", "  - provider: openai-codex", "    model: gpt-6-astra",
    "secrets:", "  command:", "    enabled: true", "    command: /home/me/.local/bin/bjs-env hermes-rose",
    "memory:", "  provider: honcho", "  memory_char_limit: 2200",
    "agent:", "  reasoning_effort: medium", "  reasoning_overrides:", "    claude-haiku-5-5: low",
    "platforms:", "  telegram:", "    extra: {}", "discord:", "  require_mention: true", "cron:", "  mirror_delivery: true",
    "plugins:", "  enabled: [journal]", "mcp_servers:", "  tududi:", "    command: /usr/bin/python3", "    args: [mcp.py]",
    "skills:", "  auto_load: [./tududi]", "_config_version: 50", "",
  ].join("\n"));
}

async function listTree(root, relative = "") {
  const entries = [];
  for (const name of (await readdir(path.join(root, relative))).sort()) {
    const child = relative ? `${relative}/${name}` : name;
    if ((await lstat(path.join(root, child))).isDirectory()) entries.push(...await listTree(root, child));
    else entries.push(child);
  }
  return entries;
}

async function attempt(root, name) {
  const attemptDir = path.join(root, name);
  await mkdir(path.join(attemptDir, "workspace"), { recursive: true });
  return { attemptDir, workspace: path.join(attemptDir, "workspace"), privateDir: path.join(attemptDir, "raw"), codexHome: path.join(attemptDir, "codex-home") };
}

const recipe = { setup: { instructions: "Set the table." }, turns: [{ id: "make", content: "Cook" }, { id: "correct", content: "Correct" }] };

test("Hermes plans pin route, model, effort and toolsets; clean ignores rules, a snapshot keeps its copied profile and never selects one", () => {
  const fresh = buildHermesTurnArgs({ variant: clean, workspace: "/tmp/work", queryFile: "/tmp/q.txt" });
  assert.deepEqual(fresh, ["chat", "--query-file", "/tmp/q.txt", "--oneshot", "--format", "stream-json", "--provider", "anthropic", "-m", "claude-haiku-5-5",
    "--reasoning", "high", "-t", "file,terminal", "--yolo", "--source", "tool", "--in", "/tmp/work", "--ignore-rules"]);
  const resumed = buildHermesTurnArgs({ variant: clean, workspace: "/tmp/work", queryFile: "/tmp/q.txt", threadId: SESSION });
  assert.equal(resumed[resumed.indexOf("--resume") + 1], SESSION);
  const mine = buildHermesTurnArgs({ variant: snapshot, workspace: "/tmp/work", queryFile: "/tmp/q.txt" });
  assert.equal(mine[0], "chat");
  assert.equal(mine.includes("-p"), false, "a snapshot is a copied home, never -p rose");
  assert.equal(mine.includes("--ignore-rules"), false);
  assert.throws(() => buildHermesTurnArgs({ variant: snapshot, workspace: "/tmp/work", queryFile: "/tmp/q.txt", toolsets: "file,terminal,mcp-tududi" }), /must be file,terminal, not/);
  const connected = buildHermesTurnArgs({ variant: withToggles({ connections: "on" }), workspace: "/tmp/work", queryFile: "/tmp/q.txt", toolsets: "file,terminal,mcp-tududi" });
  assert.equal(connected[connected.indexOf("-t") + 1], "file,terminal,mcp-tududi");
  assert.throws(() => buildHermesTurnArgs({ variant: withToggles({ connections: "on" }), workspace: "/tmp/work", queryFile: "/tmp/q.txt", toolsets: "file,terminal,web" }), /plus MCP toolsets/);
  assert.throws(() => buildHermesTurnArgs({ variant: clean, workspace: "/tmp/work", queryFile: "/tmp/q.txt", threadId: "latest; rm" }), /exact Hermes session id/);
  assert.throws(() => buildHermesTurnArgs({ variant: clean, workspace: "relative", queryFile: "/tmp/q.txt" }), /absolute path/);
});

test("Hermes configurations validate model, effort, tier and the snapshot's profile name; no Hermes configuration runs live", () => {
  assert.doesNotThrow(() => resolveHarnessAdapter(clean));
  assert.doesNotThrow(() => resolveHarnessAdapter(snapshot));
  assert.doesNotThrow(() => resolveHarnessAdapter(withToggles({ memory: "off", connections: "on" })));
  assert.throws(() => resolveHarnessAdapter({ ...clean, model: "gpt-6-luna" }), /Anthropic model/);
  assert.throws(() => resolveHarnessAdapter({ ...clean, reasoningEffort: "adaptive" }), /reasoning effort/);
  assert.throws(() => resolveHarnessAdapter({ ...clean, serviceTier: "fast" }), /default tier/);
  assert.throws(() => resolveHarnessAdapter({ ...clean, executionProfile: { ...cleanProfile, environment: "snapshot" } }), /environment must be clean/);
  assert.throws(() => resolveHarnessAdapter({ ...snapshot, executionProfile: { ...snapshotProfile, environment: "live" } }), /environment must be snapshot/);
  const unnamed = { ...snapshotProfile };
  delete unnamed.harnessProfile;
  assert.throws(() => resolveHarnessAdapter({ ...snapshot, executionProfile: unnamed }), /must name the harnessProfile it copies/);
});

test("a Hermes child inherits only allowlisted variables; a caller's env cannot bring back a credential or a Hermes home", () => {
  const saved = { ...process.env };
  process.env.GEMINI_API_KEY = "gm-leak";
  process.env.AWS_SECRET_ACCESS_KEY = "aws-leak";
  process.env.GITHUB_TOKEN = "gh-leak";
  process.env.SOME_FUTURE_PROVIDER_KEY = "future-leak";
  try {
    const env = { ANTHROPIC_API_KEY: "sk-leak", HERMES_HOME: "/real/.hermes", OPENROUTER_API_KEY: "or-leak", XAI_API_KEY: "x-leak", FAKE_LOG: "/tmp/log" };
    for (const variant of [clean, snapshot]) {
      hermesEnvironment(variant);
      const processEnv = hermesProcessEnv({ hermesHome: "/tmp/attempt/hermes-home", env });
      for (const key of ["ANTHROPIC_API_KEY", "OPENROUTER_API_KEY", "XAI_API_KEY", "GEMINI_API_KEY", "AWS_SECRET_ACCESS_KEY", "GITHUB_TOKEN", "SOME_FUTURE_PROVIDER_KEY"]) assert.equal(processEnv[key], undefined, key);
      assert.equal(processEnv.HERMES_HOME, "/tmp/attempt/hermes-home");
      assert.equal(processEnv.HERMES_DISABLE_LAZY_INSTALLS, "1");
      assert.equal(processEnv.FAKE_LOG, "/tmp/log");
      assert.equal(processEnv.PATH, process.env.PATH);
    }
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  }
  assert.equal(hermesEnvironment(clean), "clean");
  assert.equal(hermesEnvironment(snapshot), "snapshot");
  const undeclared = { ...clean, executionProfile: { ...cleanProfile, environment: undefined } };
  assert.throws(() => hermesEnvironment(undeclared), /clean or snapshot environment/);
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

test("a snapshot copies the named profile's soul, skills and memories into a throwaway home, with an allowlisted config and a stable digest", async (t) => {
  const f = await setup(t);
  const rose = path.join(f.hermesRoot, "profiles", "rose");
  const a = await attempt(f.root, "snapshot");
  const { setup: record } = await prepareHermesAttempt({ variant: snapshot, cwd: a.attemptDir, env: f.env });
  const home = path.join(a.attemptDir, "hermes-home");
  assert.deepEqual(await listTree(home), [".no-bundled-skills", "SOUL.md", "config.yaml", "memories/MEMORY.md", "memories/USER.md", "skills/tududi/SKILL.md"]);
  assert.equal(await readFile(path.join(home, "SOUL.md"), "utf8"), "I am Rose.\n", "the soul's bytes, not a link to them");
  const config = JSON.parse(await readFile(path.join(home, "config.yaml"), "utf8"));
  assert.deepEqual(config, {
    _config_version: 50,
    auth: { adopt_external_logins: true },
    memory: { memory_char_limit: 2200, memory_enabled: true, provider: "", user_profile_enabled: true },
    model: { default: "claude-haiku-5-5", provider: "anthropic" },
    skills: { auto_load: ["./tududi"] },
  });
  const configText = await readFile(path.join(home, "config.yaml"), "utf8");
  assert.doesNotMatch(configText, /secrets|bjs-env|fallback|telegram|discord|cron|mcp_servers|plugins|honcho/u, "no secrets helper, fallback route, platform, gateway or connection");
  assert.equal(record.environment, "snapshot");
  assert.equal(record.harnessProfile, "rose");
  assert.equal(record.toolsets, "file,terminal");
  assert.match(record.digest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(await currentHermesSetupDigest({ variant: snapshot, env: f.env }), record.digest);

  // Memory off: no memories copied, Hermes memory and user profile disabled.
  const b = await attempt(f.root, "no-memory");
  const noMemory = await prepareHermesAttempt({ variant: withToggles({ memory: "off" }), cwd: b.attemptDir, env: f.env });
  assert.equal((await listTree(path.join(b.attemptDir, "hermes-home"))).some((entry) => entry.startsWith("memories/")), false);
  const quiet = JSON.parse(await readFile(path.join(b.attemptDir, "hermes-home", "config.yaml"), "utf8"));
  assert.equal(quiet.memory.memory_enabled, false);
  assert.equal(quiet.memory.user_profile_enabled, false);
  assert.notEqual(noMemory.setup.digest, record.digest);

  // Connections on: MCP servers and plugins travel, and their toolsets join file and terminal.
  const c = await attempt(f.root, "connected");
  const connected = await prepareHermesAttempt({ variant: withToggles({ connections: "on" }), cwd: c.attemptDir, env: f.env });
  const connectedConfig = JSON.parse(await readFile(path.join(c.attemptDir, "hermes-home", "config.yaml"), "utf8"));
  assert.deepEqual(Object.keys(connectedConfig.mcp_servers), ["tududi"]);
  assert.deepEqual(connectedConfig.plugins.enabled, ["journal"]);
  assert.ok((await listTree(path.join(c.attemptDir, "hermes-home"))).includes("plugins/journal/plugin.yaml"));
  assert.equal(connected.setup.toolsets, "file,terminal,mcp-tududi");

  // His soul changes, the digest moves; the real profile is never written.
  const before = await listTree(rose);
  await writeFile(path.join(rose, "SOUL.md"), "I am Rose, revised.\n");
  assert.notEqual(await currentHermesSetupDigest({ variant: snapshot, env: f.env }), record.digest);
  assert.deepEqual(await listTree(rose), before);

  const ghost = await attempt(f.root, "ghost");
  await assert.rejects(prepareHermesAttempt({ variant: { ...snapshot, executionProfile: { ...snapshotProfile, harnessProfile: "ghost" } }, cwd: ghost.attemptDir, env: f.env }), /no readable config\.yaml/);
  const noLogin = await attempt(f.root, "no-login");
  await assert.rejects(prepareHermesAttempt({ variant: clean, cwd: noLogin.attemptDir, env: { ...f.env, CLAUDE_CONFIG_DIR: path.join(f.root, "nowhere") } }), /borrows the Claude Code login/);
});

test("runs use the committed Hermes environment's own entry point unless an executable is pinned", async (t) => {
  const f = await setup(t);
  const venv = path.join(f.hermesRoot, "installs", "abc", "environments", "gen", "venv");
  await mkdir(path.join(venv, "bin"), { recursive: true });
  await writeFile(path.join(venv, "bin", "hermes"), "#!/bin/sh\n");
  await writeFile(path.join(f.hermesRoot, "installs", "abc", "facts.json"), JSON.stringify({ packages: { venv: { environment: venv } } }));
  assert.equal(await resolveHermesRuntime({ variant: clean, env: f.env }), path.join(venv, "bin", "hermes"));
  assert.equal(await resolveHermesRuntime({ variant: snapshot, env: f.env }), path.join(venv, "bin", "hermes"), "a snapshot's fresh home needs the committed environment too");
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

test("a cooked clean Hermes Dish is public; a snapshot Dish goes to private/dishes, runs in its copied home and names its setup digest", async (t) => {
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
  assert.deepEqual(await readdir(path.join(attemptDir, "hermes-home")), ["state.db"], "only the session database outlives the session");
  const dish = JSON.parse(await readFile(path.join(cleanRun.dishDirectory, "dish.json"), "utf8"));
  assert.equal(dish.identity.observedModel, "claude-haiku-5-5");
  assert.equal(dish.identity.harnessVersion, "Hermes Agent v9.9.9 (fake)");
  assert.equal(dish.identity.setupDigest, undefined);
  assert.equal("visibility" in dish, false);

  const rose = path.join(f.hermesRoot, "profiles", "rose");
  const roseBefore = await listTree(rose);
  const snapshotRun = await executeRecipe({ repoRoot, catalog, recipe: cooked, variant: snapshot, executable: f.executable, env: f.env, nonce: "rose" });
  assert.equal(snapshotRun.status, "accepted", snapshotRun.error);
  assert.equal(path.relative(repoRoot, snapshotRun.dishDirectory).split(path.sep).slice(0, 2).join("/"), "private/dishes");
  const snapshotDish = JSON.parse(await readFile(path.join(snapshotRun.dishDirectory, "dish.json"), "utf8"));
  assert.equal(snapshotDish.visibility, "private");
  const snapshotAttempt = path.join(repoRoot, "private/runtime/attempts", snapshotRun.attemptId);
  const snapshotRequest = JSON.parse(await readFile(path.join(snapshotAttempt, "requested.json"), "utf8"));
  assert.equal(snapshotDish.identity.setupDigest, snapshotRequest.setup.digest);
  const receipt = JSON.parse(await readFile(path.join(snapshotRun.dishDirectory, "receipt.json"), "utf8"));
  assert.equal(receipt.setup.digest, snapshotDish.identity.setupDigest);
  assert.equal(receipt.setup.harnessProfile, "rose");
  const snapshotCalls = (await f.calls()).filter((call) => call.home === path.join(snapshotAttempt, "hermes-home"));
  assert.equal(snapshotCalls.length, 2);
  for (const call of snapshotCalls) {
    assert.equal(call.args.includes("-p"), false);
    assert.equal(call.args.includes("--ignore-rules"), false);
    assert.equal(call.soul, "I am Rose.\n", "the run sees the copied soul");
  }
  // The copy and the borrowed login are gone; the real profile is untouched.
  assert.deepEqual(await readdir(path.join(snapshotAttempt, "hermes-home")), ["state.db"]);
  assert.deepEqual(await listTree(rose), roseBefore);
  const snapshotObserved = JSON.parse(await readFile(path.join(snapshotAttempt, "observed.json"), "utf8"));
  assert.equal(snapshotObserved.environment, "snapshot");
  assert.equal(snapshotObserved.harnessProfile, "rose");

  // Connections on: refused without the flag; with it, the MCP toolset reaches the run.
  const connected = withToggles({ connections: "on" });
  await assert.rejects(executeRecipe({ repoRoot, catalog, recipe: cooked, variant: connected, executable: f.executable, env: f.env, nonce: "refused" }), /--allow-connections/);
  const connectedRun = await executeRecipe({ repoRoot, catalog, recipe: cooked, variant: connected, executable: f.executable, env: f.env, nonce: "connected", allowConnections: true });
  assert.equal(connectedRun.status, "accepted", connectedRun.error);
  const lastCall = (await f.calls()).at(-1);
  assert.equal(lastCall.args[lastCall.args.indexOf("-t") + 1], "file,terminal,mcp-tududi");
});

test("the OpenRouter route pins its maker's slug, carries only the route key, and verifies the recorded OpenRouter route", async (t) => {
  assert.doesNotThrow(() => resolveHarnessAdapter(viaOpenRouter));
  assert.doesNotThrow(() => resolveHarnessAdapter({ ...viaOpenRouter, provider: "anthropic", model: "anthropic/claude-opus-5.5", executionProfile: { ...openRouterProfile, upstream: "anthropic" } }));
  assert.throws(() => resolveHarnessAdapter({ ...viaOpenRouter, provider: "anthropic", model: "anthropic/claude-opus-5.5" }), /not the maker anthropic's own provider/);
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
  assert.match(config, /provider_routing:\n {2}only:\n {4}- google-ai-studio\n {2}require_parameters: true\n/u);
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
