import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { chmod, lstat, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { computeConfigHash, computeRecipeHash, sha256 } from "../lib/taste/catalog.mjs";
import {
  buildClaudeTurnArgs,
  claudeChildEnv,
  currentClaudeSetupDigest,
  parseClaudeJsonl,
  prepareClaudeAttempt,
  readClaudeAccessToken,
  runClaudeSession,
  verifyClaudeIdentity,
} from "../lib/taste/claude-code.mjs";
import { pathExists } from "../lib/taste/files.mjs";
import { getHarnessAdapter, resolveHarnessAdapter } from "../lib/taste/harness-adapters.mjs";
import { dishIdForAttempt as dishIdFor, publicActions } from "../lib/taste/publication.mjs";
import { recoverAttempt } from "../lib/taste/recovery.mjs";
import { executeRecipe } from "../lib/taste/runner.mjs";

const execFileAsync = promisify(execFile);
const SESSION_ID = "6f1c2a8e-3b4d-4e5f-8a9b-0c1d2e3f4a5b";
const TOKEN = "sk-ant-oat01-fake-token-for-tests-only";

function profile(environment, toggles = {}) {
  return {
    id: `claude-code-linux-host-${environment}-v1`, label: `via Claude Code · ${environment}`, runtime: "linux-host", sandbox: "disabled",
    approvalPolicy: "bypass-permissions", nativeWeb: "disabled", networkPolicy: "not-enforced", filesystemBoundary: "not-a-secrecy-boundary", environment,
    ...(environment === "clean" ? {} : { memory: "on", connections: "off", ...toggles }),
  };
}

function claudeVariant(environment = "clean", overrides = {}, toggles = {}) {
  const suffix = Object.entries(toggles).map(([key, value]) => `-${key}-${value}`).join("");
  const variant = {
    id: `claude-code-haiku-5-5-high-${environment}${suffix}`, label: `Haiku 5.5 · High · via Claude Code · ${environment}`,
    provider: "anthropic", model: "claude-haiku-5-5", harness: "claude-code", reasoningEffort: "high", serviceTier: "default", personality: "default",
    capabilities: ["files", "shell"], executionProfile: profile(environment, toggles), ...overrides,
  };
  return { ...variant, configHash: computeConfigHash(variant) };
}

function withoutEnvironment(environment) {
  const rest = profile(environment);
  delete rest.environment;
  return rest;
}

function argAfter(args, flag) {
  return args[args.indexOf(flag) + 1];
}

async function credentials(root, { expiresAt = Date.now() + 4 * 60 * 60 * 1000, token = TOKEN } = {}) {
  const file = path.join(root, "credentials.json");
  await writeFile(file, JSON.stringify({ claudeAiOauth: { accessToken: token, refreshToken: "refresh-secret", expiresAt, scopes: ["user:inference"] } }), { mode: 0o600 });
  return file;
}

// A stand-in for claude: echoes the prompt, reports the requested model unless
// told to drift, and records what it received without printing the token. Its
// init event reports what a real session would have loaded from these flags:
// the --tools set, MCP servers from --mcp-config (all of them only without
// --strict-mcp-config, plus claude.ai connectors unless disabled), and the
// permission mode and working directory.
const FAKE_CLAUDE = `#!/usr/bin/env node
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log(process.env.FAKE_VERSION || "2.1.312 (Claude Code)"); process.exit(0); }
let token = "";
try { token = readFileSync(Number(process.env.CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR), "utf8"); } catch {}
const inherited = Object.keys(process.env).filter((key) => /^(CLAUDECODE|CLAUDE_EFFORT|ANTHROPIC_)/.test(key));
const flagValue = (name) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const settings = JSON.parse(flagValue("--settings") || "{}");
const mcpConfig = flagValue("--mcp-config");
let servers = [];
if (mcpConfig) servers = Object.keys(JSON.parse(mcpConfig.startsWith("{") ? mcpConfig : readFileSync(mcpConfig, "utf8")).mcpServers);
if (!args.includes("--strict-mcp-config") && process.env.ENABLE_CLAUDEAI_MCP_SERVERS !== "false" && !settings.disableClaudeAiConnectors) servers.push("claude.ai Gmail");
if (process.env.FAKE_EXTRA_SERVER) servers.push(process.env.FAKE_EXTRA_SERVER);
const tools = (flagValue("--tools") || "").split(",").filter(Boolean).concat(process.env.FAKE_EXTRA_TOOL ? [process.env.FAKE_EXTRA_TOOL] : []).concat(servers.map((name) => "mcp__" + name.replace(/\\W/g, "_") + "__read"));
appendFileSync(process.env.FAKE_LOG, JSON.stringify({ args, settings, tokenMatches: token === process.env.FAKE_EXPECTED_TOKEN, configDir: process.env.CLAUDE_CONFIG_DIR ?? null, autoMemoryOff: process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY ?? null, claudeAi: process.env.ENABLE_CLAUDEAI_MCP_SERVERS ?? null, gitCeiling: process.env.GIT_CEILING_DIRECTORIES, inherited }) + "\\n");
if (process.env.FAKE_HANG) { writeFileSync(process.env.FAKE_HANG, String(process.pid)); setInterval(() => {}, 1000); await new Promise(() => {}); }
const resume = args.indexOf("--resume");
const session = resume >= 0 ? args[resume + 1] : process.env.FAKE_SESSION;
const requested = args[args.indexOf("--model") + 1];
const initModel = (resume >= 0 ? process.env.FAKE_RESUMED_MODEL : process.env.FAKE_FIRST_MODEL) || requested;
const prompt = args.at(-1);
const usageModels = { [requested]: { inputTokens: 5, outputTokens: 2 } };
if (process.env.FAKE_AUX_MODEL) usageModels[process.env.FAKE_AUX_MODEL] = { inputTokens: 1, outputTokens: 1 };
const emit = (event) => console.log(JSON.stringify(event));
emit({ type: "system", subtype: "init", session_id: session, cwd: process.cwd(), model: initModel, permissionMode: process.env.FAKE_PERMISSION_MODE || "bypassPermissions", claude_code_version: "2.1.312", output_style: process.env.FAKE_OUTPUT_STYLE || "default", tools, mcp_servers: servers.map((name) => ({ name, status: "connected" })), ...(process.env.FAKE_NO_LISTS ? {} : { plugins: JSON.parse(process.env.FAKE_PLUGINS || "[]"), skills: JSON.parse(process.env.FAKE_SKILLS || '["code-review","simplify"]'), agents: JSON.parse(process.env.FAKE_AGENTS || '["claude","Explore","general-purpose","Plan"]') }) });
if (process.env.FAKE_TOOL_EVENTS) {
  const use = (id, name, input) => emit({ type: "assistant", parent_tool_use_id: null, session_id: session, message: { model: initModel, content: [{ type: "tool_use", id, name, input }] } });
  const done = (id, isError = false) => emit({ type: "user", parent_tool_use_id: null, session_id: session, message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, is_error: isError, content: "private output " + process.cwd() }] } });
  use("toolu_1", "Write", { file_path: process.cwd() + "/output/notes.md", content: "secret body" });
  done("toolu_1");
  use("toolu_2", "Bash", { command: "cat " + process.env.FAKE_TOOL_EVENTS });
  done("toolu_2", true);
  use("toolu_3", "Read", { file_path: process.env.FAKE_TOOL_EVENTS });
  done("toolu_3");
}
emit({ type: "assistant", parent_tool_use_id: null, session_id: session, message: { model: process.env.FAKE_ASSISTANT_MODEL || initModel, content: [{ type: "text", text: prompt }] } });
emit({ type: "rate_limit_event", session_id: session });
emit({ type: "result", subtype: "success", is_error: false, result: prompt, session_id: session, usage: { input_tokens: 5, output_tokens: 2, service_tier: process.env.FAKE_TIER || "standard" }, modelUsage: usageModels });
`;

async function fakeClaude(root) {
  const executable = path.join(root, "fake-claude.mjs");
  await writeFile(executable, FAKE_CLAUDE, "utf8");
  await chmod(executable, 0o755);
  return executable;
}

test("clean, snapshot and live turn plans pin model, effort, isolation, toggles and exact resume", () => {
  const workspace = "/var/tmp/tk-1000/0123456789abcdef/workspace";
  const harnessHome = "/var/tmp/tk-1000/0123456789abcdef/claude-home";
  const clean = buildClaudeTurnArgs({ variant: claudeVariant("clean"), workspace, harnessHome, prompt: "-Cook" });
  assert.deepEqual(clean.slice(0, 8), ["-p", "--output-format", "stream-json", "--verbose", "--model", "claude-haiku-5-5", "--effort", "high"]);
  assert.ok(clean.includes("--safe-mode"));
  assert.equal(argAfter(clean, "--setting-sources"), "");
  assert.ok(clean.includes("--strict-mcp-config"));
  assert.deepEqual(JSON.parse(argAfter(clean, "--mcp-config")), { mcpServers: {} });
  assert.deepEqual(JSON.parse(argAfter(clean, "--settings")), { disableAllHooks: true, disableClaudeAiConnectors: true });
  assert.equal(argAfter(clean, "--tools"), "Bash,Edit,Glob,Grep,Read,Write");
  assert.equal(argAfter(clean, "--permission-mode"), "bypassPermissions");
  assert.deepEqual(clean.slice(-2), ["--", "-Cook"], "a dash-leading prompt stays a prompt");
  assert.equal(clean.includes("--resume"), false);

  const snapshot = buildClaudeTurnArgs({ variant: claudeVariant("snapshot"), workspace, harnessHome, prompt: "Correct", threadId: SESSION_ID });
  assert.equal(snapshot.includes("--safe-mode"), false);
  assert.equal(argAfter(snapshot, "--setting-sources"), "user");
  assert.equal(argAfter(snapshot, "--tools"), "Bash,Edit,Glob,Grep,Read,Write,Skill");
  assert.equal(argAfter(snapshot, "--resume"), SESSION_ID);
  assert.ok(snapshot.includes("--strict-mcp-config"), "connections off pins an empty MCP set");
  const snapshotSettings = JSON.parse(argAfter(snapshot, "--settings"));
  assert.equal(snapshotSettings.disableAllHooks, true, "a snapshot runs none of his hooks");
  assert.equal(snapshotSettings.autoDreamEnabled, false);
  assert.equal(snapshotSettings.autoMemoryDirectory, path.join(harnessHome, "memory"), "memory reads and writes the copy");
  assert.equal(snapshotSettings.disableClaudeAiConnectors, true);
  // The workspace sits outside any repository, so there are no ancestor instructions to exclude.
  assert.equal("claudeMdExcludes" in snapshotSettings, false);

  const noMemory = JSON.parse(argAfter(buildClaudeTurnArgs({ variant: claudeVariant("snapshot", {}, { memory: "off" }), workspace, harnessHome, prompt: "x" }), "--settings"));
  assert.equal(noMemory.autoMemoryEnabled, false);
  assert.equal("autoMemoryDirectory" in noMemory, false);
  const connected = buildClaudeTurnArgs({ variant: claudeVariant("snapshot", {}, { connections: "on" }), workspace, harnessHome, prompt: "x" });
  assert.equal(connected.includes("--strict-mcp-config"), false, "connections on loads more than the pinned set");
  assert.equal(argAfter(connected, "--mcp-config"), path.join(harnessHome, "mcp.json"), "the copied servers travel as a file, never in argv");
  assert.equal("disableClaudeAiConnectors" in JSON.parse(argAfter(connected, "--settings")), false);

  const live = buildClaudeTurnArgs({ variant: claudeVariant("live"), workspace, prompt: "x", env: { TASTE_CLAUDE_MEMORY_SOURCE: "/home/me/.claude/projects/-home-me/memory" }, pluginsOff: { "github@official": false } });
  const liveSettings = JSON.parse(argAfter(live, "--settings"));
  assert.equal(liveSettings.disableAllHooks, undefined, "live keeps his hooks");
  assert.equal(liveSettings.autoMemoryDirectory, "/home/me/.claude/projects/-home-me/memory", "live memory is his real memory, writes included");
  assert.deepEqual(liveSettings.enabledPlugins, { "github@official": false }, "connections off switches each of his plugins off");
  assert.ok(live.includes("--strict-mcp-config"));
  const liveConnected = buildClaudeTurnArgs({ variant: claudeVariant("live", {}, { connections: "on" }), workspace, prompt: "x" });
  assert.equal(liveConnected.includes("--mcp-config"), false, "live with connections loads whatever his config holds");

  assert.throws(() => buildClaudeTurnArgs({ variant: claudeVariant("clean"), workspace, prompt: "x", threadId: "latest" }), /exact UUID/);
  assert.throws(() => buildClaudeTurnArgs({ variant: claudeVariant("clean"), workspace: "relative", prompt: "x" }), /absolute path/);
  assert.throws(() => buildClaudeTurnArgs({ variant: claudeVariant("clean", { executionProfile: withoutEnvironment("clean") }), workspace, prompt: "x" }), /environment clean, snapshot or live/);
});

test("the child environment drops a parent Claude session, points at the right home, and carries the toggles", () => {
  const base = { PATH: "/bin", CLAUDECODE: "1", CLAUDE_EFFORT: "max", CLAUDE_CONFIG_DIR: "/home/me/.claude", ANTHROPIC_API_KEY: "secret", CLAUDE_CODE_OAUTH_TOKEN: "secret", TASTE_CLAUDE_CREDENTIALS_PATH: "/x" };
  const clean = claudeChildEnv({ variant: claudeVariant("clean"), harnessHome: "/attempt/claude-home", env: { FAKE: "1", ANTHROPIC_MODEL: "other" }, base });
  assert.deepEqual(Object.keys(clean).filter((key) => /^(CLAUDECODE|CLAUDE_EFFORT|ANTHROPIC|TASTE_)/u.test(key) || key === "CLAUDE_CODE_OAUTH_TOKEN"), []);
  assert.equal(clean.PATH, "/bin");
  assert.equal(clean.FAKE, "1");
  assert.equal(clean.CLAUDE_CONFIG_DIR, "/attempt/claude-home");
  assert.equal(clean.CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR, "3");
  assert.equal(clean.ENABLE_CLAUDEAI_MCP_SERVERS, "false");
  assert.equal(clean.CLAUDE_CODE_DISABLE_CLAUDE_MDS, "1");
  assert.equal(clean.CLAUDE_CODE_DISABLE_AUTO_MEMORY, "1");
  assert.equal(clean.GIT_CEILING_DIRECTORIES, undefined);
  const snapshot = claudeChildEnv({ variant: claudeVariant("snapshot"), harnessHome: "/attempt/claude-home", base });
  assert.equal(snapshot.GIT_CEILING_DIRECTORIES, undefined);
  assert.equal(snapshot.CLAUDE_CONFIG_DIR, "/attempt/claude-home");
  assert.equal(snapshot.CLAUDE_CODE_DISABLE_CLAUDE_MDS, undefined, "a snapshot keeps the copied user CLAUDE.md");
  assert.equal(snapshot.CLAUDE_CODE_DISABLE_AUTO_MEMORY, undefined, "memory on");
  assert.equal(snapshot.ENABLE_CLAUDEAI_MCP_SERVERS, "false", "connections off");
  const toggled = claudeChildEnv({ variant: claudeVariant("snapshot", {}, { memory: "off", connections: "on" }), harnessHome: "/attempt/claude-home", base });
  assert.equal(toggled.CLAUDE_CODE_DISABLE_AUTO_MEMORY, "1");
  assert.equal(toggled.ENABLE_CLAUDEAI_MCP_SERVERS, undefined);
  // Live runs exactly as he does: no config dir override, so ~/.claude and ~/.claude.json are his own.
  const live = claudeChildEnv({ variant: claudeVariant("live"), base });
  assert.equal(live.CLAUDE_CONFIG_DIR, undefined, "the parent's CLAUDE_CONFIG_DIR is dropped, not inherited");
  assert.equal(claudeChildEnv({ variant: claudeVariant("live"), base, env: { TASTE_CLAUDE_PERSONAL_HOME: "/tmp/fake-claude" } }).CLAUDE_CONFIG_DIR, "/tmp/fake-claude");
});

test("Claude Code JSONL requires one init, main-thread assistant evidence, and one successful result", () => {
  const init = { type: "system", subtype: "init", session_id: SESSION_ID, model: "claude-haiku-5-5" };
  const assistant = { type: "assistant", parent_tool_use_id: null, message: { model: "claude-haiku-5-5" } };
  const result = { type: "result", subtype: "success", is_error: false, result: "Done", session_id: SESSION_ID, usage: { output_tokens: 1 } };
  const jsonl = (...events) => events.map((event) => JSON.stringify(event)).join("\n");
  const parsed = parseClaudeJsonl(jsonl(init, assistant, result));
  assert.equal(parsed.threadId, SESSION_ID);
  assert.equal(parsed.model, "claude-haiku-5-5");
  assert.equal(parsed.finalMessage, "Done");
  assert.throws(() => parseClaudeJsonl(jsonl(init, assistant, { ...result, is_error: true, subtype: "error_during_execution" })), /reported failure/);
  assert.throws(() => parseClaudeJsonl(jsonl(init, init, assistant, result)), /exactly one/);
  assert.throws(() => parseClaudeJsonl(jsonl(init, assistant, result, result)), /exactly one/);
  assert.throws(() => parseClaudeJsonl(jsonl(result, init, assistant)), /before its init/);
  assert.throws(() => parseClaudeJsonl(jsonl(init, assistant, { ...result, session_id: "01901234-5678-7abc-8def-0123456789ab" })), /did not match its init/);
  assert.throws(() => parseClaudeJsonl(jsonl(init, result)), /no assistant message/);
  assert.throws(() => parseClaudeJsonl("{nope"), /Invalid Claude Code JSONL/);
});

test("Claude Code tool use becomes public trace actions: kinds, statuses and workspace paths, never commands or outside paths", () => {
  const workspace = "/var/tmp/tk-1000/abc/workspace";
  const use = (id, name, input, parent = null) => ({ type: "assistant", parent_tool_use_id: parent, message: { model: "claude-haiku-5-5", content: [{ type: "text", text: "x" }, { type: "tool_use", id, name, input }] } });
  const done = (id, isError) => ({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, ...(isError === undefined ? {} : { is_error: isError }), content: `ran in ${workspace}` }] } });
  const actions = publicActions([
    use("a", "Write", { file_path: `${workspace}/output/page.html`, content: "<p>secret</p>" }), done("a", false),
    use("b", "Bash", { command: `rm -rf ${workspace}` }), done("b", true),
    use("c", "Read", { file_path: "/home/someone/.claude/CLAUDE.md" }), done("c"),
    use("d", "Grep", { pattern: "x", path: "src" }),
    use("e", "mcp__tududi__create_task", { name: "private task" }), done("e", false),
    use("f", "Edit", { file_path: `${workspace}/../escape.txt` }, "toolu_parent"),
  ], [workspace]);
  assert.deepEqual(actions, [
    { event: "item.started", type: "file_change", tool: "Write", path: "output/page.html" },
    { event: "item.completed", type: "file_change", tool: "Write", status: "completed", path: "output/page.html" },
    { event: "item.started", type: "command_execution", tool: "Bash" },
    { event: "item.completed", type: "command_execution", tool: "Bash", status: "failed" },
    { event: "item.started", type: "tool_call", tool: "Read" },
    { event: "item.completed", type: "tool_call", tool: "Read", status: "completed" },
    { event: "item.started", type: "tool_call", tool: "Grep", path: "src" },
    { event: "item.started", type: "mcp_tool_call" },
    { event: "item.completed", type: "mcp_tool_call", status: "completed" },
    { event: "item.started", type: "file_change", tool: "Edit" },
  ]);
  assert.equal(JSON.stringify(actions).includes("someone"), false);
  // Codex item events keep their existing mapping.
  assert.deepEqual(publicActions([{ type: "item.completed", item: { type: "command_execution", status: "completed", exit_code: 0, command: "ls" } }], [workspace]), [{ event: "item.completed", type: "command_execution", status: "completed", exitCode: 0 }]);
});

