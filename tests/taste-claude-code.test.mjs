import assert from "node:assert/strict";
import { chmod, lstat, mkdtemp, mkdir, readFile, readdir, readlink, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { computeConfigHash, computeRecipeHash, sha256 } from "../lib/taste/catalog.mjs";
import {
  ancestorInstructionExcludes,
  buildClaudeTurnArgs,
  claudeChildEnv,
  parseClaudeJsonl,
  prepareClaudeAttempt,
  readClaudeAccessToken,
  runClaudeSession,
  verifyClaudeIdentity,
} from "../lib/taste/claude-code.mjs";
import { getHarnessAdapter, resolveHarnessAdapter } from "../lib/taste/harness-adapters.mjs";
import { executeRecipe } from "../lib/taste/runner.mjs";

const SESSION_ID = "6f1c2a8e-3b4d-4e5f-8a9b-0c1d2e3f4a5b";
const TOKEN = "sk-ant-oat01-fake-token-for-tests-only";

function profile(environment) {
  return {
    id: `claude-code-linux-host-${environment}-v1`, label: `via Claude Code · ${environment}`, runtime: "linux-host", sandbox: "disabled",
    approvalPolicy: "bypass-permissions", nativeWeb: "disabled", networkPolicy: "not-enforced", filesystemBoundary: "not-a-secrecy-boundary", environment,
  };
}

function claudeVariant(environment = "clean", overrides = {}) {
  const variant = {
    id: `claude-code-haiku-5-5-high-${environment}`, label: `Haiku 5.5 · High · via Claude Code · ${environment}`,
    provider: "anthropic", model: "claude-haiku-5-5", harness: "claude-code", reasoningEffort: "high", serviceTier: "default", personality: "default",
    capabilities: ["files", "shell"], executionProfile: profile(environment), ...overrides,
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
// told to drift, and records what it received without printing the token.
const FAKE_CLAUDE = `#!/usr/bin/env node
import { appendFileSync, readFileSync } from "node:fs";
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log(process.env.FAKE_VERSION || "2.1.312 (Claude Code)"); process.exit(0); }
let token = "";
try { token = readFileSync(Number(process.env.CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR), "utf8"); } catch {}
const inherited = Object.keys(process.env).filter((key) => /^(CLAUDECODE|CLAUDE_EFFORT|ANTHROPIC_)/.test(key));
appendFileSync(process.env.FAKE_LOG, JSON.stringify({ args, tokenMatches: token === process.env.FAKE_EXPECTED_TOKEN, configDir: process.env.CLAUDE_CONFIG_DIR, inherited }) + "\\n");
const resume = args.indexOf("--resume");
const session = resume >= 0 ? args[resume + 1] : process.env.FAKE_SESSION;
const requested = args[args.indexOf("--model") + 1];
const initModel = (resume >= 0 ? process.env.FAKE_RESUMED_MODEL : process.env.FAKE_FIRST_MODEL) || requested;
const prompt = args.at(-1);
const usageModels = { [requested]: { inputTokens: 5, outputTokens: 2 } };
if (process.env.FAKE_AUX_MODEL) usageModels[process.env.FAKE_AUX_MODEL] = { inputTokens: 1, outputTokens: 1 };
const emit = (event) => console.log(JSON.stringify(event));
emit({ type: "system", subtype: "init", session_id: session, model: initModel, claude_code_version: "2.1.312", output_style: process.env.FAKE_OUTPUT_STYLE || "default", tools: [], mcp_servers: [] });
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

test("clean and personal turn plans pin model, effort, isolation and exact resume", () => {
  const workspace = "/srv/kitchen/private/runtime/attempts/a/workspace";
  const clean = buildClaudeTurnArgs({ variant: claudeVariant("clean"), workspace, prompt: "-Cook" });
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

  const personal = buildClaudeTurnArgs({ variant: claudeVariant("personal"), workspace, workspaceRealPath: "/mnt/kitchen/private/runtime/attempts/a/workspace", prompt: "Correct", threadId: SESSION_ID });
  assert.equal(personal.includes("--safe-mode"), false);
  assert.equal(argAfter(personal, "--setting-sources"), "user");
  assert.equal(argAfter(personal, "--tools"), "Bash,Edit,Glob,Grep,Read,Write,Skill");
  assert.equal(argAfter(personal, "--resume"), SESSION_ID);
  const excludes = JSON.parse(argAfter(personal, "--settings")).claudeMdExcludes;
  for (const file of ["/srv/kitchen/AGENTS.md", "/srv/kitchen/CLAUDE.md", "/mnt/kitchen/AGENTS.md", "/AGENTS.md", "/srv/kitchen/.claude/**"]) assert.ok(excludes.includes(file), file);
  assert.equal(excludes.some((file) => file.startsWith(`${workspace}/`)), false, "the workspace itself is not excluded");

  assert.throws(() => buildClaudeTurnArgs({ variant: claudeVariant("clean"), workspace, prompt: "x", threadId: "latest" }), /exact UUID/);
  assert.throws(() => buildClaudeTurnArgs({ variant: claudeVariant("clean"), workspace: "relative", prompt: "x" }), /absolute path/);
  assert.throws(() => buildClaudeTurnArgs({ variant: claudeVariant("clean", { executionProfile: withoutEnvironment("clean") }), workspace, prompt: "x" }), /environment clean or personal/);
  assert.deepEqual(ancestorInstructionExcludes("/a/workspace"), ["/a/CLAUDE.md", "/a/CLAUDE.local.md", "/a/AGENTS.md", "/a/.claude/**", "/CLAUDE.md", "/CLAUDE.local.md", "/AGENTS.md", "/.claude/**"]);
});

test("the child environment drops a parent Claude session and points at the attempt home", () => {
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
  const personal = claudeChildEnv({ variant: claudeVariant("personal"), harnessHome: "/attempt/claude-home", base });
  assert.equal(personal.CLAUDE_CODE_DISABLE_CLAUDE_MDS, undefined, "personal keeps the mirrored user CLAUDE.md");
  assert.equal(personal.ENABLE_CLAUDEAI_MCP_SERVERS, "false");
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

test("the access token is read without quoting it and must outlive the run", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "taste-claude-token-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fresh = await credentials(root);
  assert.equal(await readClaudeAccessToken({ env: { TASTE_CLAUDE_CREDENTIALS_PATH: fresh } }), TOKEN);
  const expiring = await credentials(root, { expiresAt: Date.now() + 60_000 });
  await assert.rejects(readClaudeAccessToken({ env: { TASTE_CLAUDE_CREDENTIALS_PATH: expiring } }), (error) => /expires within 30 minutes/.test(error.message) && !error.message.includes(TOKEN));
  await assert.rejects(readClaudeAccessToken({ env: { TASTE_CLAUDE_CREDENTIALS_PATH: path.join(root, "missing.json") } }), /unavailable or unreadable/);
  const empty = path.join(root, "empty.json");
  await writeFile(empty, JSON.stringify({ mcpOAuth: {} }));
  await assert.rejects(readClaudeAccessToken({ env: { TASTE_CLAUDE_CREDENTIALS_PATH: empty } }), /lack a claude.ai OAuth access token/);
});

test("a clean attempt home starts empty; a personal one mirrors only the setup entries", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "taste-claude-home-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const env = { TASTE_CLAUDE_CREDENTIALS_PATH: await credentials(root), TASTE_CLAUDE_PERSONAL_HOME: path.join(root, "dot-claude") };
  await mkdir(path.join(root, "dot-claude", "skills", "tdd"), { recursive: true });
  await writeFile(path.join(root, "dot-claude", "CLAUDE.md"), "# Prime\n");
  await writeFile(path.join(root, "dot-claude", "settings.json"), "{\"model\":\"opus\"}\n");
  await writeFile(path.join(root, "dot-claude", ".credentials.json"), "{}\n");

  const cleanHome = path.join(root, "clean-home");
  await prepareClaudeAttempt({ variant: claudeVariant("clean"), harnessHome: cleanHome, env });
  assert.deepEqual(await readdir(cleanHome), [], "no credential file, settings or instructions");
  assert.equal((await lstat(cleanHome)).mode & 0o777, 0o700);

  const personalHome = path.join(root, "personal-home");
  await prepareClaudeAttempt({ variant: claudeVariant("personal"), harnessHome: personalHome, env });
  assert.deepEqual((await readdir(personalHome)).sort(), ["CLAUDE.md", "skills"]);
  assert.equal(await readlink(path.join(personalHome, "CLAUDE.md")), path.join(root, "dot-claude", "CLAUDE.md"));

  await assert.rejects(prepareClaudeAttempt({ variant: claudeVariant("clean"), harnessHome: personalHome, env }), /must start empty/);
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
    assert.deepEqual(call.inherited, []);
    assert.equal(call.args.some((arg) => arg.includes(TOKEN)), false);
  }
  assert.equal(JSON.stringify(result).includes(TOKEN), false, "the token never enters recorded evidence");

  const observed = await verifyClaudeIdentity({ variant, result, cliVersion: result.cliVersion });
  assert.equal(observed.model, "claude-haiku-5-5");
  assert.equal(observed.reasoningEffortEvidence, "pinned-argv");
  assert.equal(observed.observedServiceTier, "standard");
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
  assert.doesNotThrow(() => resolveHarnessAdapter(claudeVariant("personal", { reasoningEffort: "max" })));
  assert.throws(() => resolveHarnessAdapter(claudeVariant("clean", { model: "opus" })), /full claude-\* model id/);
  assert.throws(() => resolveHarnessAdapter(claudeVariant("clean", { provider: "openai" })), /provider anthropic/);
  assert.throws(() => resolveHarnessAdapter(claudeVariant("clean", { reasoningEffort: "adaptive" })), /effort must be one of/);
  assert.throws(() => resolveHarnessAdapter(claudeVariant("clean", { serviceTier: "fast" })), /default service tier/);
  assert.throws(() => resolveHarnessAdapter(claudeVariant("clean", { executionProfile: { ...profile("clean"), environment: "personal" } })), /environment must be clean/);
  assert.throws(() => resolveHarnessAdapter(claudeVariant("personal", { executionProfile: { ...profile("personal"), harnessProfile: "rose" } })), /named harness profile/);
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
  const personalHome = path.join(root, "dot-claude");
  await mkdir(path.join(personalHome, "skills"), { recursive: true });
  await writeFile(path.join(personalHome, "CLAUDE.md"), "# Prime\n");
  const env = {
    FAKE_LOG: path.join(root, "calls.jsonl"), FAKE_SESSION: SESSION_ID, FAKE_EXPECTED_TOKEN: TOKEN,
    TASTE_CLAUDE_CREDENTIALS_PATH: await credentials(root), TASTE_CLAUDE_PERSONAL_HOME: personalHome,
  };
  return { root, recipe, catalog: { catalogHash: `sha256:${"4".repeat(64)}`, recipes: [recipe] }, executable: await fakeClaude(root), env };
}

test("a personal Claude Code Dish lands in private/dishes and a clean one in dishes", async (t) => {
  const f = await runnerFixture();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  const cook = (environment, nonce) => executeRecipe({
    repoRoot: f.root, catalog: f.catalog, recipe: f.recipe, variant: claudeVariant(environment),
    executable: f.executable, env: f.env, now: new Date("2026-11-08T12:00:00.000Z"), nonce,
  });

  const clean = await cook("clean", "clean");
  assert.equal(clean.status, "accepted", clean.error);
  assert.equal(path.relative(f.root, clean.dishDirectory).split(path.sep)[0], "dishes");
  const dish = JSON.parse(await readFile(path.join(clean.dishDirectory, "dish.json"), "utf8"));
  assert.equal(dish.identity.harness, "claude-code");
  assert.equal(dish.identity.harnessVersion, "claude-code 2.1.312");
  assert.equal(dish.identity.observedModel, "claude-haiku-5-5");
  assert.equal(dish.identity.observedServiceTier, "standard");
  assert.equal(dish.visibility, undefined);
  const attemptDir = path.join(f.root, "private/runtime/attempts", clean.attemptId);
  assert.deepEqual((await readdir(path.join(attemptDir, "claude-home"))).filter((entry) => /credential/iu.test(entry)), []);
  const requested = JSON.parse(await readFile(path.join(attemptDir, "requested.json"), "utf8"));
  assert.equal(requested.execution.environment, "clean");
  assert.equal(requested.execution.setup, "none (safe mode)");
  assert.equal(requested.execution.mcpServers, "none");
  const execution = await readFile(path.join(attemptDir, "execution.json"), "utf8");
  assert.equal(execution.includes(TOKEN), false);

  const personal = await cook("personal", "personal");
  assert.equal(personal.status, "accepted", personal.error);
  assert.deepEqual(path.relative(f.root, personal.dishDirectory).split(path.sep).slice(0, 2), ["private", "dishes"]);
  assert.equal(JSON.parse(await readFile(path.join(personal.dishDirectory, "dish.json"), "utf8")).visibility, "private");
  const personalHome = path.join(f.root, "private/runtime/attempts", personal.attemptId, "claude-home");
  assert.deepEqual((await readdir(personalHome)).filter((entry) => ["CLAUDE.md", "skills"].includes(entry)).sort(), ["CLAUDE.md", "skills"]);
  assert.equal((await lstat(path.join(personalHome, "CLAUDE.md"))).isSymbolicLink(), true);
});
