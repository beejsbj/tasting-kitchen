import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, readdir, lstat, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { computeRecipeHash, sha256 } from "../lib/taste/catalog.mjs";
import { buildCodexTurnArgs, codexLiveHome, runCodexSession } from "../lib/taste/codex.mjs";
import { buildCursorTurnArgs } from "../lib/taste/cursor.mjs";
import { NEVER_LIVE_PROFILES } from "../lib/taste/environments.mjs";
import { compatibilityFor, getHarnessAdapter, resolveHarnessAdapter } from "../lib/taste/harness-adapters.mjs";
import { buildHermesTurnArgs, cleanupHermesAttempt, cleanupHermesHome, hermesHomeFor, hermesProcessEnv, hermesProfileSource, prepareHermesAttempt } from "../lib/taste/hermes.mjs";
import { executeRecipe } from "../lib/taste/runner.mjs";

const HOST = { runtime: "linux-host", nativeWeb: "disabled", networkPolicy: "not-enforced", filesystemBoundary: "not-a-secrecy-boundary" };
const THREAD = "01901234-5678-7abc-8def-0123456789ab";
const SESSION = "20261108_131309_66bdb7";

const codexProfile = { id: "codex-linux-host-live-v1", label: "via Codex CLI · live", ...HOST, sandbox: "danger-full-access", approvalPolicy: "never", environment: "live", memory: "on", connections: "off" };
const codexLive = {
  id: "codex-gpt-6-1-sol-high-live", label: "gpt-6.1-sol · High · via Codex CLI · live", provider: "openai", model: "gpt-6.1-sol", harness: "codex-cli",
  reasoningEffort: "high", serviceTier: "priority", personality: "none", capabilities: ["files", "shell"], executionProfile: codexProfile, configHash: `sha256:${"5".repeat(64)}`,
};
const withProfile = (variant, executionProfile) => ({ ...variant, executionProfile: { ...variant.executionProfile, ...executionProfile } });

const cursorProfile = { id: "cursor-linux-host-live-v1", label: "via Cursor Agent · live", ...HOST, sandbox: "disabled", approvalPolicy: "force", nativeWeb: "not-enforced", environment: "live", memory: "on", connections: "on" };
const cursorLive = {
  id: "cursor-composer-2-5-live", label: "Composer 2.5 · live", provider: "cursor", model: "composer-2.5[fast=false]", harness: "cursor-agent", reasoningEffort: "adaptive",
  serviceTier: "default", personality: "default", capabilities: ["files", "shell"], executionProfile: cursorProfile, configHash: `sha256:${"6".repeat(64)}`,
};

const hermesProfile = { id: "hermes-linux-host-live-openai-codex-v1", label: "via Hermes · live profile · OpenAI Codex route", ...HOST, sandbox: "disabled", approvalPolicy: "yolo", environment: "live", harnessProfile: "otto", memory: "on", connections: "off" };
const hermesLive = {
  id: "hermes-gpt-6-luna-high-live-otto", label: "gpt-6-luna · High · via Hermes · otto live", provider: "openai", model: "gpt-6-luna", harness: "hermes", reasoningEffort: "high",
  serviceTier: "default", personality: "none", capabilities: ["files", "shell"], executionProfile: hermesProfile, configHash: `sha256:${"7".repeat(64)}`,
};
const hermesAs = (harnessProfile, extra = {}) => withProfile(hermesLive, { harnessProfile, ...extra });

test("live is offered for Codex, Cursor and Hermes (named profiles), each within the toggles it can honour; T3 offers none", () => {
  for (const [memory, connections] of [["on", "off"], ["on", "on"], ["off", "off"], ["off", "on"]]) {
    assert.doesNotThrow(() => resolveHarnessAdapter(withProfile(codexLive, { memory, connections })), `Codex honours memory ${memory} and connections ${connections}`);
  }
  // Cursor has no switch for its memory or for his own MCP servers; Hermes has none for memory alone.
  assert.doesNotThrow(() => resolveHarnessAdapter(cursorLive));
  assert.throws(() => resolveHarnessAdapter(withProfile(cursorLive, { memory: "off" })), /cannot honour memory off/);
  assert.throws(() => resolveHarnessAdapter(withProfile(cursorLive, { connections: "off" })), /cannot honour connections off/);
  for (const profile of ["default", "otto"]) assert.doesNotThrow(() => resolveHarnessAdapter(hermesAs(profile)));
  assert.doesNotThrow(() => resolveHarnessAdapter(hermesAs("otto", { connections: "on" })));
  assert.throws(() => resolveHarnessAdapter(hermesAs("otto", { memory: "off" })), /cannot honour memory off/);
  const unnamed = { ...hermesLive, executionProfile: { ...hermesProfile } };
  delete unnamed.executionProfile.harnessProfile;
  assert.throws(() => resolveHarnessAdapter(unnamed), /must name the harnessProfile it runs/);
  // A live Hermes run uses the model its profile uses, on the route the profile itself reaches it by.
  assert.throws(() => resolveHarnessAdapter({ ...hermesLive, provider: "anthropic", model: "claude-opus-5-5" }), /provider openai and a gpt-\* model/);
  // The other harnesses keep their rules: Claude Code has no harness profile, and T3 has no live profile at all.
  const t3 = { id: "t3-x", label: "x", provider: "anthropic", model: "claude-opus-5-5", harness: "t3", harnessPath: ["t3", "claude-code"], reasoningEffort: "high", serviceTier: "default", personality: "default", capabilities: ["files", "shell"],
    executionProfile: { id: "t3-linux-host-live-v1", label: "via T3 · live", ...HOST, sandbox: "disabled", approvalPolicy: "full-access", nativeWeb: "not-enforced", environment: "live", memory: "on", connections: "off" } };
  assert.throws(() => resolveHarnessAdapter(t3), /execution profile\.id must be one of t3-linux-host-clean-v1/);
});

