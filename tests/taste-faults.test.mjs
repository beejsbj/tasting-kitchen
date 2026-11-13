import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { computeRecipeHash, hashCanonical, loadCatalog, resolveVariant, sha256 } from "../lib/taste/catalog.mjs";
import { CLAUDE_CODE_TOOLS, claudeChefFault } from "../lib/taste/claude-code.mjs";
import { CHEF_FAULTS, classifyFailure, KITCHEN_FAULTS, refusalIn } from "../lib/taste/faults.mjs";
import { ArtifactContractError, pathExists, selectArtifactFiles } from "../lib/taste/files.mjs";
import { coverage, cook } from "../lib/taste/index.mjs";
import { loadNoDishes, publishNoDish } from "../lib/taste/no-dishes.mjs";
import { loadVerdicts, writeVerdict } from "../lib/taste/verdicts.mjs";
import { recoverAttempt } from "../lib/taste/recovery.mjs";
import { buildRegistry, loadDishes } from "../lib/taste/registry.mjs";
import { budgetedFailure, executeRecipe } from "../lib/taste/runner.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");

// ---------------------------------------------------------------------------
// Classification: every failure path lands in exactly one class.

/** One row per failure path the runner and adapters produce, with the class and code it must land in. */
const FAILURE_PATHS = [
  // Kitchen: preparation and the cook directory
  { path: "cook directory not isolated", stage: "preparation", message: "Workspace is not isolated: /tmp/x/AGENTS.md", code: "preparation" },
  { path: "harness binary missing", stage: "execution", message: "claude was not found on PATH; set TASTE_CLAUDE_BINARY", code: "harness-changed" },
  // Kitchen: login and keys
  { path: "Claude Code login expiring", message: "Claude Code access token expires within 5 minutes; run any claude command to refresh the login, then cook", code: "auth" },
  { path: "Claude Code login missing", message: "Claude Code credentials lack a claude.ai OAuth access token; log in with claude first", code: "auth" },
  { path: "OpenRouter key absent", message: "Direct API needs OPENROUTER_API_KEY in the environment", code: "auth" },
  { path: "Codex auth absent", message: "Codex auth source is unavailable: /home/x/.codex/auth.json", code: "auth" },
  { path: "HTTP 401", message: "direct-api turn opening failed: Direct API returned HTTP 401", code: "auth" },
  // Kitchen: throttling
  { path: "HTTP 429", message: "direct-api turn opening failed: Direct API returned HTTP 429", code: "rate-limited" },
  // Kitchen: the account's allowance is spent; a retry before the reset cannot work
  { path: "usage limit", message: "codex-cli turn opening failed: You've hit your usage limit. Try again later", code: "usage-limit" },
  { path: "usage limit after a nonzero exit", message: "codex-cli turn opening failed: Codex exited with code 1: You've hit your usage limit. Upgrade to Pro or try again at Nov 21st, 2026.", kitchenFault: "usage-limit", code: "usage-limit" },
  { path: "free-tier throttling", message: "hermes turn opening failed: Hermes reported failure: free tier requests are throttled", code: "rate-limited" },
  // Kitchen: network, provider, time
  { path: "fetch failed", message: "direct-api turn opening failed: Direct API request to https://openrouter.ai/api/v1/chat/completions failed: fetch failed", code: "network" },
  { path: "connection reset", message: "cursor-agent turn opening failed: read ECONNRESET", code: "network" },
  { path: "HTTP 503", message: "direct-api turn opening failed: Direct API returned HTTP 503", code: "provider-unavailable" },
  { path: "overloaded", message: "claude-code turn opening failed: Claude Code reported failure: API Error: Overloaded", code: "provider-unavailable" },
  { path: "Direct API time limit", message: "direct-api turn opening failed: Direct API request to https://openrouter.ai/api/v1/chat/completions failed: no response within 600000 ms", code: "timeout" },
  // Kitchen: identity drift caused by the route
  { path: "Claude model mismatch", message: "claude-code turn opening failed: Effective Claude Code model mismatch: requested claude-opus-5-5, observed claude-sonnet-5-5", code: "identity-drift" },
  { path: "OpenRouter upstream drift", message: "direct-api turn opening failed: upstream pinned to Anthropic, served by Amazon Bedrock", code: "identity-drift" },
  { path: "Codex tier alias", message: "Effective Codex identity mismatch: tier requested fast, observed priority", code: "identity-drift" },
  // Kitchen: a changed CLI or protocol
  { path: "invalid JSONL", message: "claude-code turn opening failed: Invalid Claude Code JSONL on line 3: Unexpected token", code: "harness-changed" },
  { path: "duplicate init", message: "claude-code turn opening failed: Claude Code stream contained 2 init events; expected exactly one", code: "harness-changed" },
  { path: "no version", message: "claude --version did not report a version", code: "harness-changed" },
  { path: "nonzero exit", message: "codex-cli turn opening failed: Codex exited with code 1", code: "harness-changed" },
  // Kitchen: a clean Run's own record shows it loaded something of his (#45)
  { path: "Codex outside skill root", message: "A clean Codex run loaded a skill root outside the cook directory", code: "isolation" },
  { path: "Codex outside AGENTS.md", message: "A clean Codex run loaded AGENTS.md instructions no file in the cook directory accounts for", code: "isolation" },
  { path: "Claude non-built-in plugin", message: "A clean Claude Code session loaded plugin oauth-tools@market, which is not built in", code: "isolation" },
  { path: "Claude outside skill", message: "A clean Claude Code session loaded skill consult outside Claude Code's bundled set", code: "isolation" },
  { path: "missing turns", message: "Captured 1/2 scripted turns", code: "kitchen-error" },
  // Kitchen: validation and publication machinery
  { path: "check could not run", stage: "validation", message: "Required validation could not run: render", kitchenFault: "validator-error", code: "validator-error" },
  { path: "public scan", stage: "publication", message: "Public artifact scan failed: assistant response (absolute home path)", code: "publication" },
  { path: "web network scan", stage: "publication", message: "Web artifact has remote runtime references: index.html (https://cdn.example/app.js)", code: "publication" },
  { path: "Kitchen crash", stage: "publication", message: "Cannot read properties of undefined (reading 'turns')", code: "publication" },
  { path: "interrupted", stage: "interrupted", message: "Interrupted by SIGINT", code: "interrupted" },
  // Chef: only ever by structured tag
  { path: "required checks failed", stage: "validation", message: "Required validation failed: entry", chefFault: "checks-failed", code: "checks-failed", chef: true },
  { path: "artifact entry missing", stage: "validation", message: "Artifact entry is missing or excluded: index.html", chefFault: "output-contract", code: "output-contract", chef: true },
  { path: "artifact over limit", stage: "validation", message: "Artifact has 90 files; limit is 40", chefFault: "output-contract", code: "output-contract", chef: true },
  { path: "read-only fixture edited", stage: "validation", message: "Fixture brief changed during execution", chefFault: "output-contract", code: "output-contract", chef: true },
  { path: "skill files edited", stage: "validation", message: "Skill layer hand-drawn changed during execution", chefFault: "output-contract", code: "output-contract", chef: true },
  { path: "model refusal", message: "direct-api turn opening failed: Direct API response did not end normally (finish_reason refusal)", chefFault: "refused", code: "refused", chef: true },
  { path: "turn budget spent", message: "claude-code turn opening failed: Claude Code reported failure: error_max_turns", chefFault: "out-of-turns", code: "out-of-turns", chef: true },
];

