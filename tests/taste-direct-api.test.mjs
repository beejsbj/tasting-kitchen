import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { computeRecipeHash, planSelection } from "../lib/taste/catalog.mjs";
import {
  buildDirectApiRequest, directApiModelsEquivalent, directApiReply, parseDirectApiJsonl, prepareDirectApiAttempt, runDirectApiSession, verifyDirectApiIdentity,
} from "../lib/taste/direct-api.mjs";
import { compatibilityFor, resolveHarnessAdapter, skillDeliverySupport } from "../lib/taste/harness-adapters.mjs";
import { executeRecipe } from "../lib/taste/runner.mjs";

const KEY = "sk-or-test-key-never-on-disk";
const profile = {
  id: "direct-api-openrouter-v1", label: "Direct API · OpenRouter route · no harness", runtime: "linux-host", sandbox: "no-tools", approvalPolicy: "no-tools",
  nativeWeb: "disabled", networkPolicy: "no-tools", filesystemBoundary: "no-workspace", environment: "clean", route: "openrouter", upstream: "anthropic",
};
const direct = {
  id: "direct-api-opus-5-5-high", label: "Opus 5.5 · High · Direct API (OpenRouter)", provider: "anthropic", model: "anthropic/claude-opus-5.5",
  harness: "direct-api", reasoningEffort: "high", serviceTier: "default", personality: "none", capabilities: [], executionProfile: profile,
  configHash: `sha256:${"5".repeat(64)}`,
};
const recipe = { setup: { instructions: "Respond in this fresh conversation." }, turns: [{ id: "respond", content: "Read the entry." }, { id: "follow", content: "Now say it plainer." }] };

/** A fake chat-completions endpoint. `reply` shapes each response from the request. */
async function fakeServer(t, reply = (body, index) => ({ status: 200, body: { id: `gen-${index}`, model: body.model, provider: "Anthropic", choices: [{ finish_reason: "stop", message: { role: "assistant", content: `reply ${index + 1} to ${body.messages.at(-1).content}` } }], usage: { prompt_tokens: 5, completion_tokens: 3 } } })) {
  const requests = [];
  const server = createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk) => { raw += chunk; });
    request.on("end", () => {
      const body = JSON.parse(raw);
      requests.push({ url: request.url, authorization: request.headers.authorization, body });
      const { status, body: out } = reply(body, requests.length - 1);
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(out));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { endpoint: `http://127.0.0.1:${server.address().port}/api/v1/chat/completions`, requests };
}

async function scratch(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "taste-direct-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function filesUnder(root) {
  const out = [];
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) if (entry.isFile()) out.push(path.join(entry.parentPath, entry.name));
  return out;
}