test("the access token is read without quoting it and must outlive the run", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "taste-claude-token-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fresh = await credentials(root);
  assert.equal(await readClaudeAccessToken({ env: { TASTE_CLAUDE_CREDENTIALS_PATH: fresh } }), TOKEN);
  const expiring = await credentials(root, { expiresAt: Date.now() + 60_000 });
  await assert.rejects(readClaudeAccessToken({ env: { TASTE_CLAUDE_CREDENTIALS_PATH: expiring } }), (error) => /expires within 30 minutes/.test(error.message) && !error.message.includes(TOKEN));
  await assert.rejects(readClaudeAccessToken({ env: { TASTE_CLAUDE_CREDENTIALS_PATH: path.join(root, "missing.json") } }), /unavailable or unreadable/);
  const noExpiry = await credentials(root, { expiresAt: null });
  await assert.rejects(readClaudeAccessToken({ env: { TASTE_CLAUDE_CREDENTIALS_PATH: noExpiry } }), /lack a valid OAuth expiry/);
  await credentials(root);
  await assert.rejects(readClaudeAccessToken({ env: { TASTE_CLAUDE_CREDENTIALS_PATH: fresh, TASTE_CLAUDE_TOKEN_MARGIN_MS: "soon" } }), /margin must be a non-negative number/);
  for (const margin of ["", "  ", "-1"]) await assert.rejects(readClaudeAccessToken({ env: { TASTE_CLAUDE_CREDENTIALS_PATH: fresh, TASTE_CLAUDE_TOKEN_MARGIN_MS: margin } }), /margin must be a non-negative number/);
  const empty = path.join(root, "empty.json");
  await writeFile(empty, JSON.stringify({ mcpOAuth: {} }));
  await assert.rejects(readClaudeAccessToken({ env: { TASTE_CLAUDE_CREDENTIALS_PATH: empty } }), /lack a claude.ai OAuth access token/);
});