test("every failure path lands in exactly one class, with a reason code and a plain sentence", () => {
  for (const row of FAILURE_PATHS) {
    const fault = classifyFailure({ stage: row.stage, message: row.message, chefFault: row.chefFault, kitchenFault: row.kitchenFault });
    assert.equal(fault.class, row.chef ? "chef" : "kitchen", row.path);
    assert.equal(fault.code, row.code, row.path);
    assert.equal(fault.retryable, !row.chef, row.path);
    assert.equal(fault.reason, (row.chef ? CHEF_FAULTS : KITCHEN_FAULTS)[row.code], row.path);
    assert.match(fault.reason, /^[A-Z].*\.$/u, `${row.path} has a plain sentence`);
  }
});

test("a provider limit carries the reset time the provider stated; no other fault does", () => {
  const message = "codex-cli turn opening failed: Codex exited with code 1: You've hit your usage limit. Try again at Nov 21st, 2026.";
  assert.deepEqual(classifyFailure({ message, kitchenFault: "usage-limit", resetsAt: "Nov 21st, 2026" }), {
    class: "kitchen", code: "usage-limit", stage: "execution", reason: KITCHEN_FAULTS["usage-limit"], retryable: true, resetsAt: "Nov 21st, 2026",
  });
  assert.equal(classifyFailure({ message: "Direct API returned HTTP 429", resetsAt: "in a minute" }).resetsAt, "in a minute", "a rate limit may state one too");
  // The classifier never reads a reset time out of a message, and keeps none it was not handed as text.
  assert.equal("resetsAt" in classifyFailure({ message }), false);
  for (const resetsAt of ["", null, 1795000000, { at: "Nov 21st" }]) assert.equal("resetsAt" in classifyFailure({ message, kitchenFault: "usage-limit", resetsAt }), false);
  // Without the tag the nonzero exit no longer hides the limit: the message alone names it.
  assert.equal(classifyFailure({ message }).code, "usage-limit");
  assert.equal(classifyFailure({ message: "Codex exited with code 1" }).code, "harness-changed");
  // Only a provider limit has a reset; a tag cannot hang one on another fault, a chef fault or an interruption.
  assert.equal("resetsAt" in classifyFailure({ message: "Codex exited with code 1", resetsAt: "Nov 21st, 2026" }), false);
  assert.equal("resetsAt" in classifyFailure({ message, kitchenFault: "timeout", resetsAt: "Nov 21st, 2026" }), false);
  assert.equal("resetsAt" in classifyFailure({ message, chefFault: "refused", resetsAt: "Nov 21st, 2026" }), false);
  assert.deepEqual(classifyFailure({ stage: "interrupted", message, kitchenFault: "usage-limit", resetsAt: "Nov 21st, 2026" }).code, "interrupted");
  assert.equal("resetsAt" in classifyFailure({ stage: "interrupted", message, kitchenFault: "usage-limit", resetsAt: "Nov 21st, 2026" }), false);
});