test("Hermes rose is never live: validation, planning, the profile reader and the cleanup all refuse it", async () => {
  assert.deepEqual(NEVER_LIVE_PROFILES, ["rose"]);
  assert.throws(() => resolveHarnessAdapter(hermesAs("rose")), /profile rose is never live/);
  // Not even under another profile id, another harness or another toggle: the rule comes before any other check.
  assert.throws(() => resolveHarnessAdapter(hermesAs("rose", { connections: "on" })), /never live/);
  assert.throws(() => resolveHarnessAdapter({ ...hermesAs("rose"), executionProfile: { ...hermesProfile, harnessProfile: "rose", id: "hermes-linux-host-snapshot-anthropic-v1" } }), /never live/);
  assert.equal(compatibilityFor({ variant: hermesAs("rose"), recipe: { status: "ready", harness: { capabilities: [] } } }).supported, false);
  // Rose as a snapshot stays what it was.
  const snapshot = { ...hermesLive, provider: "anthropic", model: "claude-opus-5-5", executionProfile: { ...hermesProfile, id: "hermes-linux-host-snapshot-anthropic-v1", label: "via Hermes · profile snapshot · Anthropic route", environment: "snapshot", harnessProfile: "rose" } };
  assert.doesNotThrow(() => resolveHarnessAdapter(snapshot));
  // Defence behind validation: a hand-built variant cannot reach her directory.
  assert.throws(() => hermesProfileSource(hermesAs("rose"), { TASTE_HERMES_ROOT: "/nowhere" }), /never live/);
  assert.throws(() => hermesHomeFor({ variant: hermesAs("rose"), attemptDir: "/tmp/x", env: { TASTE_HERMES_ROOT: "/nowhere" } }), /never live/);
  await assert.rejects(prepareHermesAttempt({ variant: hermesAs("rose"), cwd: "/tmp/x", env: { TASTE_HERMES_ROOT: "/nowhere" } }), /never live/);
  // Only a per-attempt hermes-home is ever emptied, so even a mistaken call cannot empty a real profile.
  await assert.rejects(cleanupHermesHome("/home/someone/.hermes/profiles/rose"), /Refusing to empty/);
  await assert.rejects(cleanupHermesHome("/home/someone/.hermes"), /Refusing to empty/);
  assert.equal(await cleanupHermesAttempt({ variant: hermesAs("otto"), cwd: "/tmp/x" }), undefined, "a live attempt has nothing to clean");
});

test("the live configurations in the catalog are high or below, never max, never rose, and cover each harness", async () => {
  const { configurations } = JSON.parse(await readFile(new URL("../catalog/configurations.json", import.meta.url), "utf8"));
  const live = configurations.filter((configuration) => configuration.executionProfile.environment === "live");
  for (const configuration of live) {
    assert.notEqual(configuration.reasoningEffort, "max", configuration.id);
    assert.notEqual(configuration.executionProfile.harnessProfile, "rose", configuration.id);
    // Cursor cannot keep his MCP servers from loading, so its live configuration is honestly connections on.
    assert.equal(configuration.executionProfile.connections, configuration.harness === "cursor-agent" ? "on" : "off", configuration.id);
    assert.doesNotThrow(() => resolveHarnessAdapter(configuration), configuration.id);
  }
  const byHarness = Object.groupBy(live, (configuration) => configuration.harness);
  assert.deepEqual(Object.keys(byHarness).sort(), ["claude-code", "codex-cli", "cursor-agent", "hermes"]);
  assert.deepEqual(byHarness.hermes.map((configuration) => configuration.executionProfile.harnessProfile).sort(), ["default", "otto"]);
  assert.deepEqual(byHarness["codex-cli"].map((configuration) => configuration.model), ["gpt-6.1-sol"]);
  assert.equal(live.some((configuration) => configuration.harness === "t3"), false, "live T3 would be his real app and threads, so none is declared");
  // The original Cursor and Codex configurations are untouched: no environment, so their hashes stand.
  assert.equal(configurations.find((configuration) => configuration.id === "cursor-composer-2-5").executionProfile.environment, undefined);
});

// ---------------------------------------------------------------- Codex