/** A stand-in ~/.claude, ~/.claude.json and home memory under `root`. Nothing here touches the real setup. */
async function fakeSetup(root) {
  const home = path.join(root, "dot-claude");
  await mkdir(path.join(home, "skills", "tdd", "references"), { recursive: true });
  await writeFile(path.join(home, "skills", "tdd", "SKILL.md"), "---\nname: tdd\n---\nRed, green, refactor.\n");
  await writeFile(path.join(home, "skills", "tdd", "references", "loop.md"), "The loop.\n");
  // A skill that lives in a repository: only its tracked files travel, never its chats.
  const repo = path.join(root, "skills-repo");
  await mkdir(path.join(repo, "cockpit", "chats"), { recursive: true });
  await writeFile(path.join(repo, "cockpit", "SKILL.md"), "---\nname: cockpit\n---\nCoordinate.\n");
  await writeFile(path.join(repo, "cockpit", "chats", "private-chat.md"), "untracked chat\n");
  await execFileAsync("git", ["-C", repo, "init", "-q"]);
  await execFileAsync("git", ["-C", repo, "add", "cockpit/SKILL.md"]);
  await symlink(path.join(repo, "cockpit"), path.join(home, "skills", "cockpit"));
  const soul = path.join(root, "soul.md");
  await writeFile(soul, "# Prime\n");
  await symlink(soul, path.join(home, "CLAUDE.md"));
  await writeFile(path.join(home, "settings.json"), JSON.stringify({ model: "opus", effortLevel: "max", language: "English", enabledPlugins: { "github@official": true }, hooks: { Stop: [] } }));
  await writeFile(path.join(home, ".credentials.json"), "{\"claudeAiOauth\":{\"accessToken\":\"never-copied\"}}\n");
  await mkdir(path.join(home, "projects", "-other", "memory"), { recursive: true });
  await writeFile(path.join(home, "projects", "-other", "memory", "MEMORY.md"), "- other project\n");
  const memory = path.join(root, "home-memory");
  await mkdir(memory);
  await writeFile(path.join(memory, "MEMORY.md"), "- [Keep answers light](light.md)\n");
  await writeFile(path.join(memory, "light.md"), "Lead with the recommendation.\n");
  const globalConfig = path.join(root, "claude.json");
  await writeFile(globalConfig, JSON.stringify({ oauthAccount: { emailAddress: "private@example.invalid" }, mcpServers: { tududi: { type: "stdio", command: "/usr/bin/python3", args: ["mcp.py"] } } }));
  return { home, memory, globalConfig, env: { TASTE_CLAUDE_PERSONAL_HOME: home, TASTE_CLAUDE_MEMORY_SOURCE: memory, TASTE_CLAUDE_GLOBAL_CONFIG: globalConfig } };
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

test("a clean attempt home starts empty; a snapshot home holds a bounded copy of his setup and a stable digest", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "taste-claude-home-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const setup = await fakeSetup(root);
  const env = { TASTE_CLAUDE_CREDENTIALS_PATH: await credentials(root), ...setup.env };

  const cleanHome = path.join(root, "clean-home");
  assert.deepEqual(await prepareClaudeAttempt({ variant: claudeVariant("clean"), harnessHome: cleanHome, env }), { setup: null });
  assert.deepEqual(await readdir(cleanHome), [], "no credential file, settings or instructions");
  assert.equal((await lstat(cleanHome)).mode & 0o777, 0o700);

  const snapshotHome = path.join(root, "snapshot-home");
  const { setup: record } = await prepareClaudeAttempt({ variant: claudeVariant("snapshot"), harnessHome: snapshotHome, env });
  assert.deepEqual(await listTree(snapshotHome), ["CLAUDE.md", "memory/MEMORY.md", "memory/light.md", "settings.json", "skills/cockpit/SKILL.md", "skills/tdd/SKILL.md", "skills/tdd/references/loop.md"]);
  assert.equal((await lstat(path.join(snapshotHome, "CLAUDE.md"))).isSymbolicLink(), false, "a copy, never a link back into his home");
  assert.equal(await readFile(path.join(snapshotHome, "CLAUDE.md"), "utf8"), "# Prime\n");
  assert.deepEqual(JSON.parse(await readFile(path.join(snapshotHome, "settings.json"), "utf8")), { language: "English" }, "only chosen settings: no model, effort, hooks or plugins");
  assert.equal((await lstat(path.join(snapshotHome, "skills/tdd/SKILL.md"))).mode & 0o777, 0o600);
  assert.match(record.digest, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(record.entries.map((entry) => entry.entry), ["CLAUDE.md", "memory", "settings.json", "skills"]);
  assert.equal(JSON.stringify(record).includes("loop.md"), false, "the summary names entries, never files below them");
  assert.deepEqual({ environment: record.environment, memory: record.memory, connections: record.connections }, { environment: "snapshot", memory: "on", connections: "off" });

  // The same setup copies to the same digest; any byte of it moves the digest.
  const again = await prepareClaudeAttempt({ variant: claudeVariant("snapshot"), harnessHome: path.join(root, "again"), env });
  assert.equal(again.setup.digest, record.digest);
  assert.equal(await currentClaudeSetupDigest({ variant: claudeVariant("snapshot"), env }), record.digest, "fill-missing reads the same digest without copying");
  await writeFile(path.join(setup.memory, "light.md"), "Lead with the answer.\n");
  const edited = await prepareClaudeAttempt({ variant: claudeVariant("snapshot"), harnessHome: path.join(root, "edited"), env });
  assert.notEqual(edited.setup.digest, record.digest);
  // Untracked files in a skill's repository and settings Kitchen does not keep leave the digest alone.
  await writeFile(path.join(root, "skills-repo", "cockpit", "chats", "another.md"), "more chat\n");
  await writeFile(path.join(setup.home, "settings.json"), JSON.stringify({ language: "English", model: "sonnet" }));
  assert.equal(await currentClaudeSetupDigest({ variant: claudeVariant("snapshot"), env }), edited.setup.digest);

  const noMemory = await prepareClaudeAttempt({ variant: claudeVariant("snapshot", {}, { memory: "off" }), harnessHome: path.join(root, "no-memory"), env });
  assert.equal((await readdir(path.join(root, "no-memory"))).includes("memory"), false);
  assert.notEqual(noMemory.setup.digest, edited.setup.digest);
  const connectedHome = path.join(root, "connected");
  await prepareClaudeAttempt({ variant: claudeVariant("snapshot", {}, { connections: "on" }), harnessHome: connectedHome, env });
  assert.deepEqual(JSON.parse(await readFile(path.join(connectedHome, "mcp.json"), "utf8")), { mcpServers: { tududi: { args: ["mcp.py"], command: "/usr/bin/python3", type: "stdio" } } });
  assert.equal(JSON.stringify(await listTree(connectedHome)).includes("credentials"), false, "never the credential file");

  // Live copies nothing and touches nothing; its record notes where his setup stood.
  const live = await prepareClaudeAttempt({ variant: claudeVariant("live"), harnessHome: path.join(root, "live-home"), env });
  assert.equal(await readdir(path.join(root, "live-home")).catch(() => "absent"), "absent");
  assert.equal(live.setup.home, "real");
  assert.match(live.setup.digestAtStart, /^sha256:/);
  assert.equal(live.setup.digest, undefined, "a live digest never groups Repeats");

  await assert.rejects(prepareClaudeAttempt({ variant: claudeVariant("clean"), harnessHome: snapshotHome, env }), /must start empty/);
  await assert.rejects(prepareClaudeAttempt({ variant: claudeVariant("clean"), harnessHome: path.join(root, "late"), env: { ...env, TASTE_CLAUDE_CREDENTIALS_PATH: await credentials(path.join(root, "dot-claude"), { expiresAt: Date.now() }) } }), /expires within/);
});

test("Claude Code runs fixed turns in one session, hands the token on a descriptor, and verifies identity", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "taste-claude-run-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const executable = await fakeClaude(root);
  const workspace = path.join(root, "workspace");
  const harnessHome = path.join(root, "claude-home");
  await mkdir(workspace);
  await mkdir(harnessHome);
  const log = path.join(root, "calls.jsonl");
  const variant = claudeVariant("clean");
  const env = { FAKE_LOG: log, FAKE_SESSION: SESSION_ID, FAKE_EXPECTED_TOKEN: TOKEN, TASTE_CLAUDE_CREDENTIALS_PATH: await credentials(root), CLAUDECODE: "1", CLAUDE_EFFORT: "max" };
  const recipe = { setup: { instructions: "Set the table." }, turns: [{ id: "make", content: "Cook" }, { id: "correct", content: "Correct" }] };
  const run = (extra = {}, privateDir = path.join(root, `raw-${Math.random()}`)) => runClaudeSession({ variant, recipe, workspace, privateDir, harnessHome, executable, env: { ...env, ...extra } });

  const result = await run();
  assert.equal(result.failure, null);
  assert.equal(result.threadId, SESSION_ID);
  assert.equal(result.cliVersion, "claude-code 2.1.312");
  assert.equal(result.observedModel, "claude-haiku-5-5");
  assert.equal(result.turns[0].finalMessage, "Set the table.\n\nCook");
  const calls = (await readFile(log, "utf8")).trim().split("\n").map(JSON.parse);
  assert.equal(calls[0].args.includes("--resume"), false);
  assert.equal(argAfter(calls[1].args, "--resume"), SESSION_ID);
  for (const call of calls) {
    assert.equal(call.tokenMatches, true);
    assert.equal(call.configDir, harnessHome);
    assert.equal(call.gitCeiling, undefined);
    assert.deepEqual(call.inherited, []);
    assert.equal(call.args.some((arg) => arg.includes(TOKEN)), false);
  }
  assert.equal(JSON.stringify(result).includes(TOKEN), false, "the token never enters recorded evidence");

  const observed = await verifyClaudeIdentity({ variant, result, cliVersion: result.cliVersion, codexHome: path.join(root, "codex-home") });
  assert.equal(observed.model, "claude-haiku-5-5");
  assert.deepEqual(observed.loaded.mcpServers, []);
  assert.equal(observed.reasoningEffortEvidence, "pinned-argv");
  assert.equal(observed.observedServiceTier, "standard");
  assert.equal(observed.serviceTier, "standard", "the Dish keeps the tier the stream reported");
  assert.deepEqual(observed.auxiliaryModels, []);

  const drifted = structuredClone(result);
  drifted.turns[1].events.find((event) => event.type === "assistant").message.model = "claude-sonnet-5-5";
  await assert.rejects(verifyClaudeIdentity({ variant, result: drifted, cliVersion: result.cliVersion }), /model mismatch in turn correct.*claude-sonnet-5-5/);
  const unpinned = structuredClone(result);
  unpinned.turns[0].argv = unpinned.turns[0].argv.map((arg) => arg === "high" ? "max" : arg);
  await assert.rejects(verifyClaudeIdentity({ variant, result: unpinned, cliVersion: result.cliVersion }), /--effort high/);
  const unsafe = structuredClone(result);
  unsafe.turns[0].argv = unsafe.turns[0].argv.filter((arg) => arg !== "--safe-mode");
  await assert.rejects(verifyClaudeIdentity({ variant, result: unsafe, cliVersion: result.cliVersion }), /safe mode/);
  // The init event is Claude Code's own account of the session; a CLI that ignored a flag fails here.
  const ignoredTools = await run({ FAKE_EXTRA_TOOL: "WebFetch" });
  await assert.rejects(verifyClaudeIdentity({ variant, result: ignoredTools, cliVersion: ignoredTools.cliVersion }), /init loaded tools .*WebFetch/);
  const ignoredMcp = await run({ FAKE_EXTRA_SERVER: "linear" });
  await assert.rejects(verifyClaudeIdentity({ variant, result: ignoredMcp, cliVersion: ignoredMcp.cliVersion }), /MCP servers with connections off: linear/);
  const prompting = await run({ FAKE_PERMISSION_MODE: "default" });
  await assert.rejects(verifyClaudeIdentity({ variant, result: prompting, cliVersion: prompting.cliVersion }), /permission mode default/);
  await assert.rejects(verifyClaudeIdentity({ variant, result, cliVersion: result.cliVersion, codexHome: path.join(root, "elsewhere", "codex-home") }), /working directory other than the attempt workspace/);
  const altered = structuredClone(result);
  altered.turns[0].finalMessage = "altered";
  await assert.rejects(verifyClaudeIdentity({ variant, result: altered, cliVersion: result.cliVersion }), /final message does not match/);
  await assert.rejects(verifyClaudeIdentity({ variant, result, cliVersion: "claude-code 9.9.9" }), /CLI/);

  const auxiliary = await run({ FAKE_AUX_MODEL: "claude-haiku-4-5" });
  assert.deepEqual((await verifyClaudeIdentity({ variant, result: auxiliary, cliVersion: auxiliary.cliVersion })).auxiliaryModels, ["claude-haiku-4-5"]);
  const priority = await run({ FAKE_TIER: "priority" });
  await assert.rejects(verifyClaudeIdentity({ variant, result: priority, cliVersion: priority.cliVersion }), /tier requested default, observed priority/);
  const styled = await run({ FAKE_OUTPUT_STYLE: "Explanatory" });
  await assert.rejects(verifyClaudeIdentity({ variant, result: styled, cliVersion: styled.cliVersion }), /output style/);

  // A clean session loads only what Claude Code bundles: what its init reports is the evidence (#45).
  assert.deepEqual(observed.isolation, { evidence: "claude-code-init", agents: ["Explore", "Plan", "claude", "general-purpose"], skills: ["code-review", "simplify"], plugins: [] });
  const outsidePlugin = await run({ FAKE_PLUGINS: JSON.stringify([{ name: "github", path: "/home/someone/.claude/plugins/cache/github", source: "github@claude-plugins-official" }]) });
  await assert.rejects(verifyClaudeIdentity({ variant, result: outsidePlugin, cliVersion: outsidePlugin.cliVersion }), /clean Claude Code session loaded plugin github@claude-plugins-official, which is not built in/);
  const bundledPlugin = await run({ FAKE_PLUGINS: JSON.stringify([{ name: "artifacts", path: "builtin", source: "artifacts@builtin" }]), FAKE_SKILLS: JSON.stringify(["simplify", "artifacts:make"]) });
  assert.deepEqual((await verifyClaudeIdentity({ variant, result: bundledPlugin, cliVersion: bundledPlugin.cliVersion })).isolation.plugins, ["artifacts"], "a built-in plugin and its own skills are the harness's");
  const outsideAgent = await run({ FAKE_AGENTS: JSON.stringify(["general-purpose", "cockpit-runner"]) });
  await assert.rejects(verifyClaudeIdentity({ variant, result: outsideAgent, cliVersion: outsideAgent.cliVersion }), /agent cockpit-runner outside Claude Code's bundled set/);
  const outsideSkill = await run({ FAKE_SKILLS: JSON.stringify(["simplify", "consult"]) });
  await assert.rejects(verifyClaudeIdentity({ variant, result: outsideSkill, cliVersion: outsideSkill.cliVersion }), /skill consult outside Claude Code's bundled set/);
  const unlisted = await run({ FAKE_NO_LISTS: "1" });
  await assert.rejects(verifyClaudeIdentity({ variant, result: unlisted, cliVersion: unlisted.cliVersion }), /init event lacks its plugin list/);
  // A personal session is meant to load his skills; it is held to the request, not to the bundled set.
  const snapshotVariant = claudeVariant("snapshot");
  const personal = await runClaudeSession({ variant: snapshotVariant, recipe, workspace, privateDir: path.join(root, "raw-personal"), harnessHome, executable, env: { ...env, FAKE_SKILLS: JSON.stringify(["consult"]), FAKE_AGENTS: JSON.stringify(["cockpit-runner"]) } });
  assert.equal((await verifyClaudeIdentity({ variant: snapshotVariant, result: personal, cliVersion: personal.cliVersion })).isolation, undefined);

  const wrongFirst = await run({ FAKE_FIRST_MODEL: "claude-opus-5-5" });
  assert.match(wrongFirst.failure.message, /model mismatch/);
  assert.equal(wrongFirst.turns.length, 1, "stop before spending a second turn after a wrong first model");
  await assert.rejects(verifyClaudeIdentity({ variant, result: wrongFirst, cliVersion: wrongFirst.cliVersion }), /failed turn/);
  const wrongLast = await run({ FAKE_RESUMED_MODEL: "claude-opus-5-5" });
  assert.equal(wrongLast.turns.length, 2);
  assert.match(wrongLast.failure.message, /model mismatch/);
});

test("the adapter accepts the catalog's Claude Code shapes and refuses near misses", () => {
  assert.doesNotThrow(() => resolveHarnessAdapter(claudeVariant("clean")));
  assert.doesNotThrow(() => resolveHarnessAdapter(claudeVariant("snapshot", { reasoningEffort: "max" })));
  assert.doesNotThrow(() => resolveHarnessAdapter(claudeVariant("snapshot", {}, { memory: "off", connections: "on" })));
  assert.doesNotThrow(() => resolveHarnessAdapter(claudeVariant("live", {}, { memory: "off" })));
  assert.throws(() => resolveHarnessAdapter(claudeVariant("clean", { model: "opus" })), /full claude-\* model id/);
  assert.throws(() => resolveHarnessAdapter(claudeVariant("clean", { provider: "openai" })), /provider anthropic/);
  assert.throws(() => resolveHarnessAdapter(claudeVariant("clean", { reasoningEffort: "adaptive" })), /effort must be one of/);
  assert.throws(() => resolveHarnessAdapter(claudeVariant("clean", { serviceTier: "fast" })), /default service tier/);
  assert.throws(() => resolveHarnessAdapter(claudeVariant("clean", { executionProfile: { ...profile("clean"), environment: "live" } })), /environment must be clean/);
  assert.throws(() => resolveHarnessAdapter(claudeVariant("snapshot", { executionProfile: { ...profile("snapshot"), harnessProfile: "rose" } })), /named harness profile/);
  const { memory, ...withoutMemory } = profile("snapshot");
  assert.equal(memory, "on");
  assert.throws(() => resolveHarnessAdapter(claudeVariant("snapshot", { executionProfile: withoutMemory })), /must set memory/);
  assert.throws(() => resolveHarnessAdapter(claudeVariant("clean", { executionProfile: withoutEnvironment("clean") })), /environment must be clean/);
  const adapter = getHarnessAdapter("claude-code");
  assert.equal(adapter.executable, "claude");
  assert.equal(adapter.homeDirectory, "claude-home");
});

async function runnerFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "taste-claude-runner-"));
  const recipeDir = path.join(root, "catalog/recipes/conversation/demo");
  await mkdir(path.join(recipeDir, "fixtures"), { recursive: true });
  await writeFile(path.join(recipeDir, "fixtures/context.txt"), "public context\n");
  const recipe = {
    schemaVersion: 1, id: "demo-session", version: "1.0.0", status: "ready", title: "A demo session recipe",
    summary: "A sufficiently detailed demo for runner testing.", domain: "conversation", origin: "textbook", originNote: "A runner integration test.",
    tags: ["presence"], kind: "session", harness: { workspace: "read", web: "disabled", capabilities: [] },
    setup: { instructions: "Read the mounted public context.", fixtures: [{ id: "context", path: "fixtures/context.txt", mountAs: "inputs/context.txt", public: true, mediaType: "text/plain" }] },
    turns: [{ id: "opening", role: "prompt", content: "Respond once." }, { id: "correction", role: "correction", content: "Now respond more directly." }],
    output: { kind: "session", entry: "output/session.json", include: ["output/session.json"], limits: { maxFiles: 2, maxBytes: 32768 } },
    validation: { mode: "completeness", checks: [{ id: "entry", type: "file-exists", required: true, description: "The transcript exists.", target: "output/session.json" }] },
    sourcePath: "catalog/recipes/conversation/demo/recipe.json",
    fixtureHashes: { context: sha256("public context\n") },
  };
  recipe.recipeHash = computeRecipeHash(recipe, recipe.fixtureHashes);
  const setup = await fakeSetup(root);
  const env = {
    FAKE_LOG: path.join(root, "calls.jsonl"), FAKE_SESSION: SESSION_ID, FAKE_EXPECTED_TOKEN: TOKEN,
    TASTE_CLAUDE_CREDENTIALS_PATH: await credentials(root), ...setup.env,
  };
  return { root, recipe, catalog: { catalogHash: `sha256:${"4".repeat(64)}`, recipes: [recipe] }, executable: await fakeClaude(root), env };
}