test("the runner keeps an adapter's usage limit and its reset time, even when the Recipe's clock also ran out", () => {
  const failure = { turnId: "opening", message: "Codex exited with code 1", kitchenFault: "usage-limit", resetsAt: "Nov 21st, 2026" };
  assert.deepEqual(budgetedFailure(failure, { harness: "codex-cli", budget: null, expired: false }), { kitchenFault: "usage-limit", resetsAt: "Nov 21st, 2026" });
  assert.deepEqual(budgetedFailure(failure, { harness: "codex-cli", budget: { seconds: 600 }, expired: true }), { kitchenFault: "usage-limit", resetsAt: "Nov 21st, 2026" });
  // An expired clock with no such evidence is still Kitchen's timeout.
  assert.equal(budgetedFailure({ turnId: "opening", message: "x" }, { harness: "codex-cli", budget: { seconds: 600 }, expired: true }).kitchenFault, "timeout");
});

test("a message never makes a chef fault: without a structured tag, every failure stays Kitchen's", () => {
  for (const row of FAILURE_PATHS) {
    assert.equal(classifyFailure({ stage: row.stage, message: row.message }).class, "kitchen", row.path);
  }
  // Even text that reads like the model's fault.
  for (const message of ["The model refused", "Required validation failed: entry", "error_max_turns", "the model ran out of time"]) {
    assert.equal(classifyFailure({ message }).class, "kitchen", message);
  }
  assert.equal(classifyFailure({ message: "x", chefFault: "lazy" }).class, "kitchen", "an unknown tag is Kitchen's");
  assert.equal(classifyFailure({ stage: "interrupted", message: "x", chefFault: "checks-failed" }).class, "kitchen", "an interrupted Run is never the model's");
});

test("refusal is read only from structured evidence, never from prose", () => {
  assert.equal(refusalIn([{ type: "assistant", message: { stop_reason: "refusal", content: [] } }]), true);
  assert.equal(refusalIn([{ type: "response", status: 200, body: { choices: [{ finish_reason: "stop", message: { content: "", refusal: "I can't help with that." } }] } }]), true);
  assert.equal(refusalIn([{ type: "response", status: 200, body: { choices: [{ finish_reason: "refusal", message: { content: "" } }] } }]), true);
  assert.equal(refusalIn([{ type: "assistant", message: { stop_reason: "end_turn", content: [{ type: "text", text: "I won't do that." }] } }]), false);
  assert.equal(refusalIn([{ type: "response", status: 200, body: { choices: [{ finish_reason: "content_filter", message: { content: "" } }] } }]), false, "a route's content filter is not the model's refusal");
});

test("Claude Code tags only an exhausted turn budget or a structured refusal, and only for a stream that proves the requested Run", () => {
  const jsonl = (...events) => events.map((event) => JSON.stringify(event)).join("\n");
  const model = "claude-opus-5-5";
  const variant = { model, personality: "default", serviceTier: "default", executionProfile: { environment: "clean" } };
  const sessionId = "11111111-1111-4111-8111-111111111111";
  const init = { type: "system", subtype: "init", model, permissionMode: "bypassPermissions", cwd: "/attempt/workspace", tools: [...CLAUDE_CODE_TOOLS], mcp_servers: [], session_id: sessionId, claude_code_version: "2.1.312", output_style: "default", plugins: [], skills: ["simplify"], agents: ["general-purpose"] };
  // Kitchen pinned the Recipe's turn budget, so spending it can be the model's (taste-budget covers the unpinned case).
  const options = { variant, workspaces: ["/attempt/workspace"], cliVersion: "claude-code 2.1.312", turnBudget: 40 };
  const turn = (message) => ({ type: "assistant", message: { model, ...message } });
  const spent = { type: "result", subtype: "error_max_turns", is_error: true };
  assert.equal(claudeChefFault(jsonl(init, spent), options), "out-of-turns");
  assert.equal(claudeChefFault(jsonl(init, turn({ stop_reason: "refusal" }), { type: "result", subtype: "success" }), options), "refused");
  assert.equal(claudeChefFault(jsonl(init, { type: "result", subtype: "error_during_execution", is_error: true }), options), undefined);
  assert.equal(claudeChefFault("not json", options), undefined);
  assert.equal(claudeChefFault(undefined, options), undefined);
  // Without the requested model's own init, or with another model speaking, the fault is not the requested model's.
  assert.equal(claudeChefFault(jsonl(spent), options), undefined, "no init");
  assert.equal(claudeChefFault(jsonl(init, init, spent), options), undefined, "two inits");
  assert.equal(claudeChefFault(jsonl({ ...init, model: "claude-sonnet-5-5" }, spent), options), undefined, "another model's init");
  assert.equal(claudeChefFault(jsonl(init, { ...turn({ stop_reason: "refusal" }), message: { model: "claude-sonnet-5-5", stop_reason: "refusal" } }), options), undefined, "another model's refusal");
  assert.equal(claudeChefFault(jsonl(init, turn({}), { ...turn({ stop_reason: "refusal" }), parent_tool_use_id: "toolu_1", message: { model: "claude-haiku-5-5", stop_reason: "refusal" } }), options), undefined, "a subagent's refusal");
  assert.equal(claudeChefFault(jsonl(init, spent), { workspaces: options.workspaces, cliVersion: options.cliVersion }), undefined, "no requested model to pin it on");
  // The environment checks a successful turn gets apply to a failed one too: a drifted setup is Kitchen's.
  assert.equal(claudeChefFault(jsonl({ ...init, permissionMode: "default" }, spent), options), undefined, "permission mode drifted");
  assert.equal(claudeChefFault(jsonl({ ...init, cwd: "/home/someone" }, spent), options), undefined, "ran outside the attempt workspace");
  assert.equal(claudeChefFault(jsonl({ ...init, tools: [...CLAUDE_CODE_TOOLS, "mcp__linear__x"], mcp_servers: [{ name: "linear", status: "connected" }] }, spent), options), undefined, "connections loaded while off");
  assert.equal(claudeChefFault(jsonl({ ...init, tools: ["Bash"] }, spent), options), undefined, "tool list drifted");
  assert.equal(claudeChefFault(jsonl(init, spent), { ...options, threadId: sessionId }), "out-of-turns", "a resume that kept its session");
  assert.equal(claudeChefFault(jsonl(init, spent), { ...options, threadId: "22222222-2222-4222-8222-222222222222" }), undefined, "a resume that silently started a new session");
  // The metadata a successful turn is held to holds for a failed one too (the #51 leftover).
  assert.equal(claudeChefFault(jsonl(init, spent), { ...options, cliVersion: "claude-code 2.2.0" }), undefined, "the CLI changed under the run");
  assert.equal(claudeChefFault(jsonl(init, spent), { variant, workspaces: options.workspaces }), undefined, "no CLI version to hold the stream to");
  assert.equal(claudeChefFault(jsonl(init, { ...spent, usage: { service_tier: "priority" } }), options), undefined, "another service tier served it");
  assert.equal(claudeChefFault(jsonl(init, { ...spent, usage: { service_tier: "standard" } }), options), "out-of-turns", "the default tier reports as standard");
  assert.equal(claudeChefFault(jsonl({ ...init, output_style: "Explanatory" }, spent), options), undefined, "an output style other than the requested one");
  // And so does the clean isolation check: a session that loaded his plugin or skill proves nothing about the model.
  assert.equal(claudeChefFault(jsonl({ ...init, plugins: [{ name: "github", path: "/x", source: "github@official" }] }, spent), options), undefined, "a plugin that is not built in");
  assert.equal(claudeChefFault(jsonl({ ...init, skills: ["consult"] }, spent), options), undefined, "a skill outside the bundled set");
});