test("a live Codex turn loads his config and rules, pins the same fields, and adds only the toggle overrides", () => {
  const args = (variant, setup) => buildCodexTurnArgs({ variant, recipe: {}, workspace: "/tmp/work", finalPath: "/tmp/final", setup });
  const memoryOnConnectionsOn = args(withProfile(codexLive, { connections: "on" }));
  for (const flag of ["--ignore-user-config", "--ignore-rules", "--strict-config"]) assert.equal(memoryOnConnectionsOn.includes(flag), false, `live omits ${flag}`);
  for (const pinned of ['model_reasoning_effort="high"', 'personality="none"', 'service_tier="priority"', 'web_search="disabled"']) assert.ok(memoryOnConnectionsOn.includes(pinned), pinned);
  assert.deepEqual(memoryOnConnectionsOn.filter((arg) => /^(memories|mcp_servers)/u.test(arg) || ["plugins", "apps", "memories"].includes(arg)), [], "memory on and connections on override nothing");

  const off = args(withProfile(codexLive, { memory: "off", connections: "off" }), { disabledMcpServers: ["tududi", "chat-scrobbler"] });
  assert.ok(off.includes("memories.use_memories=false") && off.includes("memories.generate_memories=false"));
  assert.ok(off.includes("mcp_servers.tududi.enabled=false") && off.includes("mcp_servers.chat-scrobbler.enabled=false"));
  for (const feature of ["memories", "plugins", "apps"]) assert.equal(off[off.indexOf(feature) - 1], "--disable", feature);
  // A clean or original configuration is unchanged: it still ignores his config.
  const original = args({ ...codexLive, executionProfile: { ...codexProfile, id: "codex-linux-host-unsandboxed-v1", environment: undefined, memory: undefined, connections: undefined } });
  for (const flag of ["--ignore-user-config", "--ignore-rules", "--strict-config"]) assert.ok(original.includes(flag));
  // The resumed turn carries the same overrides after `resume <id>`.
  const resumed = buildCodexTurnArgs({ variant: withProfile(codexLive, { connections: "off" }), recipe: {}, workspace: "/tmp/work", finalPath: "/tmp/final", threadId: THREAD, setup: { disabledMcpServers: ["x"] } });
  assert.deepEqual(resumed.slice(resumed.indexOf("resume"), resumed.indexOf("resume") + 2), ["resume", THREAD]);
  assert.ok(resumed.includes("mcp_servers.x.enabled=false"));
  assert.equal(resumed.includes("-C"), false);

});

const FAKE_CODEX = `#!/usr/bin/env node
import { appendFileSync, mkdirSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
const args = process.argv.slice(2);
let stdin = "";
if (!process.stdin.isTTY && args.at(-1) === "-") for await (const chunk of process.stdin) stdin += chunk;
appendFileSync(process.env.FAKE_LOG, JSON.stringify({ args, home: process.env.CODEX_HOME, userHome: process.env.HOME, cwd: process.cwd() }) + "\\n");
if (args[0] === "--version") { console.log("codex-cli 9.9.9-fake"); process.exit(0); }
if (args[0] === "mcp") {
  if (process.env.FAKE_MCP_FAIL) process.exit(3);
  console.log(process.env.FAKE_MCP ?? "[]");
  process.exit(0);
}
const configValue = (key) => { const hit = args.find((arg, i) => args[i - 1] === "-c" && arg.startsWith(key + "=")); return hit ? JSON.parse(hit.slice(key.length + 1)) : undefined; };
const resumeIndex = args.indexOf("resume");
const thread = resumeIndex >= 0 ? args[resumeIndex + 1] : process.env.FAKE_THREAD;
const model = args[args.indexOf("--model") + 1];
const rollout = path.join(process.env.CODEX_HOME, "sessions", "2026", "11", "09", "rollout-2026-11-09T00-00-00-" + thread + ".jsonl");
if (!existsSync(rollout)) {
  mkdirSync(path.dirname(rollout), { recursive: true });
  writeFileSync(rollout, [
    { type: "session_meta", payload: { id: thread, cli_version: "9.9.9-fake", model_provider: "openai" } },
    { type: "event_msg", payload: { type: "thread_settings_applied", thread_settings: { model, model_provider_id: "openai", reasoning_effort: configValue("model_reasoning_effort"), personality: configValue("personality"), service_tier: configValue("service_tier") } } },
  ].map(JSON.stringify).join("\\n") + "\\n");
}
writeFileSync(args[args.indexOf("--output-last-message") + 1], "answer to: " + stdin.trim());
console.log(JSON.stringify({ type: "thread.started", thread_id: thread }));
console.log(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1 } }));
`;

async function tree(root, relative = "") {
  const entries = [];
  for (const name of (await readdir(path.join(root, relative))).sort()) {
    const child = relative ? `${relative}/${name}` : name;
    if ((await lstat(path.join(root, child))).isDirectory()) entries.push(...await tree(root, child));
    else entries.push(child);
  }
  return entries;
}