test("snapshot and live Claude Code Dishes land in private/dishes, a clean one in dishes; only a snapshot names its setup digest", async (t) => {
  const f = await runnerFixture();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  const cook = (variant, nonce, extra = {}) => executeRecipe({
    repoRoot: f.root, catalog: f.catalog, recipe: f.recipe, variant,
    executable: f.executable, env: f.env, now: new Date("2026-11-08T12:00:00.000Z"), nonce, ...extra,
  });
  const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));

  const outsideFile = path.join(f.root, "outside-secret.txt");
  const clean = await cook(claudeVariant("clean"), "clean", { env: { ...f.env, FAKE_TOOL_EVENTS: outsideFile } });
  assert.equal(clean.status, "accepted", clean.error);
  // The public trace shows the Run's tool activity, through the same publication scan as every Dish.
  const trace = await readFile(path.join(clean.dishDirectory, "trace.json"), "utf8");
  assert.deepEqual(JSON.parse(trace).turns[0].actions.map((action) => [action.type, action.status ?? "started", action.path ?? null]), [
    ["file_change", "started", "output/notes.md"], ["file_change", "completed", "output/notes.md"],
    ["command_execution", "started", null], ["command_execution", "failed", null],
    ["tool_call", "started", null], ["tool_call", "completed", null],
  ]);
  for (const leak of [f.root, "secret body", "private output", "outside-secret"]) assert.equal(trace.includes(leak), false, `trace leaks ${leak}`);
  assert.equal(path.relative(f.root, clean.dishDirectory).split(path.sep)[0], "dishes");
  const dish = await readJson(path.join(clean.dishDirectory, "dish.json"));
  assert.equal(dish.identity.harness, "claude-code");
  assert.equal(dish.identity.harnessVersion, "claude-code 2.1.312");
  assert.equal(dish.identity.observedModel, "claude-haiku-5-5");
  assert.equal(dish.identity.observedServiceTier, "standard");
  assert.equal(dish.identity.setupDigest, undefined);
  assert.equal(dish.visibility, undefined);
  const cleanReceipt = await readJson(path.join(clean.dishDirectory, "receipt.json"));
  assert.equal(cleanReceipt.setup, undefined);
  assert.deepEqual(cleanReceipt.isolation, { evidence: "claude-code-init", agents: ["Explore", "Plan", "claude", "general-purpose"], skills: ["code-review", "simplify"], plugins: [] }, "the receipt shows the isolation the init proved");
  const attemptDir = path.join(f.root, "private/runtime/attempts", clean.attemptId);
  assert.deepEqual((await readJson(path.join(attemptDir, "observed.json"))).isolation, cleanReceipt.isolation);
  const requested = await readJson(path.join(attemptDir, "requested.json"));
  // Published: the whole cook directory is gone, the clean home with it.
  assert.equal(await pathExists(requested.cookDirectory), false);
  assert.equal(requested.execution.environment, "clean");
  assert.equal(requested.execution.setup, "none (safe mode)");
  assert.equal(requested.execution.mcpServers, "none");
  assert.equal(requested.setup, undefined);
  const execution = await readFile(path.join(attemptDir, "execution.json"), "utf8");
  assert.equal(execution.includes(TOKEN), false);

  const snapshot = await cook(claudeVariant("snapshot"), "snapshot");
  assert.equal(snapshot.status, "accepted", snapshot.error);
  assert.deepEqual(path.relative(f.root, snapshot.dishDirectory).split(path.sep).slice(0, 2), ["private", "dishes"]);
  const snapshotDish = await readJson(path.join(snapshot.dishDirectory, "dish.json"));
  assert.equal(snapshotDish.visibility, "private");
  const snapshotRequest = await readJson(path.join(f.root, "private/runtime/attempts", snapshot.attemptId, "requested.json"));
  assert.match(snapshotRequest.setup.digest, /^sha256:/);
  assert.equal(snapshotDish.identity.setupDigest, snapshotRequest.setup.digest, "the Dish names the setup it saw");
  const receipt = await readJson(path.join(snapshot.dishDirectory, "receipt.json"));
  assert.equal(receipt.setup.digest, snapshotDish.identity.setupDigest);
  assert.deepEqual(receipt.setup.loaded, { mcpServers: [], plugins: [] });
  assert.deepEqual(receipt.setup.entries.map((entry) => entry.entry), ["CLAUDE.md", "memory", "settings.json", "skills"]);
  // The copy is discarded once the attempt ends; the digest is what remains of it.
  assert.equal(await pathExists(snapshotRequest.cookDirectory), false);
  const snapshotCall = (await readFile(f.env.FAKE_LOG, "utf8")).trim().split("\n").map(JSON.parse).at(-1);
  assert.equal(snapshotCall.configDir, path.join(snapshotRequest.cookDirectory, "claude-home"));

  // Live: his real home (here the stand-in), nothing copied, no digest on the Dish.
  const live = await cook(claudeVariant("live"), "live");
  assert.equal(live.status, "accepted", live.error);
  assert.deepEqual(path.relative(f.root, live.dishDirectory).split(path.sep).slice(0, 2), ["private", "dishes"]);
  const liveDish = await readJson(path.join(live.dishDirectory, "dish.json"));
  assert.equal(liveDish.identity.setupDigest, undefined);
  const liveReceipt = await readJson(path.join(live.dishDirectory, "receipt.json"));
  assert.equal(liveReceipt.setup.environment, "live");
  assert.match(liveReceipt.setup.digestAtStart, /^sha256:/);
  const liveCall = (await readFile(f.env.FAKE_LOG, "utf8")).trim().split("\n").map(JSON.parse).at(-1);
  assert.equal(liveCall.configDir, f.env.TASTE_CLAUDE_PERSONAL_HOME, "live runs in his own home");
  assert.equal(JSON.parse(argAfter(liveCall.args, "--settings")).autoMemoryDirectory, f.env.TASTE_CLAUDE_MEMORY_SOURCE);

  // Memory off: nothing copied, auto-memory disabled for the child.
  const noMemory = await cook(claudeVariant("snapshot", {}, { memory: "off" }), "no-memory");
  assert.equal(noMemory.status, "accepted", noMemory.error);
  const noMemoryCall = (await readFile(f.env.FAKE_LOG, "utf8")).trim().split("\n").map(JSON.parse).at(-1);
  assert.equal(noMemoryCall.autoMemoryOff, "1");
  assert.equal(JSON.parse(argAfter(noMemoryCall.args, "--settings")).autoMemoryEnabled, false);
  assert.notEqual((await readJson(path.join(noMemory.dishDirectory, "dish.json"))).identity.setupDigest, snapshotDish.identity.setupDigest);

  // Connections on: refused without the explicit flag, then the loaded servers are recorded.
  const connectedVariant = claudeVariant("snapshot", {}, { connections: "on" });
  await assert.rejects(cook(connectedVariant, "refused"), /--allow-connections/);
  const connected = await cook(connectedVariant, "connected", { allowConnections: true });
  assert.equal(connected.status, "accepted", connected.error);
  const connectedReceipt = await readJson(path.join(connected.dishDirectory, "receipt.json"));
  assert.deepEqual(connectedReceipt.setup.loaded.mcpServers, ["claude.ai Gmail", "tududi"]);
  assert.equal(connectedReceipt.setup.connections, "on");
  const connectedCall = (await readFile(f.env.FAKE_LOG, "utf8")).trim().split("\n").map(JSON.parse).at(-1);
  assert.equal(connectedCall.claudeAi, null, "claude.ai connectors stay available");

  // Publishing a snapshot Dish is a deliberate choice.
  const published = await cook(claudeVariant("snapshot"), "published", { publishPersonal: true });
  assert.equal(path.relative(f.root, published.dishDirectory).split(path.sep)[0], "dishes");
});