// ---------------------------------------------------------------------------
// The runner: chef faults publish a No Dish; Kitchen faults stay private.

async function runnerFixture({ checks } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "taste-faults-"));
  const recipeDir = path.join(root, "catalog/recipes/conversation/demo");
  await mkdir(path.join(recipeDir, "fixtures"), { recursive: true });
  await writeFile(path.join(recipeDir, "fixtures/context.txt"), "public context\n");
  const authPath = path.join(root, "source-auth.json");
  await writeFile(authPath, "{}\n", { mode: 0o600 });
  const recipe = {
    schemaVersion: 1, id: "demo-session", version: "1.0.0", status: "ready", title: "A demo session recipe", summary: "A sufficiently detailed demo for fault testing.",
    domain: "conversation", origin: "textbook", originNote: "A conventional runner integration test.", tags: ["presence"], kind: "session",
    harness: { workspace: "read", web: "disabled", capabilities: [] },
    setup: { instructions: "Read the mounted public context.", fixtures: [{ id: "context", path: "fixtures/context.txt", mountAs: "inputs/context.txt", public: true, mediaType: "text/plain" }] },
    turns: [{ id: "opening", role: "prompt", content: "Respond once." }, { id: "correction", role: "correction", content: "Now respond more directly." }],
    output: { kind: "session", entry: "output/session.json", include: ["output/session.json"], limits: { maxFiles: 2, maxBytes: 32768 } },
    validation: { mode: "completeness", checks: checks ?? [{ id: "entry", type: "file-exists", required: true, description: "The transcript exists.", target: "output/session.json" }] },
    sourcePath: "catalog/recipes/conversation/demo/recipe.json",
    fixtureHashes: { context: sha256("public context\n") },
  };
  recipe.recipeHash = computeRecipeHash(recipe, recipe.fixtureHashes);
  const variant = {
    id: "codex-sol-high", label: "Sol high", provider: "openai", model: "gpt-5.6-sol", harness: "codex-cli", reasoningEffort: "high", serviceTier: "default", personality: "none", capabilities: ["files", "shell"],
    executionProfile: { id: "codex-linux-host-unsandboxed-v1", label: "via Codex CLI · host-unsandboxed fallback", runtime: "linux-host", sandbox: "danger-full-access", approvalPolicy: "never", nativeWeb: "disabled", networkPolicy: "not-enforced", filesystemBoundary: "not-a-secrecy-boundary" },
    configHash: `sha256:${"3".repeat(64)}`,
  };
  return { root, recipe, variant, catalog: { catalogHash: `sha256:${"4".repeat(64)}`, recipes: [recipe] }, authPath };
}