async function codexFixture(t, { mcp = "[]" } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "taste-live-codex-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const executable = path.join(root, "fake-codex.mjs");
  await writeFile(executable, FAKE_CODEX, "utf8");
  await chmod(executable, 0o755);
  // A stand-in for his ~/.codex: instructions by symlink, rules, a skill, config and login. Never the real one.
  const home = path.join(root, "fake-codex-home");
  await mkdir(path.join(home, "rules"), { recursive: true });
  await mkdir(path.join(home, "skills", "grilling"), { recursive: true });
  await writeFile(path.join(root, "soul.md"), "Be a kalyana mitra.\n");
  await symlink(path.join(root, "soul.md"), path.join(home, "AGENTS.md"));
  await writeFile(path.join(home, "rules", "default.rules"), "prefix_rule(pattern=[\"ls\"], decision=\"allow\")\n");
  await writeFile(path.join(home, "skills", "grilling", "SKILL.md"), "---\nname: grilling\n---\nAsk.\n");
  await writeFile(path.join(home, "config.toml"), "model = \"not-the-pinned-model\"\n");
  await writeFile(path.join(home, "auth.json"), "{\"never\":\"copied\"}\n");
  const log = path.join(root, "calls.jsonl");
  const env = { FAKE_LOG: log, FAKE_THREAD: THREAD, FAKE_MCP: mcp, TASTE_CODEX_LIVE_HOME: home };
  const calls = async () => (await readFile(log, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  return { root, executable, home, env, calls };
}

test("a live Codex session runs in the real home and real HOME, switches off only what the toggles say, and is verified from its rollout there", async (t) => {
  const f = await codexFixture(t, { mcp: JSON.stringify([{ name: "tududi", enabled: true }, { name: "chat-scrobbler", enabled: true }]) });
  const variant = withProfile(codexLive, { memory: "off", connections: "off" });
  const adapter = getHarnessAdapter("codex-cli");
  const before = await tree(f.home);
  const cook = path.join(f.root, "cook");
  await mkdir(path.join(cook, "workspace"), { recursive: true });

  const prepared = await adapter.prepareAttempt({ variant, codexHome: path.join(cook, "codex-home"), executable: f.executable, env: f.env, cwd: cook });
  assert.equal(prepared.setup.environment, "live");
  assert.equal(prepared.setup.home, "real");
  assert.deepEqual(prepared.setup.disabledMcpServers, ["chat-scrobbler", "tududi"]);
  assert.match(prepared.setup.digestAtStart, /^sha256:[a-f0-9]{64}$/u);
  assert.deepEqual(await readdir(cook), ["workspace"], "nothing is created for a live attempt");

  const recipe = { setup: { instructions: "Set the table." }, turns: [{ id: "make", content: "Cook" }, { id: "correct", content: "Correct" }] };
  const session = await runCodexSession({ variant, recipe, workspace: path.join(cook, "workspace"), privateDir: path.join(cook, "raw"), codexHome: path.join(cook, "codex-home"), executable: f.executable, env: f.env, setup: prepared.setup });
  assert.equal(session.failure, null);
  const runs = (await f.calls()).filter((call) => call.args[0] !== "--version" && call.args[0] !== "mcp");
  assert.equal(runs.length, 2);
  for (const call of runs) {
    assert.equal(call.home, f.home, "CODEX_HOME is the real (here: fake) home");
    assert.equal(call.userHome, process.env.HOME, "HOME is not replaced");
    assert.equal(call.args.includes("--ignore-user-config"), false);
    assert.ok(call.args.includes("mcp_servers.tududi.enabled=false") && call.args.includes("mcp_servers.chat-scrobbler.enabled=false"));
    assert.ok(call.args.includes("memories.use_memories=false"));
  }
  const observed = await adapter.verifyIdentity({ codexHome: path.join(cook, "codex-home"), threadId: session.threadId, variant, cliVersion: session.cliVersion, result: session, env: f.env });
  assert.equal(observed.model, "gpt-6.1-sol");
  assert.equal(observed.rolloutPath.startsWith(f.home), true, "the rollout is read from the live home");
  // Live writes are the harness's own (a rollout); nothing of his setup was edited.
  assert.deepEqual((await tree(f.home)).filter((entry) => !before.includes(entry)), [`sessions/2026/11/09/rollout-2026-11-09T00-00-00-${THREAD}.jsonl`]);
  assert.equal(await readFile(path.join(f.home, "AGENTS.md"), "utf8"), "Be a kalyana mitra.\n");
});

test("live Codex with connections on lists no servers and passes no disable; with no login or an unlistable config it refuses", async (t) => {
  const f = await codexFixture(t);
  const adapter = getHarnessAdapter("codex-cli");
  const cook = path.join(f.root, "cook");
  await mkdir(cook);
  const on = await adapter.prepareAttempt({ variant: withProfile(codexLive, { connections: "on" }), codexHome: path.join(cook, "codex-home"), executable: f.executable, env: f.env, cwd: cook });
  assert.equal(on.setup.disabledMcpServers, undefined);
  await assert.rejects(f.calls(), /ENOENT/, "connections on never runs Codex, so it never asks for its servers");
  await assert.rejects(adapter.prepareAttempt({ variant: codexLive, codexHome: path.join(cook, "codex-home"), executable: f.executable, env: { ...f.env, FAKE_MCP_FAIL: "1" }, cwd: cook }), /connections off cannot be honoured/);
  await assert.rejects(adapter.prepareAttempt({ variant: codexLive, codexHome: path.join(cook, "codex-home"), executable: f.executable, env: { ...f.env, FAKE_MCP: "not json" }, cwd: cook }), /not JSON/);
  await assert.rejects(adapter.prepareAttempt({ variant: codexLive, codexHome: path.join(cook, "codex-home"), executable: f.executable, env: { ...f.env, FAKE_MCP: JSON.stringify([{ name: "a.b" }]) }, cwd: cook }), /cannot be named in a -c override/);
  await rm(path.join(f.home, "auth.json"));
  await assert.rejects(adapter.prepareAttempt({ variant: codexLive, codexHome: path.join(cook, "codex-home"), executable: f.executable, env: f.env, cwd: cook }), /real login/);
  assert.equal(codexLiveHome({ TASTE_CODEX_LIVE_HOME: "/x/y" }), "/x/y");
});

async function kitchen(root, harnessCapabilities = []) {
  const recipeDir = path.join(root, "catalog/recipes/conversation/demo");
  await mkdir(path.join(recipeDir, "fixtures"), { recursive: true });
  await writeFile(path.join(recipeDir, "fixtures/context.txt"), "public context\n");
  const cooked = {
    schemaVersion: 1, id: "demo-session", version: "1.0.0", status: "ready", title: "A demo session recipe",
    summary: "A sufficiently detailed demo for runner testing.", domain: "conversation", origin: "textbook", originNote: "A conventional runner integration test.",
    tags: ["presence"], kind: "session", harness: { workspace: "read", web: "disabled", capabilities: harnessCapabilities },
    setup: { instructions: "Read the mounted public context.", fixtures: [{ id: "context", path: "fixtures/context.txt", mountAs: "inputs/context.txt", public: true, mediaType: "text/plain" }] },
    turns: [{ id: "opening", role: "prompt", content: "Respond once." }, { id: "correction", role: "correction", content: "Now respond more directly." }],
    output: { kind: "session", entry: "output/session.json", include: ["output/session.json"], limits: { maxFiles: 2, maxBytes: 32768 } },
    validation: { mode: "completeness", checks: [{ id: "entry", type: "file-exists", required: true, description: "The transcript exists.", target: "output/session.json" }] },
    sourcePath: "catalog/recipes/conversation/demo/recipe.json", fixtureHashes: { context: sha256("public context\n") },
  };
  cooked.recipeHash = computeRecipeHash(cooked, cooked.fixtureHashes);
  return { recipe: cooked, catalog: { catalogHash: `sha256:${"4".repeat(64)}`, recipes: [cooked] } };
}

test("a live Codex Dish goes to private/dishes, never records a setup digest, and leaves his home as it found it", async (t) => {
  const f = await codexFixture(t);
  const repoRoot = path.join(f.root, "repo");
  const { recipe, catalog } = await kitchen(repoRoot);
  const before = await tree(f.home);
  const run = await executeRecipe({ repoRoot, catalog, recipe, variant: withProfile(codexLive, { connections: "on" }), executable: f.executable, env: f.env, nonce: "live", allowConnections: true });
  assert.equal(run.status, "accepted", run.error);
  assert.equal(path.relative(repoRoot, run.dishDirectory).split(path.sep).slice(0, 2).join("/"), "private/dishes");
  const dish = JSON.parse(await readFile(path.join(run.dishDirectory, "dish.json"), "utf8"));
  assert.equal(dish.identity.setupDigest, undefined, "a live Dish never groups by digest");
  const receipt = JSON.parse(await readFile(path.join(run.dishDirectory, "receipt.json"), "utf8"));
  assert.equal(receipt.setup.environment, "live");
  assert.equal(receipt.setup.connections, "on");
  assert.equal(receipt.setup.memory, "on");
  assert.match(receipt.setup.digestAtStart, /^sha256:/u);
  const requested = JSON.parse(await readFile(path.join(repoRoot, "private/runtime/attempts", run.attemptId, "requested.json"), "utf8"));
  assert.equal(requested.execution.codexHome, "real-home");
  assert.equal(requested.execution.environment, "live");
  assert.deepEqual((await tree(f.home)).filter((entry) => !before.includes(entry)).map((entry) => entry.split("/")[0]), ["sessions"]);
  // Connections on without the Cook's flag is refused before anything runs.
  await assert.rejects(executeRecipe({ repoRoot, catalog, recipe, variant: withProfile(codexLive, { connections: "on" }), executable: f.executable, env: f.env, nonce: "refused" }), /--allow-connections/);
});

// ---------------------------------------------------------------- Cursor

test("live Cursor passes --approve-mcps; the original configuration never does", async () => {
  const args = (variant) => buildCursorTurnArgs({ variant, workspace: "/tmp/work", prompt: "cook" });
  assert.equal(args(cursorLive).includes("--approve-mcps"), true);
  const original = { ...cursorLive, executionProfile: { ...cursorProfile, id: "cursor-linux-host-unsandboxed-v1", environment: undefined, memory: undefined, connections: undefined } };
  assert.equal(args(original).includes("--approve-mcps"), false);
  assert.equal(args(original).includes("--force"), true);
});

test("live Cursor prepares nothing, records a live setup, and still requires the existing login preflight", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "taste-live-cursor-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const executable = path.join(root, "fake-cursor.mjs");
  await writeFile(executable, `#!/usr/bin/env node\nconsole.log(JSON.stringify(process.env.FAKE_STATUS === "out" ? { status: "unauthenticated", isAuthenticated: false } : { status: "authenticated", isAuthenticated: true }));\n`);
  await chmod(executable, 0o755);
  const adapter = getHarnessAdapter("cursor-agent");
  const prepared = await adapter.prepareAttempt({ variant: cursorLive, executable, env: {}, cwd: root });
  assert.deepEqual(prepared.setup, { environment: "live", memory: "on", connections: "on", home: "real" });
  assert.deepEqual(await readdir(root), ["fake-cursor.mjs"]);
  await assert.rejects(adapter.prepareAttempt({ variant: cursorLive, executable, env: { FAKE_STATUS: "out" }, cwd: root }), /authentication preflight failed/);
  // The original configuration keeps returning nothing to record.
  const original = { ...cursorLive, executionProfile: { ...cursorProfile, id: "cursor-linux-host-unsandboxed-v1", environment: undefined, memory: undefined, connections: undefined } };
  assert.equal(await adapter.prepareAttempt({ variant: original, executable, env: {}, cwd: root }), undefined);
  assert.equal(adapter.requestedExecution(cursorLive).cursorHome, "real-home");
  assert.deepEqual(adapter.requestedExecution(original), { providerAuth: "existing-login" });
});

// ---------------------------------------------------------------- Hermes

// The fake Hermes of taste-hermes.test.mjs, minus its writes of a login: a real profile already holds its own.
const FAKE_HERMES = `#!/usr/bin/env node
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("Hermes Agent v9.9.9 (fake)"); process.exit(0); }
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
if (args.includes("-p") || args.includes("--profile")) process.exit(64);
const home = process.env.HERMES_HOME;
let soul = null;
try { soul = readFileSync(path.join(home, "SOUL.md"), "utf8"); } catch {}
appendFileSync(process.env.FAKE_LOG, JSON.stringify({ args, home, soul, lazy: process.env.HERMES_DISABLE_LAZY_INSTALLS ?? null, leaked: process.env.ANTHROPIC_API_KEY ?? null }) + "\\n");
const resume = flag("--resume");
const session = resume ?? process.env.FAKE_SESSION;
const requested = flag("-m");
mkdirSync(home, { recursive: true });
const db = new DatabaseSync(path.join(home, "state.db"));
db.exec("CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, source TEXT, model TEXT, model_config TEXT, billing_provider TEXT, billing_base_url TEXT); CREATE TABLE IF NOT EXISTS session_model_usage (session_id TEXT, model TEXT, billing_provider TEXT, billing_base_url TEXT, task TEXT, api_call_count INTEGER, PRIMARY KEY (session_id, model, billing_provider, billing_base_url, task))");
db.prepare("INSERT OR IGNORE INTO sessions VALUES (?, 'tool', ?, ?, ?, ?)").run(session, requested, JSON.stringify({ reasoning_config: { enabled: true, effort: flag("--reasoning") } }), flag("--provider"), "https://chatgpt.com/backend-api/codex");
db.prepare("INSERT INTO session_model_usage VALUES (?, ?, ?, ?, '', 1) ON CONFLICT DO UPDATE SET api_call_count = api_call_count + 1").run(session, requested, flag("--provider"), "https://chatgpt.com/backend-api/codex");
db.close();
const query = readFileSync(flag("--query-file"), "utf8");
const emit = (event) => console.log(JSON.stringify({ ...event, timestamp: 1 }));
emit({ type: "system", subtype: "init", model: requested, session_id: session });
emit({ type: "result", session_id: session, exit_code: 0, text: "answer to: " + query, tokens: { input: 3, output: 2, total: 5, cache_read: 0, cache_write: 0 }, duration_ms: 5 });
`;

async function hermesFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "taste-live-hermes-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const executable = path.join(root, "fake-hermes.mjs");
  await writeFile(executable, FAKE_HERMES, "utf8");
  await chmod(executable, 0o755);
  const hermesRoot = path.join(root, "hermes-root");
  const profiles = {};
  for (const [name, dir, soul] of [["default", hermesRoot, "I am the default."], ["otto", path.join(hermesRoot, "profiles", "otto"), "I am Otto."], ["rose", path.join(hermesRoot, "profiles", "rose"), "I am Rose."]]) {
    profiles[name] = dir;
    await mkdir(path.join(dir, "memories"), { recursive: true });
    await mkdir(path.join(dir, "skills", "tududi"), { recursive: true });
    await mkdir(path.join(dir, "sessions"), { recursive: true });
    await writeFile(path.join(dir, "SOUL.md"), `${soul}\n`);
    await writeFile(path.join(dir, "memories", "MEMORY.md"), "Burooj cooks on Sundays.\n");
    await writeFile(path.join(dir, "memories", "USER.md"), "Prefers plain answers.\n");
    await writeFile(path.join(dir, "skills", "tududi", "SKILL.md"), "---\nname: tududi\n---\nTasks.\n");
    await writeFile(path.join(dir, ".env"), "TELEGRAM_TOKEN=his-own\n");
    await writeFile(path.join(dir, "auth.json"), "{\"login\":\"his-own\"}\n");
    await writeFile(path.join(dir, "gateway.pid"), "12345\n");
    await writeFile(path.join(dir, "config.yaml"), ["model:", "  provider: openai-codex", "  default: gpt-6-luna", "mcp_servers:", "  tududi:", "    command: /usr/bin/python3", "  t3:", "    command: /usr/bin/python3", "plugins:", "  enabled: [discord-channel-manager]", ""].join("\n"));
  }
  const log = path.join(root, "calls.jsonl");
  const env = { FAKE_LOG: log, FAKE_SESSION: SESSION, TASTE_HERMES_ROOT: hermesRoot };
  const calls = async () => (await readFile(log, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  return { root, executable, hermesRoot, profiles, env, calls };
}

// What a profile holds other than the root's own nested profiles directory, which belongs to its siblings.
const own = async (dir) => (await tree(dir)).filter((entry) => !entry.startsWith("profiles/"));

test("a live Hermes turn names no profile, ignores no rules, and points HERMES_HOME at the profile itself", async (t) => {
  const f = await hermesFixture(t);
  assert.equal(hermesProfileSource(hermesAs("otto"), f.env), f.profiles.otto);
  assert.equal(hermesProfileSource(hermesAs("default"), f.env), f.profiles.default);
  assert.equal(hermesHomeFor({ variant: hermesAs("otto"), attemptDir: "/tmp/never-used", env: f.env }), f.profiles.otto);
  const off = buildHermesTurnArgs({ variant: hermesLive, workspace: "/tmp/work", queryFile: "/tmp/q.txt" });
  assert.equal(off[off.indexOf("--provider") + 1], "openai-codex");
  assert.equal(off[off.indexOf("-m") + 1], "gpt-6-luna");
  assert.equal(off[off.indexOf("-t") + 1], "file,terminal");
  for (const flag of ["--ignore-rules", "-p", "--profile", "--safe-mode", "--ignore-user-config"]) assert.equal(off.includes(flag), false, flag);
  const on = buildHermesTurnArgs({ variant: withProfile(hermesLive, { connections: "on" }), workspace: "/tmp/work", queryFile: "/tmp/q.txt", toolsets: "file,terminal,mcp-t3,mcp-tududi" });
  assert.equal(on[on.indexOf("-t") + 1], "file,terminal,mcp-t3,mcp-tududi");
  assert.throws(() => buildHermesTurnArgs({ variant: hermesLive, workspace: "/tmp/work", queryFile: "/tmp/q.txt", toolsets: "file,terminal,mcp-t3" }), /must be file,terminal/);
  const env = hermesProcessEnv({ variant: hermesLive, hermesHome: f.profiles.otto, env: { HERMES_HOME: "/elsewhere", ANTHROPIC_API_KEY: "leak" } });
  assert.equal(env.HERMES_HOME, f.profiles.otto);
  assert.equal(env.HERMES_DISABLE_LAZY_INSTALLS, undefined, "his real home is not a fresh one");
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
});

test("a live Hermes run writes to the real profile, empties nothing, and never touches a sibling profile or its gateway", async (t) => {
  const f = await hermesFixture(t);
  const repoRoot = path.join(f.root, "repo");
  const { recipe, catalog } = await kitchen(repoRoot);
  const otto = f.profiles.otto;
  const before = { otto: await own(otto), default: await own(f.profiles.default), rose: await own(f.profiles.rose) };
  const bytesBefore = Object.fromEntries(await Promise.all(["SOUL.md", ".env", "auth.json", "gateway.pid", "config.yaml", "memories/MEMORY.md", "skills/tududi/SKILL.md"].map(async (name) => [name, await readFile(path.join(otto, name), "utf8")])));

  const run = await executeRecipe({ repoRoot, catalog, recipe, variant: hermesLive, executable: f.executable, env: f.env, nonce: "live" });
  assert.equal(run.status, "accepted", run.error);
  assert.equal(path.relative(repoRoot, run.dishDirectory).split(path.sep).slice(0, 2).join("/"), "private/dishes");
  const calls = await f.calls();
  const runs = calls.filter((call) => call.args[0] === "chat");
  assert.equal(runs.length, 2);
  for (const call of runs) {
    assert.equal(call.home, otto);
    assert.equal(call.soul, "I am Otto.\n", "the run sees his live soul");
    assert.equal(call.lazy, null);
    assert.equal(call.args.includes("--ignore-rules"), false);
    assert.equal(call.args[call.args.indexOf("-t") + 1], "file,terminal", "connections off gives the model file and terminal only");
  }
  // His profile is exactly as it was, plus the session database the run recorded in it.
  assert.deepEqual((await own(otto)).filter((entry) => !before.otto.includes(entry)), ["state.db"]);
  assert.deepEqual(before.otto.filter((entry) => !before.otto.includes(entry)), []);
  for (const [name, bytes] of Object.entries(bytesBefore)) assert.equal(await readFile(path.join(otto, name), "utf8"), bytes, name);
  assert.deepEqual(await own(f.profiles.default), before.default, "the default profile is untouched");
  assert.deepEqual(await own(f.profiles.rose), before.rose, "rose is untouched");
  const attemptDir = path.join(repoRoot, "private/runtime/attempts", run.attemptId);
  const requested = JSON.parse(await readFile(path.join(attemptDir, "requested.json"), "utf8"));
  assert.equal(requested.execution.hermesHome, "real-profile");
  assert.equal(requested.execution.providerAuth, "profile-own-login");
  assert.equal(requested.setup.home, "real");
  assert.deepEqual(await readdir(requested.cookDirectory), ["workspace"], "no throwaway Hermes home exists");
  const dish = JSON.parse(await readFile(path.join(run.dishDirectory, "dish.json"), "utf8"));
  assert.equal(dish.identity.setupDigest, undefined);
  assert.equal(dish.identity.observedModel, "gpt-6-luna");
  const receipt = JSON.parse(await readFile(path.join(run.dishDirectory, "receipt.json"), "utf8"));
  assert.equal(receipt.setup.environment, "live");
  assert.equal(receipt.setup.harnessProfile, "otto");
  assert.equal(receipt.setup.toolsets, "file,terminal");
  assert.match(receipt.setup.digestAtStart, /^sha256:/u);
  // The gateway's pid file is the one thing that says a gateway runs: it is still there, unchanged.
  assert.equal(await readFile(path.join(otto, "gateway.pid"), "utf8"), "12345\n");
  assert.equal(calls.some((call) => call.args.includes("gateway")), false, "no gateway command is ever issued");

  // Connections on: his MCP servers become toolsets, and the Cook must say so.
  const connected = withProfile(hermesLive, { connections: "on" });
  await assert.rejects(executeRecipe({ repoRoot, catalog, recipe, variant: connected, executable: f.executable, env: f.env, nonce: "refused" }), /--allow-connections/);
  const connectedRun = await executeRecipe({ repoRoot, catalog, recipe, variant: connected, executable: f.executable, env: { ...f.env, FAKE_SESSION: "20261108_131310_aaaaaa" }, nonce: "connected", allowConnections: true });
  assert.equal(connectedRun.status, "accepted", connectedRun.error);
  assert.equal((await f.calls()).at(-1).args[(await f.calls()).at(-1).args.indexOf("-t") + 1], "file,terminal,mcp-t3,mcp-tududi");
});

test("a live Hermes run on the default profile uses the root itself, and a missing login stops it before anything runs", async (t) => {
  const f = await hermesFixture(t);
  const prepared = await prepareHermesAttempt({ variant: hermesAs("default"), cwd: path.join(f.root, "cook"), env: f.env });
  assert.equal(prepared.setup.harnessProfile, "default");
  assert.equal(prepared.setup.home, "real");
  // Hermes runs as the root's active profile when HERMES_HOME is not a profiles/<name> directory, so a sticky rose stops `default`.
  await writeFile(path.join(f.hermesRoot, "active_profile"), "rose\n");
  await assert.rejects(prepareHermesAttempt({ variant: hermesAs("default"), cwd: path.join(f.root, "cook"), env: f.env }), /active profile rose, not default/);
  await prepareHermesAttempt({ variant: hermesAs("otto"), cwd: path.join(f.root, "cook"), env: f.env });
  await writeFile(path.join(f.hermesRoot, "active_profile"), "default\n");
  await assert.doesNotReject(prepareHermesAttempt({ variant: hermesAs("default"), cwd: path.join(f.root, "cook"), env: f.env }));
  await rm(path.join(f.profiles.otto, "auth.json"));
  await assert.rejects(prepareHermesAttempt({ variant: hermesAs("otto"), cwd: path.join(f.root, "cook"), env: f.env }), /profile's own login/);
  await assert.rejects(prepareHermesAttempt({ variant: hermesAs("ghost"), cwd: path.join(f.root, "cook"), env: f.env }), /no readable config\.yaml/);
  assert.deepEqual(await readdir(f.root).then((names) => names.filter((name) => name === "cook")), [], "nothing was created for a live attempt");
});