test("a snapshot Claude Code attempt that failed at publication recovers privately with the digest it recorded, not today's setup", async (t) => {
  const f = await runnerFixture();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  const variant = claudeVariant("snapshot");
  // A Dish directory already in the way fails the attempt at publication, after the model ran.
  const blockPublication = (nonce) => mkdir(path.join(f.root, "private/dishes", `dish_${f.recipe.id}_${variant.id}_20261108120000000_${nonce}`), { recursive: true });
  await blockPublication("recover");
  const cooked = await executeRecipe({ repoRoot: f.root, catalog: f.catalog, recipe: f.recipe, variant, executable: f.executable, env: f.env, now: new Date("2026-11-08T12:00:00.000Z"), nonce: "recover" });
  assert.equal(cooked.status, "failed");
  assert.match(cooked.error, /already exists/);
  const attemptDir = path.join(f.root, "private/runtime/attempts", cooked.attemptId);
  const { cookDirectory, setup } = JSON.parse(await readFile(path.join(attemptDir, "requested.json"), "utf8"));
  assert.equal(await pathExists(path.join(cookDirectory, "workspace")), true, "a failed attempt keeps its cook directory for recovery");
  // Change his setup in the meantime: recovery must use the digest the attempt recorded.
  await rm(path.join(f.root, "private/dishes", dishIdFor(cooked.attemptId)), { recursive: true });
  await writeFile(path.join(f.env.TASTE_CLAUDE_MEMORY_SOURCE, "light.md"), "Changed after the run.\n");
  const recovered = await recoverAttempt({ repoRoot: f.root, catalog: f.catalog, attemptId: cooked.attemptId, env: f.env });
  assert.equal(recovered.status, "accepted");
  assert.deepEqual(path.relative(f.root, recovered.dishDirectory).split(path.sep).slice(0, 2), ["private", "dishes"], "recovery keeps the unpublished choice");
  const dish = JSON.parse(await readFile(path.join(recovered.dishDirectory, "dish.json"), "utf8"));
  assert.equal(dish.identity.setupDigest, setup.digest);
  assert.equal(JSON.parse(await readFile(path.join(attemptDir, "recovery.json"), "utf8")).modelInvoked, false);
  assert.equal(await pathExists(cookDirectory), false, "a recovered Dish's cook directory is removed");

  // A request whose setup record no longer matches its configuration does not recover.
  await blockPublication("tampered");
  const second = await executeRecipe({ repoRoot: f.root, catalog: f.catalog, recipe: f.recipe, variant, executable: f.executable, env: f.env, now: new Date("2026-11-08T12:00:00.000Z"), nonce: "tampered" });
  assert.equal(second.status, "failed");
  await rm(path.join(f.root, "private/dishes", dishIdFor(second.attemptId)), { recursive: true });
  const secondDir = path.join(f.root, "private/runtime/attempts", second.attemptId);
  const requested = JSON.parse(await readFile(path.join(secondDir, "requested.json"), "utf8"));
  delete requested.setup.digest;
  await writeFile(path.join(secondDir, "requested.json"), JSON.stringify(requested));
  await assert.rejects(recoverAttempt({ repoRoot: f.root, catalog: f.catalog, attemptId: second.attemptId, env: f.env }), /SHA-256 setup digest/);
});