const session = ({ failure = null, turns } = {}) => ({
  threadId: "01901234-5678-7abc-8def-0123456789ab", cliVersion: "codex-cli 9.9.9-fake", failure,
  turns: turns ?? [
    { finalMessage: "First answer.", usage: null, events: [] },
    { finalMessage: "More direct answer.", usage: null, events: [] },
  ],
});
const observed = async () => ({ model: "gpt-5.6-sol", provider: "openai", reasoningEffort: "high", serviceTier: "default", verifiedBy: "test" });

async function cookWith(f, t, { runSession, verifyIdentity = observed, nonce = "fixed" }) {
  t.after(() => rm(f.root, { recursive: true, force: true }));
  return executeRecipe({ repoRoot: f.root, catalog: f.catalog, recipe: f.recipe, variant: f.variant, now: new Date("2026-08-14T12:00:00.000Z"), nonce, authPath: f.authPath, runSession, verifyIdentity });
}

const state = async (result) => JSON.parse(await readFile(path.join(result.attemptDir, "state.json"), "utf8"));

test("failed required checks publish an immutable No Dish with its receipt, partial trace and plain reason", async (t) => {
  const f = await runnerFixture({ checks: [{ id: "entry", type: "file-exists", required: true, description: "The model wrote its notes.", target: "output/notes.md" }] });
  const result = await cookWith(f, t, { runSession: async () => session() });
  assert.equal(result.status, "failed");
  assert.deepEqual({ class: result.fault.class, code: result.fault.code, stage: result.fault.stage }, { class: "chef", code: "checks-failed", stage: "validation" });
  const recorded = await state(result);
  assert.equal(recorded.noDishId, result.noDishId);
  assert.equal(recorded.fault.class, "chef");
  const directory = path.join(f.root, "no-dishes", result.noDishId);
  const manifest = JSON.parse(await readFile(path.join(directory, "no-dish.json"), "utf8"));
  assert.equal(manifest.outcome, "no-dish");
  assert.equal(manifest.recipe.hash, f.recipe.recipeHash);
  assert.equal(manifest.identity.configHash, f.variant.configHash);
  assert.equal(manifest.identity.observedModel, "gpt-5.6-sol");
  assert.deepEqual(manifest.fault, { class: "chef", code: "checks-failed", stage: "validation", reason: CHEF_FAULTS["checks-failed"], checks: ["entry"] });
  const { noDishHash, ...withoutHash } = manifest;
  assert.equal(noDishHash, hashCanonical(withoutHash));
  const validation = JSON.parse(await readFile(path.join(directory, "validation.json"), "utf8"));
  assert.equal(validation.passed, false);
  assert.equal(validation.checks[0].passed, false);
  const trace = JSON.parse(await readFile(path.join(directory, "trace.json"), "utf8"));
  assert.equal(trace.partial, true);
  assert.deepEqual(trace.turns.map((turn) => turn.response), ["First answer.", "More direct answer."]);
  assert.ok(await pathExists(path.join(directory, "receipt.json")));
  assert.ok(await pathExists(path.join(directory, "inputs/inputs/context.txt")));
  assert.equal(await pathExists(path.join(f.root, "dishes")), false, "no Dish is ever made from a chef fault");
  // Raw evidence never travels with the plate.
  assert.deepEqual((await readdir(directory)).sort(), ["inputs", "inputs.json", "no-dish.json", "receipt.json", "trace.json", "validation.json"]);
});

test("a structured refusal is a chef fault published at the execution stage, with the trace up to the failure", async (t) => {
  const f = await runnerFixture();
  const result = await cookWith(f, t, {
    runSession: async () => session({
      failure: { turnId: "correction", message: "Direct API response did not end normally (finish_reason refusal)", exitCode: null, signal: null, chefFault: "refused" },
      turns: [{ finalMessage: "First answer.", usage: null, events: [] }, { finalMessage: null, usage: null, events: [] }],
    }),
  });
  assert.equal(result.fault.code, "refused");
  const manifest = JSON.parse(await readFile(path.join(f.root, "no-dishes", result.noDishId, "no-dish.json"), "utf8"));
  assert.deepEqual({ stage: manifest.fault.stage, turn: manifest.fault.turn }, { stage: "execution", turn: "correction" });
  assert.equal(manifest.validation, null);
  const trace = JSON.parse(await readFile(path.join(f.root, "no-dishes", result.noDishId, "trace.json"), "utf8"));
  assert.deepEqual(trace.turns.map((turn) => [turn.id, turn.response]), [["opening", "First answer."], ["correction", null]]);
});

test("a validation failure whose turns carry a structured refusal is recorded as declined", async (t) => {
  const f = await runnerFixture({ checks: [{ id: "notes", type: "file-exists", required: true, description: "Notes exist.", target: "output/notes.md" }] });
  const result = await cookWith(f, t, {
    runSession: async () => session({ turns: [
      { finalMessage: "I can't.", usage: null, events: [{ type: "assistant", message: { stop_reason: "refusal" } }] },
      { finalMessage: "Still no.", usage: null, events: [] },
    ] }),
  });
  assert.equal(result.fault.code, "refused");
});