test("Direct API configurations carry no capabilities, the OpenRouter route, and the maker as provider", () => {
  assert.doesNotThrow(() => resolveHarnessAdapter(direct));
  assert.throws(() => resolveHarnessAdapter({ ...direct, capabilities: ["files", "shell"] }), /declares no capabilities/);
  assert.throws(() => resolveHarnessAdapter({ ...direct, provider: "openrouter" }), /maker anthropic/);
  assert.throws(() => resolveHarnessAdapter({ ...direct, model: "claude-opus-5-5" }), /pinned maker\/model slug/);
  assert.throws(() => resolveHarnessAdapter({ ...direct, reasoningEffort: "max" }), /reasoning effort/);
  assert.throws(() => resolveHarnessAdapter({ ...direct, executionProfile: { ...profile, upstream: undefined } }), /upstream pin must be one of/);
  assert.throws(() => resolveHarnessAdapter({ ...direct, executionProfile: { ...profile, upstream: "together" } }), /upstream pin must be one of/);
  assert.throws(() => resolveHarnessAdapter({ ...direct, executionProfile: { ...profile, upstream: "deepseek" } }), /not the maker anthropic's own provider/);
  assert.throws(() => resolveHarnessAdapter({ ...direct, executionProfile: { ...profile, environment: undefined } }), /environment must be clean/);
  assert.throws(() => resolveHarnessAdapter({ ...direct, harnessPath: ["direct-api", "claude-code"] }), /cannot wrap Claude|cannot wrap claude-code/);
});

test("compatibility keeps Direct API to conversations: no capabilities, no fixtures, a session transcript, a prompt-delivered skill", () => {
  const journal = { status: "ready", harness: { workspace: "read", web: "disabled", capabilities: [] }, setup: { fixtures: [] }, output: { kind: "session" } };
  assert.equal(compatibilityFor({ variant: direct, recipe: journal }).supported, true);
  const coding = { ...journal, harness: { ...journal.harness, capabilities: ["files", "shell"] }, output: { kind: "code" } };
  const reasons = compatibilityFor({ variant: direct, recipe: coding }).reasons;
  assert.ok(reasons.includes("variant lacks required capability: files"));
  assert.ok(reasons.some((reason) => /serves only session Recipes; this one produces code/.test(reason)));
  const mounted = { ...journal, setup: { fixtures: [{ id: "entry" }] } };
  assert.match(compatibilityFor({ variant: direct, recipe: mounted }).reasons.join(), /no workspace to mount/);
  assert.deepEqual(skillDeliverySupport(direct, { id: "soul", delivery: "prompt" }), []);
  assert.match(skillDeliverySupport(direct, { id: "skill", delivery: "workspace" })[0], /must ride in the prompt/);
});

test("the shipped catalog plans Direct API only onto conversation Recipes", async () => {
  const { loadCatalog } = await import("../lib/taste/catalog.mjs");
  const catalog = await loadCatalog(path.resolve(import.meta.dirname, ".."));
  const plan = planSelection(catalog, { configurationId: "direct-api-opus-5-5-high", filter: {} , allowStatuses: ["ready", "hidden", "draft"] });
  const byId = new Map(catalog.recipes.map((item) => [item.id, item]));
  assert.ok(plan.supported.length > 0, "some conversation Recipe is supported");
  for (const item of plan.supported) {
    const cooked = byId.get(item.recipeId);
    assert.equal(cooked.output.kind, "session", item.recipeId);
    assert.deepEqual(cooked.harness.capabilities, [], item.recipeId);
  }
  assert.ok(plan.unsupported.some((item) => item.recipeId === "fresh-product-span"));
});

test("a request carries the whole conversation, the pinned effort, and no tools or system prompt", () => {
  const body = buildDirectApiRequest({ variant: direct, messages: [{ role: "user", content: "a" }, { role: "assistant", content: "b" }, { role: "user", content: "c" }] });
  assert.equal(body.model, "anthropic/claude-opus-5.5");
  assert.deepEqual(body.reasoning, { effort: "high" });
  assert.deepEqual(body.messages.map((message) => message.role), ["user", "assistant", "user"]);
  assert.equal("tools" in body, false);
  assert.equal(body.messages.some((message) => message.role === "system"), false);
  assert.deepEqual(body.transforms, []);
  assert.deepEqual(body.provider, { only: ["anthropic"], allow_fallbacks: false, require_parameters: true });
  assert.equal(body.stream, false);
  assert.throws(() => buildDirectApiRequest({ variant: direct, messages: [{ role: "assistant", content: "b" }] }), /end with a user message/);
});

test("served models match exactly or as a dated snapshot of the same slug", () => {
  assert.equal(directApiModelsEquivalent("anthropic/claude-opus-5.5", "anthropic/claude-opus-5.5"), true);
  assert.equal(directApiModelsEquivalent("anthropic/claude-opus-5.5", "anthropic/claude-opus-5.5-20260922"), true);
  assert.equal(directApiModelsEquivalent("anthropic/claude-opus-5.5", "anthropic/claude-sonnet-5.5"), false);
  assert.equal(directApiModelsEquivalent("anthropic/claude-opus-5.5", "anthropic/claude-opus-5.5-fast"), false);
});

test("a missing key stops the attempt before any request", async () => {
  await assert.rejects(prepareDirectApiAttempt({ variant: direct, env: { OPENROUTER_API_KEY: "" } }), /needs OPENROUTER_API_KEY/);
  await assert.doesNotReject(prepareDirectApiAttempt({ variant: direct, env: { OPENROUTER_API_KEY: KEY } }));
});

test("two turns are one resent conversation; the served model is observed and the key never reaches disk", async (t) => {
  const root = await scratch(t);
  const fake = await fakeServer(t);
  const privateDir = path.join(root, "raw");
  const result = await runDirectApiSession({ variant: direct, recipe, privateDir, env: { OPENROUTER_API_KEY: KEY }, endpoint: fake.endpoint });
  assert.equal(result.failure, null, result.failure?.message);
  assert.match(result.threadId, /^direct_/u);
  assert.equal(result.observedModel, "anthropic/claude-opus-5.5");
  assert.equal(result.turns[0].finalMessage, "reply 1 to Respond in this fresh conversation.\n\nRead the entry.");
  assert.equal(fake.requests.length, 2);
  assert.equal(fake.requests[0].authorization, `Bearer ${KEY}`);
  assert.deepEqual(fake.requests[1].body.messages, [
    { role: "user", content: "Respond in this fresh conversation.\n\nRead the entry." },
    { role: "assistant", content: result.turns[0].finalMessage },
    { role: "user", content: "Now say it plainer." },
  ]);
  for (const file of await filesUnder(privateDir)) assert.equal((await readFile(file, "utf8")).includes(KEY), false, `${file} holds the key`);
  assert.equal(JSON.stringify(result).includes(KEY), false);
  const parsed = parseDirectApiJsonl(await readFile(result.turns[1].eventsPath, "utf8"));
  assert.equal(parsed.threadId, result.threadId);

  const observed = await verifyDirectApiIdentity({ variant: direct, cliVersion: result.cliVersion, result, endpoint: fake.endpoint, recipe });
  assert.equal(observed.model, "anthropic/claude-opus-5.5");
  assert.equal(observed.route, "openrouter");
  assert.deepEqual(observed.upstreamProviders, ["Anthropic"]);
  assert.equal(observed.upstreamPin, "anthropic");
  assert.equal(observed.verifiedBy, "direct-api-response-model");
  // Production verification pins the real endpoint, so a test endpoint cannot pass it.
  await assert.rejects(verifyDirectApiIdentity({ variant: direct, cliVersion: result.cliVersion, result, recipe }), /endpoint requested https:\/\/openrouter.ai\/api\/v1\/chat\/completions/);

  const rewritten = structuredClone(result);
  rewritten.turns[1].events[0].body.messages[1].content = "a different first reply";
  await assert.rejects(verifyDirectApiIdentity({ variant: direct, cliVersion: result.cliVersion, result: rewritten, endpoint: fake.endpoint, recipe }), /did not replay reply 1 exactly/);
  const altered = structuredClone(result);
  altered.turns[0].finalMessage = "altered";
  await assert.rejects(verifyDirectApiIdentity({ variant: direct, cliVersion: result.cliVersion, result: altered, endpoint: fake.endpoint, recipe }), /final message does not match/);
});

test("a response served by another upstream, or by none reported, stops the run and fails verification", async (t) => {
  const root = await scratch(t);
  const good = await fakeServer(t);
  const result = await runDirectApiSession({ variant: direct, recipe, privateDir: path.join(root, "good"), env: { OPENROUTER_API_KEY: KEY }, endpoint: good.endpoint });
  assert.equal(result.failure, null);
  const verify = (changed) => verifyDirectApiIdentity({ variant: direct, cliVersion: result.cliVersion, result: changed, endpoint: good.endpoint, recipe });
  for (const [provider, expected] of [["Amazon Bedrock", /pinned to Anthropic, served by Amazon Bedrock/], [undefined, /served by an unreported provider/]]) {
    const swapped = structuredClone(result);
    for (const turn of swapped.turns) { if (provider) turn.events[1].body.provider = provider; else delete turn.events[1].body.provider; }
    await assert.rejects(verify(swapped), expected);
  }
  const tampered = structuredClone(result);
  for (const turn of tampered.turns) turn.events[0].body.provider = { only: ["amazon-bedrock"] };
  await assert.rejects(verify(tampered), /did not send the upstream pin anthropic/);

  // A first turn from the wrong upstream is not followed by a second paid turn.
  const bedrock = await fakeServer(t, (body) => ({ status: 200, body: { model: body.model, provider: "Amazon Bedrock", choices: [{ finish_reason: "stop", message: { content: "ok" } }] } }));
  const stopped = await runDirectApiSession({ variant: direct, recipe, privateDir: path.join(root, "bedrock"), env: { OPENROUTER_API_KEY: KEY }, endpoint: bedrock.endpoint });
  assert.match(stopped.failure.message, /pinned to Anthropic, served by Amazon Bedrock/);
  assert.equal(bedrock.requests.length, 1);
});

test("verification rebuilds each request from the recipe: another prompt, a system message or an extra parameter fails it", async (t) => {
  const root = await scratch(t);
  const fake = await fakeServer(t);
  const result = await runDirectApiSession({ variant: direct, recipe, privateDir: path.join(root, "raw"), env: { OPENROUTER_API_KEY: KEY }, endpoint: fake.endpoint });
  const verify = (changed) => verifyDirectApiIdentity({ variant: direct, cliVersion: result.cliVersion, result: changed, endpoint: fake.endpoint, recipe });
  await assert.doesNotReject(verify(result));
  const prompt = structuredClone(result);
  prompt.turns[1].events[0].body.messages[2].content = "Something else entirely.";
  await assert.rejects(verify(prompt), /request is not the recipe's conversation so far/);
  const system = structuredClone(result);
  system.turns[0].events[0].body.messages[0].role = "system";
  await assert.rejects(verify(system), /request is not the recipe's conversation so far/);
  for (const extra of [{ tools: [] }, { temperature: 0 }, { max_tokens: 1 }]) {
    const added = structuredClone(result);
    Object.assign(added.turns[0].events[0].body, extra);
    await assert.rejects(verify(added), /request is not the recipe's conversation so far/);
  }
  await assert.rejects(verifyDirectApiIdentity({ variant: direct, cliVersion: result.cliVersion, result, endpoint: fake.endpoint }), /requires the recipe/);
});

test("a reply that did not end normally, or a response with no HTTP status, is not accepted", async () => {
  const ok = { model: "m", provider: "Anthropic", choices: [{ finish_reason: "stop", message: { content: "fine" } }] };
  assert.equal(directApiReply(ok), "fine");
  for (const finish of ["content_filter", "error", "tool_calls", undefined]) assert.throws(() => directApiReply({ ...ok, choices: [{ finish_reason: finish, message: { content: "partial" } }] }), /did not end normally/);
  const request = JSON.stringify({ type: "request", conversationId: `direct_${"a".repeat(8)}-aaaa-aaaa-aaaa-${"a".repeat(12)}` });
  assert.throws(() => parseDirectApiJsonl(`${request}\n${JSON.stringify({ type: "response", body: ok })}`), /HTTP/);
});

test("a substituted model, an HTTP error, or an empty reply stops the conversation without leaking the key", async (t) => {
  const root = await scratch(t);
  const swapped = await fakeServer(t, (body, index) => ({ status: 200, body: { model: index === 0 ? body.model : "anthropic/claude-haiku-5.5", provider: "Anthropic", choices: [{ finish_reason: "stop", message: { content: "ok" } }] } }));
  const substituted = await runDirectApiSession({ variant: direct, recipe, privateDir: path.join(root, "a"), env: { OPENROUTER_API_KEY: KEY }, endpoint: swapped.endpoint });
  assert.match(substituted.failure.message, /served anthropic\/claude-haiku-5.5 after anthropic\/claude-opus-5.5/);
  assert.equal(substituted.failure.turnId, "follow");

  const broke = await fakeServer(t, () => ({ status: 402, body: { error: { code: 402, message: "Insufficient credits" } } }));
  const paid = await runDirectApiSession({ variant: direct, recipe, privateDir: path.join(root, "b"), env: { OPENROUTER_API_KEY: KEY }, endpoint: broke.endpoint });
  assert.equal(paid.failure.httpStatus, 402);
  assert.equal(paid.turns.length, 1, "nothing is sent after a failed turn");
  assert.equal(broke.requests.length, 1, "no retry");
  assert.equal(paid.failure.message.includes(KEY), false);

  const empty = await fakeServer(t, (body) => ({ status: 200, body: { model: body.model, provider: "Anthropic", choices: [{ finish_reason: "length", message: { content: "cut" } }] } }));
  const cut = await runDirectApiSession({ variant: direct, recipe, privateDir: path.join(root, "c"), env: { OPENROUTER_API_KEY: KEY }, endpoint: empty.endpoint });
  assert.match(cut.failure.message, /cut off at the output limit/);
});

test("a Direct API Dish publishes through the runner as a public session transcript", async (t) => {
  const root = await scratch(t);
  const fake = await fakeServer(t);
  const cooked = {
    schemaVersion: 1, id: "demo-conversation", version: "1.0.0", status: "ready", title: "A demo conversation", summary: "A runner test for the Direct API baseline.",
    cuisines: ["conversation-journaling"], origin: "textbook", originNote: "Runner integration test.", tags: ["presence"], kind: "session",
    harness: { workspace: "read", web: "disabled", capabilities: [] }, setup: { instructions: "Respond in this fresh conversation.", fixtures: [] },
    turns: [{ id: "respond", role: "prompt", content: "Read the entry." }, { id: "follow", role: "correction", content: "Now say it plainer." }],
    output: { kind: "session", entry: "output/session.json", include: ["output/session.json"], limits: { maxFiles: 1, maxBytes: 65536 } },
    validation: { mode: "trace", checks: [{ id: "entry", type: "file-exists", required: true, description: "The transcript exists.", target: "output/session.json" }] },
    sourcePath: "catalog/recipes/conversation/demo/recipe.json", fixtureHashes: {},
  };
  cooked.recipeHash = computeRecipeHash(cooked, cooked.fixtureHashes);
  const catalog = { catalogHash: `sha256:${"4".repeat(64)}`, recipes: [cooked] };
  const env = { OPENROUTER_API_KEY: KEY };
  const run = await executeRecipe({
    repoRoot: root, catalog, recipe: cooked, variant: direct, env, nonce: "direct",
    runSession: (options) => runDirectApiSession({ ...options, endpoint: fake.endpoint }),
    verifyIdentity: (options) => verifyDirectApiIdentity({ ...options, endpoint: fake.endpoint }),
  });
  assert.equal(run.status, "accepted", run.error);
  const dish = JSON.parse(await readFile(path.join(run.dishDirectory, "dish.json"), "utf8"));
  assert.equal(dish.identity.harness, "direct-api");
  assert.equal(dish.identity.observedModel, "anthropic/claude-opus-5.5");
  assert.equal(dish.identity.harnessVersion, "kitchen-direct-api/1");
  const trace = JSON.parse(await readFile(path.join(run.dishDirectory, "trace.json"), "utf8"));
  assert.deepEqual(trace.turns.map((turn) => turn.response), ["reply 1 to Respond in this fresh conversation.\n\nRead the entry.", "reply 2 to Now say it plainer."]);
  const attemptDir = path.join(root, "private/runtime/attempts", run.attemptId);
  const requested = JSON.parse(await readFile(path.join(attemptDir, "requested.json"), "utf8"));
  assert.equal(requested.execution.route, "openrouter");
  assert.equal(requested.execution.upstream, "anthropic");
  assert.equal(requested.execution.upstreamPin, "anthropic");
  assert.equal(requested.execution.tools, "none");
  for (const file of await filesUnder(root)) assert.equal((await readFile(file)).includes(KEY), false, `${file} holds the key`);
});