test("a clean Claude Code attempt recovers by re-proving its isolation from the recorded stream, and refuses a stream that loaded his skills", async (t) => {
  const f = await runnerFixture();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  const variant = claudeVariant("clean");
  const blocked = async (nonce) => {
    await mkdir(path.join(f.root, "dishes", `dish_${f.recipe.id}_${variant.id}_20261108120000000_${nonce}`), { recursive: true });
    const cooked = await executeRecipe({ repoRoot: f.root, catalog: f.catalog, recipe: f.recipe, variant, executable: f.executable, env: f.env, now: new Date("2026-11-08T12:00:00.000Z"), nonce });
    assert.equal(cooked.status, "failed");
    assert.match(cooked.error, /already exists/);
    await rm(path.join(f.root, "dishes", dishIdFor(cooked.attemptId)), { recursive: true });
    return cooked;
  };
  const cooked = await blocked("recover");
  const recovered = await recoverAttempt({ repoRoot: f.root, catalog: f.catalog, attemptId: cooked.attemptId, env: f.env });
  assert.equal(recovered.status, "accepted");
  assert.equal(path.relative(f.root, recovered.dishDirectory).split(path.sep)[0], "dishes");
  const receipt = JSON.parse(await readFile(path.join(recovered.dishDirectory, "receipt.json"), "utf8"));
  assert.equal(receipt.isolation.evidence, "claude-code-init");
  const attemptDir = path.join(f.root, "private/runtime/attempts", cooked.attemptId);
  assert.deepEqual(JSON.parse(await readFile(path.join(attemptDir, "observed.json"), "utf8")).isolation, receipt.isolation);

  // A recorded init that lists one of his skills cannot be republished as clean.
  const tampered = await blocked("tampered");
  const tamperedDir = path.join(f.root, "private/runtime/attempts", tampered.attemptId);
  const events = path.join(tamperedDir, JSON.parse(await readFile(path.join(tamperedDir, "execution.json"), "utf8")).turns[0].eventsPath);
  const lines = (await readFile(events, "utf8")).trim().split("\n").map(JSON.parse);
  lines.find((event) => event.subtype === "init").skills.push("consult");
  await writeFile(events, `${lines.map((event) => JSON.stringify(event)).join("\n")}\n`);
  await assert.rejects(recoverAttempt({ repoRoot: f.root, catalog: f.catalog, attemptId: tampered.attemptId, env: f.env }), /skill consult outside Claude Code's bundled set/);
});

test("--publish-personal with a Claude Code snapshot survives recovery and publishes nothing private", async (t) => {
  const f = await runnerFixture();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  const variant = claudeVariant("snapshot");
  await mkdir(path.join(f.root, "dishes", `dish_${f.recipe.id}_${variant.id}_20261108120000000_published`), { recursive: true });
  const cooked = await executeRecipe({ repoRoot: f.root, catalog: f.catalog, recipe: f.recipe, variant, executable: f.executable, env: { ...f.env, FAKE_TOOL_EVENTS: path.join(f.env.TASTE_CLAUDE_PERSONAL_HOME, "CLAUDE.md") }, now: new Date("2026-11-08T12:00:00.000Z"), nonce: "published", publishPersonal: true });
  assert.equal(cooked.status, "failed");
  const attemptDir = path.join(f.root, "private/runtime/attempts", cooked.attemptId);
  assert.equal(JSON.parse(await readFile(path.join(attemptDir, "requested.json"), "utf8")).publishPersonal, true);
  await rm(path.join(f.root, "dishes", dishIdFor(cooked.attemptId)), { recursive: true });
  const recovered = await recoverAttempt({ repoRoot: f.root, catalog: f.catalog, attemptId: cooked.attemptId, env: f.env });
  assert.equal(recovered.status, "accepted");
  assert.equal(path.relative(f.root, recovered.dishDirectory).split(path.sep)[0], "dishes", "the Cook's choice to publish travels with the attempt");
  const receipt = JSON.parse(await readFile(path.join(recovered.dishDirectory, "receipt.json"), "utf8"));
  assert.equal(receipt.setup.environment, "snapshot");
  assert.equal(receipt.isolation, undefined, "a personal Dish makes no clean isolation claim");
  // Nothing under the published Dish names his home, the cook directory, or his setup's contents.
  const published = await listTree(recovered.dishDirectory);
  const text = (await Promise.all(published.map((file) => readFile(path.join(recovered.dishDirectory, file), "utf8")))).join("\n");
  for (const leak of [f.root, f.env.TASTE_CLAUDE_PERSONAL_HOME, "# Prime", "Lead with the recommendation", "Red, green, refactor"]) assert.equal(text.includes(leak), false, `published Dish leaks ${leak}`);
});

for (const [signal, code] of [["SIGTERM", 143], ["SIGHUP", 129]]) test(`a Kitchen process killed by ${signal} stops the harness, discards the copied setup, and leaves a terminal state`, async (t) => {
  const f = await runnerFixture();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  const hangFile = path.join(f.root, "hang.pid");
  const caseFile = path.join(f.root, "case.json");
  await writeFile(caseFile, JSON.stringify({ root: f.root, recipe: f.recipe, catalog: f.catalog, executable: f.executable, env: { ...f.env, FAKE_HANG: hangFile }, variant: claudeVariant("snapshot") }));
  const script = path.join(f.root, "interrupted-cook.mjs");
  await writeFile(script, `import { readFile } from "node:fs/promises";
import { executeRecipe } from ${JSON.stringify(path.resolve("lib/taste/runner.mjs"))};
const c = JSON.parse(await readFile(${JSON.stringify(caseFile)}, "utf8"));
await executeRecipe({ repoRoot: c.root, catalog: c.catalog, recipe: c.recipe, variant: c.variant, executable: c.executable, env: c.env, nonce: "killed" });
`);
  const runner = spawn(process.execPath, [script], { stdio: "ignore" });
  const exited = new Promise((resolve) => runner.once("exit", (code, signal) => resolve({ code, signal })));
  let harnessPid;
  for (let waited = 0; waited < 200 && harnessPid === undefined; waited += 1) {
    harnessPid = await readFile(hangFile, "utf8").then(Number, () => undefined);
    if (harnessPid === undefined) await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(harnessPid, "the stand-in harness started");
  runner.kill(signal);
  assert.deepEqual(await exited, { code, signal: null });
  assert.throws(() => process.kill(harnessPid, 0), /ESRCH/, "the harness did not outlive the Kitchen");
  const attemptDir = path.join(f.root, "private/runtime/attempts", (await readdir(path.join(f.root, "private/runtime/attempts")))[0]);
  const { cookDirectory } = JSON.parse(await readFile(path.join(attemptDir, "requested.json"), "utf8"));
  assert.equal(await pathExists(path.join(cookDirectory, "claude-home")), false, "the copied setup is gone");
  const state = JSON.parse(await readFile(path.join(attemptDir, "state.json"), "utf8"));
  assert.equal(state.status, "failed");
  assert.equal(state.stage, "interrupted");
});