test("Kitchen faults stay private and retryable: no No Dish, no Dish", async (t) => {
  const kitchenRuns = {
    "rate limited": { runSession: async () => session({ failure: { turnId: "opening", message: "Direct API returned HTTP 429", exitCode: null, signal: null }, turns: [{ finalMessage: null, usage: null, events: [] }] }), code: "rate-limited" },
    "usage limit": { runSession: async () => session({ failure: { turnId: "opening", message: "Codex exited with code 1: You've hit your usage limit. Try again at Nov 21st, 2026.", exitCode: 1, signal: null, kitchenFault: "usage-limit", resetsAt: "Nov 21st, 2026" }, turns: [{ finalMessage: null, usage: null, events: [] }] }), code: "usage-limit", resetsAt: "Nov 21st, 2026" },
    "login expired": { runSession: async () => { throw new Error("Claude Code access token expires within 5 minutes; run any claude command to refresh the login, then cook"); }, code: "auth" },
    "identity drift": { runSession: async () => session(), verifyIdentity: async () => { throw new Error("Effective Codex identity mismatch: requested gpt-5.6-sol, observed gpt-5.6-luna"); }, code: "identity-drift" },
    "Kitchen crash": { runSession: async () => ({ ...session(), turns: undefined }), code: "kitchen-error" },
    // A refusal tag on a turn the route served wrongly is still dropped by the adapter; here no tag means Kitchen.
    "untagged turn failure": { runSession: async () => session({ failure: { turnId: "opening", message: "The model refused", exitCode: 1, signal: null }, turns: [{ finalMessage: null, usage: null, events: [] }] }), code: "kitchen-error" },
  };
  for (const [label, run] of Object.entries(kitchenRuns)) {
    const f = await runnerFixture();
    const result = await cookWith(f, t, { runSession: run.runSession, verifyIdentity: run.verifyIdentity });
    assert.equal(result.status, "failed", label);
    assert.equal(result.fault.class, "kitchen", label);
    assert.equal(result.fault.code, run.code, label);
    assert.equal(result.fault.retryable, true, label);
    assert.equal(result.noDishId, undefined, label);
    assert.equal((await state(result)).fault.class, "kitchen", label);
    assert.equal(result.fault.resetsAt, run.resetsAt, label);
    assert.equal((await state(result)).fault.resetsAt, run.resetsAt, label);
    assert.equal(await pathExists(path.join(f.root, "no-dishes")), false, label);
  }
});

test("a required check that could not run is Kitchen's, not the model's", async (t) => {
  const f = await runnerFixture({ checks: [{ id: "schema", type: "json-schema", required: true, description: "Matches the schema.", target: "output/session.json" }] });
  const result = await cookWith(f, t, { runSession: async () => session() });
  assert.deepEqual({ class: result.fault.class, code: result.fault.code }, { class: "kitchen", code: "validator-error" });
  assert.equal(await pathExists(path.join(f.root, "no-dishes")), false);
});

// ---------------------------------------------------------------------------
// Recovery: a Kitchen fault may become a retry; a chef fault never becomes a Dish.

async function attempt(root, attemptId, stateValue) {
  const attemptDir = path.join(root, "private/runtime/attempts", attemptId);
  await mkdir(attemptDir, { recursive: true });
  await writeFile(path.join(attemptDir, "requested.json"), JSON.stringify({ attemptId, recipe: { id: "x" } }));
  await writeFile(path.join(attemptDir, "execution.json"), JSON.stringify({ failure: null, turns: [] }));
  await writeFile(path.join(attemptDir, "state.json"), JSON.stringify(stateValue));
  return attemptDir;
}

test("recovery refuses every chef fault and points a Kitchen fault at fill-missing", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "taste-faults-recovery-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const catalog = { recipes: [] };
  // Even a chef fault recorded at the publication stage, which recovery otherwise republishes.
  await attempt(root, "attempt_a_chef", { status: "failed", stage: "publication", message: "Artifact has 90 files; limit is 40", fault: classifyFailure({ stage: "publication", chefFault: "output-contract" }) });
  await assert.rejects(recoverAttempt({ repoRoot: root, catalog, attemptId: "attempt_a_chef" }), /chef fault \(output-contract\); recovery never turns a chef fault into a Dish/);
  await attempt(root, "attempt_a_plated", { status: "failed", stage: "publication", message: "legacy state without a fault" });
  await mkdir(path.join(root, "no-dishes", "nodish_a_plated"), { recursive: true });
  await assert.rejects(recoverAttempt({ repoRoot: root, catalog, attemptId: "attempt_a_plated" }), /never turns a chef fault into a Dish/);
  await attempt(root, "attempt_a_kitchen", { status: "failed", stage: "execution", message: "HTTP 429", fault: classifyFailure({ message: "HTTP 429" }) });
  await assert.rejects(recoverAttempt({ repoRoot: root, catalog, attemptId: "attempt_a_kitchen" }), /kitchen fault \(rate-limited\).*--intent fill-missing/);
  // A Kitchen publication failure keeps its existing recovery path (it reaches the recipe lookup).
  await attempt(root, "attempt_a_publication", { status: "failed", stage: "publication", message: "Public artifact scan failed", fault: classifyFailure({ stage: "publication", message: "Public artifact scan failed" }) });
  await assert.rejects(recoverAttempt({ repoRoot: root, catalog, attemptId: "attempt_a_publication" }), /unknown recipe/);
});

// ---------------------------------------------------------------------------
// Coverage and fill-missing: a No Dish covers its cell; Repeat cooks it again.

async function repoWithNoDish(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "taste-faults-repo-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(path.join(repoRoot, "catalog"), path.join(root, "catalog"), { recursive: true });
  await cp(path.join(repoRoot, "dishes"), path.join(root, "dishes"), { recursive: true });
  const catalog = await loadCatalog(root);
  const dishes = await loadDishes(root);
  const variant = resolveVariant(catalog, "codex-sol-high");
  // A ready public Recipe codex-sol-high has not cooked at its current hash.
  const recipe = catalog.recipes.find((candidate) => candidate.status === "ready" && candidate.visibility !== "private" && candidate.kind === "session"
    && dishes.some((dish) => dish.recipe.id === candidate.id)
    && !dishes.some((dish) => dish.recipe.id === candidate.id && dish.identity.configHash === variant.configHash));
  assert.ok(recipe, "a cooked session Recipe without a codex-sol-high Dish exists");
  const attemptId = `attempt_${recipe.id}_codex-sol-high_20261109000000000_fixture`;
  const attemptDir = path.join(root, "private/runtime/attempts", attemptId);
  await mkdir(attemptDir, { recursive: true });
  const published = await publishNoDish({
    repoRoot: root, catalog, recipe, variant, attemptId, attemptDir, workspace: path.join(attemptDir, "absent-workspace"),
    result: { cliVersion: "codex-cli 9.9.9-fake", failure: { turnId: recipe.turns[0].id }, turns: [{ finalMessage: null }] },
    fault: classifyFailure({ chefFault: "refused" }), executedAt: "2026-11-09T00:00:00.000Z",
  });
  return { root, catalog, recipe, variant, noDishId: published.noDishId };
}

test("a No Dish counts as coverage: fill-missing skips its cell, Repeat cooks it again", async (t) => {
  const { root, recipe, noDishId } = await repoWithNoDish(t);
  assert.deepEqual((await loadNoDishes(root)).map((plate) => plate.id), [noDishId]);
  const fill = await cook(root, { configurationId: "codex-sol-high", recipeIds: [recipe.id], intent: "fill-missing" });
  assert.deepEqual(fill.skipped.map((item) => item.recipeId), [recipe.id]);
  assert.deepEqual(fill.planned, []);
  const repeat = await cook(root, { configurationId: "codex-sol-high", recipeIds: [recipe.id], intent: "repeat" });
  assert.deepEqual(repeat.planned.map((item) => item.recipeId), [recipe.id]);
});

test("Menu coverage counts a No Dish as a represented cell", () => {
  const recipes = [{ id: "a", recipeHash: "h-a" }, { id: "b", recipeHash: "h-b" }];
  const plates = [
    { id: "dish_a", recipe: { id: "a", hash: "h-a" }, identity: { configHash: "c" } },
    { id: "nodish_b", outcome: "no-dish", recipe: { id: "b", hash: "h-b" }, identity: { configHash: "c" } },
  ];
  const result = coverage({ recipes: ["a", "b"] }, recipes, plates, ["c"]);
  assert.equal(result.numerator, 2);
  assert.deepEqual(result.cells.map((cell) => cell.dishes.map((plate) => plate.id)), [["dish_a"], ["nodish_b"]]);
});

test("the registry publishes No Dishes beside Dishes, under the sandboxed dishes/ tree", async (t) => {
  const { root, recipe, noDishId } = await repoWithNoDish(t);
  const { registry } = await buildRegistry({ repoRoot: root });
  const [plate] = registry.noDishes;
  assert.equal(plate.id, noDishId);
  assert.equal(plate.recipe.id, recipe.id);
  assert.equal(plate.fault.class, "chef");
  assert.match(plate.artifactBase, /\/dishes\/nodish_/u);
  assert.ok(await pathExists(path.join(root, "public/dishes", noDishId, "no-dish.json")));
  assert.equal(registry.dishes.some((dish) => dish.id === noDishId), false, "a No Dish is never listed as a Dish");
});

test("the No Dish loader refuses a Kitchen fault, a tampered manifest and a private plate in the public tree", async (t) => {
  const { root, noDishId } = await repoWithNoDish(t);
  const file = path.join(root, "no-dishes", noDishId, "no-dish.json");
  const original = JSON.parse(await readFile(file, "utf8"));
  const rehash = (value) => { const rest = { ...value }; delete rest.noDishHash; return { ...rest, noDishHash: hashCanonical(rest) }; };
  await writeFile(file, JSON.stringify(rehash({ ...original, fault: { ...original.fault, class: "kitchen", code: "rate-limited" } })));
  await assert.rejects(loadNoDishes(root), /only a chef fault may be a No Dish/);
  await writeFile(file, JSON.stringify({ ...original, executedAt: "2026-11-10T00:00:00.000Z" }));
  await assert.rejects(loadNoDishes(root), /noDishHash does not match/);
  await writeFile(file, JSON.stringify(rehash({ ...original, fault: { ...original.fault, reason: "/home/someone leaked in a message" } })));
  await assert.rejects(loadNoDishes(root), /fixed reason for its code/);
  await writeFile(file, JSON.stringify(rehash({ ...original, visibility: "private" })));
  await assert.rejects(loadNoDishes(root), /private No Dish is stored in the public tree/);
  for (const executedAt of ["Nov 9 2026", "2026-11-09T10:00:00+02:00", 5, null]) {
    await writeFile(file, JSON.stringify(rehash({ ...original, executedAt })));
    await assert.rejects(loadNoDishes(root), /executedAt must be a UTC ISO date-time/);
  }
  await writeFile(file, JSON.stringify(original));
  assert.equal((await loadNoDishes(root)).length, 1);
});

test("Burooj can pass a No Dish the checks got wrong; a fail has nothing to attach to and a stale hash breaks the build", async (t) => {
  const { root, recipe, noDishId } = await repoWithNoDish(t);
  const manifestBefore = await readFile(path.join(root, "no-dishes", noDishId, "no-dish.json"), "utf8");
  await assert.rejects(writeVerdict(root, { plateId: noDishId, verdict: "failed", note: "x" }), /a No Dish takes only a pass/);
  const { verdict, path: relative } = await writeVerdict(root, { plateId: noDishId, verdict: "passed", note: "The checks were wrong: it holds up.", now: new Date("2026-11-09T10:00:00.000Z") });
  const [plate] = await loadNoDishes(root);
  assert.equal(verdict.plateId, noDishId);
  assert.equal(verdict.plateHash, plate.noDishHash);
  assert.equal(relative, `verdicts/${verdict.id}.json`);
  assert.equal(await readFile(path.join(root, "no-dishes", noDishId, "no-dish.json"), "utf8"), manifestBefore, "no-dish.json is untouched");
  assert.deepEqual((await loadVerdicts(root, { plates: [plate] })).map((item) => item.id), [verdict.id]);
  const { registry } = await buildRegistry({ repoRoot: root });
  assert.deepEqual(registry.verdicts.map((item) => item.plateId), [noDishId]);
  assert.equal(registry.noDishes[0].recipe.id, recipe.id);
  // A hand-written fail, or a pin to another hash, is refused at the build.
  await writeFile(path.join(root, relative), JSON.stringify({ ...verdict, verdict: "failed" }));
  await assert.rejects(buildRegistry({ repoRoot: root }), /a No Dish takes only a pass/);
  await writeFile(path.join(root, relative), JSON.stringify({ ...verdict, plateHash: `sha256:${"0".repeat(64)}` }));
  await assert.rejects(buildRegistry({ repoRoot: root }), /immutable hash/);
});

test("publishNoDish refuses a kitchen fault and a chef fault at a stage a No Dish cannot record", async (t) => {
  const { root, catalog, recipe, variant } = await repoWithNoDish(t);
  const attemptId = `attempt_${recipe.id}_codex-sol-high_20261109010000000_refused`;
  const attemptDir = path.join(root, "private/runtime/attempts", attemptId);
  const base = { repoRoot: root, catalog, recipe, variant, attemptId, attemptDir, workspace: path.join(attemptDir, "absent"), executedAt: "2026-11-09T01:00:00.000Z" };
  await assert.rejects(publishNoDish({ ...base, fault: classifyFailure({ message: "HTTP 429" }) }), /Only a chef fault becomes a No Dish/);
  await assert.rejects(publishNoDish({ ...base, fault: classifyFailure({ stage: "publication", chefFault: "output-contract" }) }), /execution or validation fault, not publication/);
  assert.equal((await loadNoDishes(root)).length, 1, "nothing new was published");
});

test("only a broken output contract is the model's; a symlink or filesystem error while selecting files is Kitchen's", async (t) => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "taste-select-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const output = { entry: "out/index.html", include: ["out/**"], limits: { maxFiles: 1, maxBytes: 10 } };
  await assert.rejects(selectArtifactFiles(workspace, output), (error) => error instanceof ArtifactContractError && /entry is missing/.test(error.message));
  await mkdir(path.join(workspace, "out"));
  await writeFile(path.join(workspace, "out/index.html"), "<p>hi</p>");
  await writeFile(path.join(workspace, "out/extra.html"), "x");
  await assert.rejects(selectArtifactFiles(workspace, output), (error) => error instanceof ArtifactContractError && /limit is 1/.test(error.message));
  await rm(path.join(workspace, "out/extra.html"));
  await writeFile(path.join(workspace, "out/index.html"), "<p>this is too many bytes</p>");
  await assert.rejects(selectArtifactFiles(workspace, output), (error) => error instanceof ArtifactContractError && /bytes; limit is 10/.test(error.message));
  // Equipment the delivery never includes (an npm install's .bin links, a mounted engine's dependencies) is not walked.
  await writeFile(path.join(workspace, "out/index.html"), "<p>hi</p>");
  await mkdir(path.join(workspace, "node_modules/.bin"), { recursive: true });
  await symlink("../pkg/cli.js", path.join(workspace, "node_modules/.bin/tool"));
  assert.deepEqual((await selectArtifactFiles(workspace, output)).files, ["out/index.html"]);
  // A symlink inside what the Recipe delivers is not the model breaking the contract either: Kitchen refuses it as its own fault.
  await symlink("index.html", path.join(workspace, "out/alias.html"));
  await assert.rejects(selectArtifactFiles(workspace, output), (error) => !(error instanceof ArtifactContractError));
});
