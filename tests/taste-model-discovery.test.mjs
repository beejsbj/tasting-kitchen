import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { computeConfigHash, loadCatalog } from "../lib/taste/catalog.mjs";
import {
  buildTemplateConfiguration, catalogWithConfigurations, chooseEffort, chooseUpstream, CONFIGURATION_TEMPLATES, isConfigurationSpec,
  materializeConfigurations, materializedProblems, parseConfigurationSpec, resolveConfigurationSpec, servingProviders,
} from "../lib/taste/configuration-templates.mjs";
import { hermesRoute } from "../lib/taste/hermes.mjs";
import { KEY_PROXY_AUTH } from "../lib/taste/key-proxy.mjs";
import { resolveHarnessAdapter } from "../lib/taste/harness-adapters.mjs";
import { cook, plan } from "../lib/taste/index.mjs";
import { describeOpenRouterModel, discoverModels, formatDiscovery, openRouterEfforts } from "../lib/taste/model-discovery.mjs";
import { configurationProviderPin, isPinnedUpstream, upstreamName } from "../lib/taste/openrouter.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
// Secrets planted in the fake Hermes home: none may reach any discovery output.
const SECRETS = ["sk-or-v1-PLANTED-OPENROUTER", "PLANTED-ACCESS-TOKEN", "PLANTED-REFRESH-TOKEN", "fp:PLANTED", "PLANTED-LABEL-SECRET", "PLANTED-ERROR-MESSAGE"];

async function fakeHermesHome(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "taste-hermes-discovery-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const claude = path.join(root, "claude");
  await mkdir(path.join(root, "hermes", "cache"), { recursive: true });
  await mkdir(claude, { recursive: true });
  await writeFile(path.join(claude, ".credentials.json"), "{}");
  const hermes = path.join(root, "hermes");
  await writeFile(path.join(hermes, "auth.json"), JSON.stringify({
    version: 1, active_provider: "nous",
    providers: {
      nous: { access_token: SECRETS[1], refresh_token: SECRETS[2], last_auth_error: { provider: "nous", code: "invalid_grant", message: `Invalid refresh token ${SECRETS[5]}`, relogin_required: true } },
    },
    credential_pool: {
      nous: [],
      openrouter: [{ id: "a1", label: SECRETS[4], auth_type: "api_key", source: "env:OPENROUTER_API_KEY", access_token: SECRETS[0], secret_fingerprint: SECRETS[3], last_status: "ok" }],
      gemini: [{ id: "b2", label: "GEMINI_API_KEY", auth_type: "api_key", source: "env:GEMINI_API_KEY", last_status: "exhausted", last_error_code: 402 }],
      "opencode-go": [{ id: "c3", auth_type: "api_key", source: "manual", access_token: SECRETS[0], last_status: "ok" }],
      copilot: [{ id: "d4", auth_type: "api_key", source: "env:GH_TOKEN", failure_reason: "auth" }],
      anthropic: [],
    },
    suppressed_sources: { "openai-api": ["env:OPENAI_API_KEY"] },
  }));
  await writeFile(path.join(hermes, "provider_models_cache.json"), JSON.stringify({
    openrouter: { at: 1794209901, models: ["anthropic/claude-opus-5.5", "google/gemma-4-31b-it:free"] },
    "opencode-go": { at: 1794209901, models: ["glm-5.3", "beam-free", "mimo-v2.5"] },
    "opencode-free": { at: 1788465482, models: ["deepseek-v4-flash-free"] },
    anthropic: { at: 1794209901, models: ["claude-opus-5-5", "claude-fable-5.1", "claude-opus-4-8"] },
    gemini: { at: 1794209901, models: ["gemini-3.8-flash"] },
    "openai-api": { at: 1790756855, models: ["gpt-6-sol"], fallback: true },
  }));
  await writeFile(path.join(hermes, "ollama_cloud_models_cache.json"), JSON.stringify({ models: ["kimi-k3", "glm-5.3"], cached_at: 1788465478 }));
  await writeFile(path.join(hermes, "models_dev_cache.json"), JSON.stringify({
    "opencode-go": { models: {
      "glm-5.3": { id: "glm-5.3", name: "GLM-5.3", reasoning: true, tool_call: true, limit: { context: 200000 }, cost: { input: 1, output: 2 } },
      "mimo-v2.5": { id: "mimo-v2.5", name: "MiMo V2.5", reasoning: false, tool_call: false, cost: { input: 1, output: 1 } },
    } },
    openrouter: { models: {
      "google/gemma-4-31b-it:free": { id: "google/gemma-4-31b-it:free", name: "Google: Gemma 4 31B (free)", tool_call: true, reasoning: true, limit: { context: 262144 }, cost: { input: 0, output: 0 } },
    } },
  }));
  await writeFile(path.join(hermes, "cache", "nous_recommended_cache.json"), JSON.stringify({
    "https://portal.nousresearch.com": { data: { paidRecommendedModels: [{ modelName: "x-ai/grok-4.7" }], freeRecommendedModels: [{ modelName: "stepfun/step-3.7-flash:free" }] } },
  }));
  return { TASTE_HERMES_ROOT: hermes, CLAUDE_CONFIG_DIR: claude };
}

const OPENROUTER_MODELS = [
  { id: "anthropic/claude-opus-5.5", name: "Anthropic: Claude Opus 5.5", context_length: 1000000, pricing: { prompt: "0.000005", completion: "0.000025" }, supported_parameters: ["tools", "reasoning"], reasoning: { mandatory: false } },
  { id: "google/gemma-4-31b-it:free", name: "Google: Gemma 4 31B (free)", context_length: 262144, pricing: { prompt: "0", completion: "0" }, supported_parameters: ["tools", "reasoning"], reasoning: { mandatory: false } },
  { id: "dots-studio/dots-3-note-preview:free", name: "dots.studio: Dots 3 Note Preview (free)", context_length: 500000, pricing: { prompt: "0", completion: "0" }, supported_parameters: ["tools", "reasoning"], reasoning: { mandatory: true, supported_efforts: ["low", "high"] } },
  { id: "nvidia/nemotron-3-ultra:free", name: "NVIDIA: Nemotron 3 Ultra (free)", context_length: 1048576, pricing: { prompt: "0", completion: "0" }, supported_parameters: ["tools", "reasoning"], reasoning: { mandatory: false, supported_efforts: ["none", "medium"], default_effort: "medium" } },
  { id: "google/lyria-3-pro-preview", name: "Google: Lyria 3 Pro", pricing: { prompt: "0", completion: "0" }, supported_parameters: [], architecture: { output_modalities: ["text", "audio"] } },
  { id: "openrouter/free", name: "Free Models Router", pricing: { prompt: "0", completion: "0" }, supported_parameters: ["tools"] },
  { id: "meta-llama/llama-5-70b", name: "Meta: Llama 5 70B", pricing: { prompt: "0.0000001", completion: "0.0000002" }, supported_parameters: ["tools"] },
];
const ENDPOINTS = {
  "anthropic/claude-opus-5.5": [{ tag: "anthropic", provider_name: "Anthropic" }, { tag: "amazon-bedrock", provider_name: "Amazon Bedrock" }],
  "google/gemma-4-31b-it:free": [{ tag: "google-ai-studio", provider_name: "Google AI Studio" }],
  "dots-studio/dots-3-note-preview:free": [{ tag: "atlas-cloud/fp8", provider_name: "AtlasCloud" }],
  "nvidia/nemotron-3-ultra:free": [{ tag: "nvidia", provider_name: "Nvidia" }],
  "meta-llama/llama-5-70b": [{ tag: "together/fp8", provider_name: "Together" }, { tag: "deepinfra/turbo", provider_name: "DeepInfra" }, { tag: "deepinfra/fp8", provider_name: "DeepInfra" }],
};

/** A stand-in for OpenRouter's public metadata API. It records every request so the tests can say no key was sent. */
async function fakeMetadataServer(t, { failModels = false, endpoints: moved = {} } = {}) {
  const endpointsFor = { ...ENDPOINTS, ...moved };
  const requests = [];
  const server = createServer((request, response) => {
    requests.push({ url: request.url, authorization: request.headers.authorization ?? null });
    const url = new URL(request.url, "http://localhost");
    response.setHeader("content-type", "application/json");
    if (url.pathname === "/api/v1/models") {
      if (failModels) { response.statusCode = 503; return response.end("{}"); }
      return response.end(JSON.stringify({ data: OPENROUTER_MODELS }));
    }
    const endpoints = /^\/api\/v1\/models\/(.+)\/endpoints$/u.exec(url.pathname);
    if (endpoints) {
      const id = decodeURIComponent(endpoints[1]);
      if (!endpointsFor[id]) { response.statusCode = 404; return response.end("{}"); }
      return response.end(JSON.stringify({ data: { id, endpoints: endpointsFor[id].map((endpoint) => ({ ...endpoint, pricing: { prompt: id.endsWith(":free") ? "0" : "0.000001", completion: "0" }, supported_parameters: ["tools"] })) } }));
    }
    response.statusCode = 404;
    response.end("{}");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { url: `http://127.0.0.1:${server.address().port}/api/v1`, requests };
}

async function discoveryEnv(t, options) {
  const env = await fakeHermesHome(t);
  const server = await fakeMetadataServer(t, options);
  return { env: { ...env, TASTE_OPENROUTER_METADATA_URL: server.url }, server };
}

test("discovery lists every Hermes route with its state, the fix for a logged-out one, and no secret", async (t) => {
  const { env, server } = await discoveryEnv(t);
  const result = await discoverModels({ env });
  const routes = Object.fromEntries(result.routes.map((route) => [route.route, route]));
  assert.deepEqual(Object.keys(routes).sort(), ["anthropic", "copilot", "gemini", "nous", "ollama-cloud", "openai-api", "opencode-free", "opencode-go", "openrouter"]);
  assert.equal(routes.openrouter.status, "authenticated");
  assert.deepEqual(routes.openrouter.credentials, [{ authType: "api_key", source: "env:OPENROUTER_API_KEY", status: "ok" }]);
  assert.equal(routes.nous.status, "logged-out");
  assert.equal(routes.nous.fix, "hermes auth add nous");
  assert.match(routes.nous.authError, /invalid_grant/);
  assert.deepEqual(routes.nous.models.map((model) => model.id), ["x-ai/grok-4.7", "stepfun/step-3.7-flash:free"]);
  assert.equal(routes.gemini.status, "exhausted");
  assert.equal(routes.copilot.status, "auth-failed");
  assert.equal(routes["opencode-free"].status, "retired");
  assert.equal(routes["opencode-free"].cookable, false);
  assert.equal(routes["openai-api"].status, "suppressed");
  assert.equal(routes.anthropic.status, "borrowed-claude-code-login");
  assert.equal(routes["ollama-cloud"].source, "hermes:ollama_cloud_models_cache.json");
  // A route is cookable when Kitchen has a template for it: its own (OpenRouter, Anthropic) or the route template for a key route it can proxy.
  assert.deepEqual(result.routes.filter((route) => route.cookable).map((route) => route.route), ["anthropic", "opencode-go", "openrouter"]);
  assert.equal(routes["opencode-go"].template, "hermes-route-clean");
  assert.match(routes["opencode-go"].note, /OPENCODE_GO_API_KEY from the cook command's environment/);
  assert.match(routes.nous.notCookable, /OAuth/);
  assert.match(routes.copilot.notCookable, /no key-proxy entry/);
  // On a key route, efforts follow whether the model reasons, and a model that takes no tools is not cookable.
  assert.deepEqual(routes["opencode-go"].models.map((model) => [model.id, model.name, model.cookable, model.efforts?.length, model.reasons ?? null]), [
    ["glm-5.3", "GLM-5.3", true, 8, null], ["beam-free", "beam-free", true, 8, null], ["mimo-v2.5", "MiMo V2.5", false, 1, ["no tool calling, which Hermes's file and terminal tools need"]],
  ]);
  // The Anthropic template takes Kitchen's four models, in Kitchen's spelling.
  assert.deepEqual(routes.anthropic.models.map((model) => [model.id, model.cookable, model.kitchenModel ?? null]), [["claude-opus-5-5", true, null], ["claude-fable-5.1", true, "claude-fable-5-1"], ["claude-opus-4-8", false, null]]);
  // OpenRouter is listed from its live public list, far beyond Hermes's curated cache.
  assert.equal(routes.openrouter.source, "openrouter:/api/v1/models");
  assert.deepEqual(routes.openrouter.counts, { models: 7, free: 5, paid: 2 });
  const gemma = routes.openrouter.models.find((model) => model.id === "google/gemma-4-31b-it:free");
  assert.deepEqual([gemma.free, gemma.contextLength, gemma.hermesCurated, gemma.cookable, gemma.name], [true, 262144, true, true, "Gemma 4 31B"]);
  assert.deepEqual(routes.openrouter.models.find((model) => model.id === "openrouter/free").reasons, ["a router that picks another model per request"]);
  assert.match(routes.openrouter.models.find((model) => model.id === "google/lyria-3-pro-preview").reasons.join(";"), /no tool calling/);
  const text = JSON.stringify(result) + formatDiscovery(result);
  for (const secret of SECRETS) assert.ok(!text.includes(secret), `discovery leaked ${secret}`);
  assert.ok(server.requests.every((request) => request.authorization === null), "the metadata API is called without a key");
});

test("discovery narrows to one route and to free models, and falls back to Hermes's models.dev cache when the list is down", async (t) => {
  const { env } = await discoveryEnv(t);
  const free = await discoverModels({ env, route: "openrouter", free: true });
  assert.equal(free.routes.length, 1);
  assert.ok(free.routes[0].models.every((model) => model.free));
  assert.equal(free.routes[0].counts.models, 7, "counts describe the whole route, not the filter");
  await assert.rejects(discoverModels({ env, route: "nowhere" }), /Hermes has no route nowhere/);
  const go = (await discoverModels({ env, route: "opencode-go", free: true })).routes[0];
  assert.equal(go.counts.models, 3);
  assert.deepEqual(go.models.map((model) => model.id), ["beam-free"]);

  const down = await discoveryEnv(t, { failModels: true });
  const fallback = (await discoverModels({ env: down.env, route: "openrouter" })).routes[0];
  assert.equal(fallback.source, "hermes:models_dev_cache.json");
  assert.match(fallback.warning, /503/);
  assert.deepEqual(fallback.models.map((model) => [model.id, model.free, model.cookable]), [["google/gemma-4-31b-it:free", true, true]]);
});

test("OpenRouter efforts follow the published reasoning facts", () => {
  assert.deepEqual(openRouterEfforts({ supported_parameters: ["tools"] }), ["none"]);
  assert.deepEqual(openRouterEfforts({ supported_parameters: ["reasoning"], reasoning: { mandatory: false } }), ["none", "minimal", "low", "medium", "high", "xhigh"]);
  assert.deepEqual(openRouterEfforts({ supported_parameters: ["reasoning"], reasoning: { mandatory: true } }), ["minimal", "low", "medium", "high", "xhigh"]);
  assert.deepEqual(openRouterEfforts({ supported_parameters: ["reasoning"], reasoning: { mandatory: false, supported_efforts: ["high", "none", "max"] } }), ["none", "high"]);
});

test("a spec names one model on a template, a selector many; ids never parse as specs", () => {
  assert.equal(isConfigurationSpec("hermes-openrouter-glm-5-3-high-clean"), false);
  assert.equal(isConfigurationSpec("hermes:openrouter/z-ai/glm-5.3@high"), true);
  assert.deepEqual(parseConfigurationSpec("hermes:openrouter/google/gemma-4-31b-it:free@high"), {
    text: "hermes:openrouter/google/gemma-4-31b-it:free@high", harness: "hermes", route: "openrouter", model: "google/gemma-4-31b-it:free", effort: "high", environment: "clean", filters: [], selector: false,
  });
  const selector = parseConfigurationSpec("hermes:openrouter/*@auto:clean+free");
  assert.deepEqual([selector.model, selector.effort, selector.environment, selector.filters, selector.selector], ["*", "auto", "clean", ["free"], true]);
  assert.equal(parseConfigurationSpec("hermes:openrouter/google/*@high").selector, true);
  assert.throws(() => parseConfigurationSpec("hermes:openrouter/google/gemma"), /harness:route\/model@effort/);
  assert.throws(() => parseConfigurationSpec("hermes:openrouter/*@high+cheap"), /Unknown selector filter \+cheap/);
});

test("the upstream is the maker's own provider, else the only one, else the one named, and never silently chosen", () => {
  assert.deepEqual(chooseUpstream("anthropic/claude-opus-5.5", [{ slug: "amazon-bedrock", name: "Amazon Bedrock" }, { slug: "anthropic", name: "Anthropic" }]), { upstream: "anthropic", choice: { name: "Anthropic", reason: "maker" } });
  assert.deepEqual(chooseUpstream("nvidia/nemotron-3-ultra:free", [{ slug: "nvidia", name: "Nvidia" }]), { upstream: "nvidia", choice: { name: "Nvidia", reason: "maker" } });
  assert.deepEqual(chooseUpstream("dots-studio/dots-3:free", [{ slug: "atlas-cloud", name: "AtlasCloud" }]), { upstream: "atlas-cloud", choice: { name: "AtlasCloud", reason: "sole-provider" } });
  const many = [{ slug: "together", name: "Together" }, { slug: "deepinfra", name: "DeepInfra" }];
  assert.match(chooseUpstream("meta-llama/llama-5-70b", many).reason, /2 providers serve it and none is meta-llama's own; name one with --upstream \(together, deepinfra\)/);
  assert.deepEqual(chooseUpstream("meta-llama/llama-5-70b", many, "deepinfra"), { upstream: "deepinfra", choice: { name: "DeepInfra", reason: "named" } });
  assert.match(chooseUpstream("meta-llama/llama-5-70b", many, "groq").reason, /groq does not serve it/);
});

test("auto effort takes high, else the model's default, else its highest", () => {
  assert.deepEqual(chooseEffort({ efforts: ["none", "low", "high"] }, "auto"), { effort: "high" });
  assert.deepEqual(chooseEffort({ efforts: ["none", "medium"], defaultEffort: "medium" }, "auto"), { effort: "medium" });
  assert.deepEqual(chooseEffort({ efforts: ["none", "low", "medium"] }, "auto"), { effort: "medium" });
  assert.match(chooseEffort({ efforts: ["low", "high"] }, "xhigh").reason, /does not take effort xhigh/);
});

test("a template rebuilds every hand-written clean Hermes configuration with the same hash", async () => {
  const catalog = await loadCatalog(repoRoot);
  const handWritten = catalog.configurations.filter((configuration) => configuration.harness === "hermes" && configuration.executionProfile.environment === "clean" && !configuration.materialized);
  assert.ok(handWritten.length >= 20);
  for (const configuration of handWritten) {
    const template = CONFIGURATION_TEMPLATES.find((candidate) => candidate.executionProfileId === configuration.executionProfile.id);
    const rebuilt = buildTemplateConfiguration(template, { model: configuration.model, name: "x", effort: configuration.reasoningEffort, upstream: configuration.executionProfile.upstream });
    assert.equal(computeConfigHash(rebuilt), computeConfigHash(configuration), configuration.id);
  }
});

test("upstreamChoice admits a recorded non-table pin, which both routes send and Direct API verifies by name", () => {
  const free = {
    id: "x", label: "x", provider: "dots-studio", model: "dots-studio/dots-3-note-preview:free", harness: "hermes", reasoningEffort: "high", serviceTier: "default", personality: "none", capabilities: ["files", "shell"],
    executionProfile: { id: "hermes-linux-host-clean-openrouter-v1", label: "via Hermes · clean home · OpenRouter route", runtime: "linux-host", sandbox: "disabled", approvalPolicy: "yolo", nativeWeb: "disabled", networkPolicy: "not-enforced", filesystemBoundary: "not-a-secrecy-boundary", environment: "clean", route: "openrouter", upstream: "atlas-cloud" },
    upstreamChoice: { name: "AtlasCloud", reason: "sole-provider" },
  };
  assert.doesNotThrow(() => resolveHarnessAdapter(free));
  assert.deepEqual(configurationProviderPin(free), { only: ["atlas-cloud"], allow_fallbacks: false });
  assert.equal(upstreamName(free), "AtlasCloud");
  assert.equal(isPinnedUpstream("atlas-cloud", "AtlasCloud", upstreamName(free)), true);
  // Without the record the old rule holds: only the maker's own provider from the table.
  const unrecorded = { ...free };
  delete unrecorded.upstreamChoice;
  assert.throws(() => resolveHarnessAdapter(unrecorded), /upstream pin must be one of/);
  assert.throws(() => resolveHarnessAdapter({ ...free, upstreamChoice: { name: "AtlasCloud", reason: "maker" } }), /not the maker dots-studio's own provider/);
  assert.throws(() => resolveHarnessAdapter({ ...free, upstreamChoice: { name: "", reason: "named" } }), /must name the provider/);
  assert.throws(() => resolveHarnessAdapter({ ...free, model: "dots-studio/dots-3-note-preview:beta" }), /pinned maker\/model slug/);
  // A recorded choice changes no hash: it is provenance, not identity.
  assert.equal(computeConfigHash(free), computeConfigHash(unrecorded));
});

test("a selector resolves through discovery to existing entries, entries to materialize, and models it cannot cook", async (t) => {
  const { env } = await discoveryEnv(t);
  const catalog = await loadCatalog(repoRoot);
  const now = () => new Date("2026-11-09T12:00:00Z");
  const resolution = await resolveConfigurationSpec(catalog, "hermes:openrouter/*@auto+free", { env, now });
  assert.deepEqual(resolution.entries.map((entry) => [entry.configuration.id, entry.status, entry.configuration.reasoningEffort, entry.configuration.executionProfile.upstream, entry.configuration.upstreamChoice?.reason]), [
    ["hermes-openrouter-dots-studio-dots-3-note-preview-free-atlas-cloud-high-clean", "materialize", "high", "atlas-cloud", "sole-provider"],
    ["hermes-openrouter-google-gemma-4-31b-it-free-google-ai-studio-high-clean", "materialize", "high", "google-ai-studio", "maker"],
    ["hermes-openrouter-nvidia-nemotron-3-ultra-free-nvidia-medium-clean", "materialize", "medium", "nvidia", "maker"],
  ]);
  assert.deepEqual(resolution.unsupported.map((item) => item.model), ["google/lyria-3-pro-preview", "openrouter/free"]);
  assert.equal(resolution.matched, 5);
  const gemma = resolution.entries[1].configuration;
  assert.equal(gemma.label, "Gemma 4 31B · High · via Hermes · clean (OpenRouter)");
  assert.deepEqual(gemma.materialized, { template: "hermes-openrouter-clean", spec: "hermes:openrouter/google/gemma-4-31b-it:free@high:clean", selector: "hermes:openrouter/*@auto+free", at: "2026-11-09T12:00:00.000Z", free: true, contextLength: 262144, source: "openrouter:/api/v1/models" });
  assert.deepEqual(materializedProblems(gemma), []);
  // A materialized OpenRouter configuration runs behind the key proxy, as a hand-written one does: Hermes never holds the key.
  assert.equal(hermesRoute(gemma).auth, KEY_PROXY_AUTH);

  // A spec for a configuration already in the catalog is that entry.
  const existing = await resolveConfigurationSpec(catalog, "hermes:openrouter/anthropic/claude-opus-5.5@high", { env });
  assert.deepEqual(existing.entries.map((entry) => [entry.status, entry.configuration.id]), [["catalog", "hermes-openrouter-opus-5-5-high-clean"]]);
  const anthropic = await resolveConfigurationSpec(catalog, "hermes:anthropic/claude-opus-5-5@max", { env });
  assert.deepEqual(anthropic.entries.map((entry) => [entry.status, entry.configuration.id]), [["catalog", "hermes-opus-5-5-max-clean"]]);
  // A paid model with several providers and no maker's own needs --upstream; with it, the choice is recorded.
  await assert.rejects(resolveConfigurationSpec(catalog, "hermes:openrouter/meta-llama/llama-5-70b@none", { env }), /name one with --upstream/);
  const named = await resolveConfigurationSpec(catalog, "hermes:openrouter/meta-llama/llama-5-70b@none", { env, upstream: "deepinfra" });
  assert.deepEqual(named.entries[0].configuration.upstreamChoice, { name: "DeepInfra", reason: "named" });
  await assert.rejects(resolveConfigurationSpec(catalog, "hermes:openrouter/google/gemma-4-31b-it:free@max", { env }), /does not take effort max/);
  await assert.rejects(resolveConfigurationSpec(catalog, "hermes:openrouter/nobody/nothing@high", { env }), /OpenRouter does not list nobody\/nothing/);
  await assert.rejects(resolveConfigurationSpec(catalog, "hermes:openrouter/*@high:snapshot", { env }), /No configuration template for hermes on the openrouter route in the snapshot environment/);
});

async function fixtureRepository(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "taste-materialize-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(path.join(repoRoot, "catalog"), path.join(root, "catalog"), { recursive: true });
  await cp(path.join(repoRoot, "dishes"), path.join(root, "dishes"), { recursive: true });
  const recipePath = path.join(root, "catalog", "recipes", "ui-visual", "responsive-product-launch", "recipe.json");
  const recipe = JSON.parse(await readFile(recipePath, "utf8"));
  await writeFile(recipePath, `${JSON.stringify({ ...recipe, status: "ready" }, null, 2)}\n`);
  return root;
}

test("plan shows what a selector resolves to; a dry cook writes nothing; an executed cook materializes once, then reuses", async (t) => {
  const { env } = await discoveryEnv(t);
  const root = await fixtureRepository(t);
  const before = await readFile(path.join(root, "catalog", "configurations.json"), "utf8");
  const selection = { configurationId: "hermes:openrouter/google/*@auto+free", recipeIds: ["responsive-product-launch"], env };

  const planned = await plan(root, selection);
  assert.equal(planned.configurationSpec.selector, true);
  assert.deepEqual(planned.configurationSpec.configurations.map((item) => [item.id, item.status, item.free]), [["hermes-openrouter-google-gemma-4-31b-it-free-google-ai-studio-high-clean", "materialize", true]]);
  assert.deepEqual(planned.plans.map((item) => [item.variant.id, item.supported.length]), [["hermes-openrouter-google-gemma-4-31b-it-free-google-ai-studio-high-clean", 1]]);
  const dry = await cook(root, { ...selection, intent: "fill-missing" });
  assert.equal(dry.mode, "dry-run");
  assert.equal(dry.cooks[0].planned.length, 1);
  assert.equal(await readFile(path.join(root, "catalog", "configurations.json"), "utf8"), before, "a dry run writes nothing");

  const ran = [];
  const executePlan = async ({ plan: runPlan, catalog }) => {
    ran.push({ id: runPlan.variant.id, hash: runPlan.variant.configHash, catalogHash: catalog.catalogHash });
    return { results: [], accepted: [], failed: [], unsupported: [] };
  };
  const executed = await cook(root, { ...selection, intent: "fill-missing", execute: true, env: { ...env, TASTE_ALLOW_MODEL_RUNS: "1" }, executePlan });
  assert.deepEqual(executed.materialized, ["hermes-openrouter-google-gemma-4-31b-it-free-google-ai-studio-high-clean"]);
  const catalog = await loadCatalog(root);
  const written = catalog.configurations.at(-1);
  assert.equal(written.id, "hermes-openrouter-google-gemma-4-31b-it-free-google-ai-studio-high-clean");
  assert.equal(written.materialized.template, "hermes-openrouter-clean");
  // The Dish would carry the hash of the catalog as written, and the configuration's ordinary hash.
  assert.deepEqual(ran, [{ id: written.id, hash: computeConfigHash(written), catalogHash: catalog.catalogHash }]);
  // Every hand-written entry is untouched.
  const original = JSON.parse(before).configurations;
  assert.deepEqual(catalog.configurations.slice(0, original.length).map(computeConfigHash), original.map(computeConfigHash));

  const again = await plan(root, selection);
  assert.deepEqual(again.configurationSpec.configurations.map((item) => item.status), ["catalog"]);
  assert.deepEqual(await materializeConfigurations(root, [written]), [], "the same hash is never written twice");
});

test("an executed cook does not materialize a configuration with nothing to cook", async (t) => {
  const { env } = await discoveryEnv(t);
  const root = await fixtureRepository(t);
  const before = await readFile(path.join(root, "catalog", "configurations.json"), "utf8");
  // A hidden recipe: the configuration would have nothing to cook.
  const result = await cook(root, { configurationId: "hermes:openrouter/google/*@auto+free", recipeIds: ["bounded-tool-repair"], env: { ...env, TASTE_ALLOW_MODEL_RUNS: "1" }, intent: "fill-missing", execute: true, executePlan: async () => assert.fail("nothing should run") });
  assert.deepEqual(result.materialized, []);
  assert.equal(result.cooks[0].mode, "skipped");
  assert.equal(await readFile(path.join(root, "catalog", "configurations.json"), "utf8"), before);
  // The plan and a dry run say so too, rather than promising a materialization.
  const dry = await cook(root, { configurationId: "hermes:openrouter/google/*@auto+free", recipeIds: ["bounded-tool-repair"], env, intent: "fill-missing" });
  assert.deepEqual(dry.configurationSpec.configurations.map((item) => item.status), ["nothing-to-cook"]);
  const planned = await plan(root, { configurationId: "hermes:openrouter/google/*@auto+free", recipeIds: ["bounded-tool-repair"], env });
  assert.deepEqual(planned.configurationSpec.configurations.map((item) => item.status), ["nothing-to-cook"]);
});

test("a pin must be an endpoint that takes tools and, for a free model, charges nothing", () => {
  const providers = [{ slug: "paid", name: "Paid", free: false, tools: true }, { slug: "free-notools", name: "NoTools", free: true, tools: false }, { slug: "free", name: "Free", free: true, tools: true }];
  assert.deepEqual(servingProviders({ free: true }, providers).map((provider) => provider.slug), ["free"]);
  assert.deepEqual(servingProviders({ free: false }, providers).map((provider) => provider.slug), ["paid", "free"]);
});

test("catalog validation checks a materialized record against its configuration", async () => {
  const [template] = CONFIGURATION_TEMPLATES;
  const configuration = buildTemplateConfiguration(template, {
    model: "google/gemma-4-31b-it:free", name: "Gemma 4 31B", effort: "high", upstream: "google-ai-studio", upstreamChoice: { name: "Google AI Studio", reason: "maker" },
    materialized: { template: template.id, spec: "hermes:openrouter/google/gemma-4-31b-it:free@high:clean", at: "2026-11-09T12:00:00Z", free: true, source: "openrouter:/api/v1/models" },
  });
  assert.deepEqual(materializedProblems(configuration), []);
  assert.match(materializedProblems({ ...configuration, materialized: { ...configuration.materialized, spec: "hermes:openrouter/google/gemma-4-31b-it:free@low" } }).join(";"), /does not name this configuration/);
  assert.match(materializedProblems({ ...configuration, materialized: { ...configuration.materialized, template: "nope" } }).join(";"), /template must be one of/);
  assert.match(materializedProblems({ ...configuration, materialized: { ...configuration.materialized, price: 0 } }).join(";"), /unknown key price/);
  const catalog = await loadCatalog(repoRoot);
  assert.notEqual(catalogWithConfigurations(catalog, [configuration]).catalogHash, catalog.catalogHash);
  assert.equal(catalogWithConfigurations(catalog, []).catalogHash, catalog.catalogHash);
});

test("a missing price is unknown, not free", () => {
  const base = { id: "acme/thing-1", supported_parameters: ["tools"] };
  assert.equal(describeOpenRouterModel({ ...base, pricing: {} }).free, false);
  assert.equal(describeOpenRouterModel({ ...base, pricing: { prompt: null, completion: null } }).free, false);
  assert.equal(describeOpenRouterModel({ ...base, pricing: { prompt: "0", completion: "0" } }).free, true);
  assert.equal(describeOpenRouterModel({ ...base, id: "acme/thing-1:free" }).free, true);
});

test("a materialized OpenRouter id carries its upstream pin, so a provider move adds a second configuration beside the first", async (t) => {
  const { env } = await discoveryEnv(t);
  const catalog = await loadCatalog(repoRoot);
  const first = (await resolveConfigurationSpec(catalog, "hermes:openrouter/google/gemma-4-31b-it:free@high", { env })).entries[0].configuration;
  assert.equal(first.id, "hermes-openrouter-google-gemma-4-31b-it-free-google-ai-studio-high-clean");
  // The model moves: OpenRouter now lists another sole provider for it.
  const moved = await discoveryEnv(t, { endpoints: { "google/gemma-4-31b-it:free": [{ tag: "chutes/bf16", provider_name: "Chutes" }] } });
  const withFirst = catalogWithConfigurations(catalog, [first]);
  const resolution = await resolveConfigurationSpec(withFirst, "hermes:openrouter/google/gemma-4-31b-it:free@high", { env: moved.env });
  assert.deepEqual(resolution.entries.map((entry) => [entry.status, entry.configuration.id, entry.configuration.executionProfile.upstream]), [["materialize", "hermes-openrouter-google-gemma-4-31b-it-free-chutes-high-clean", "chutes"]]);
  assert.notEqual(resolution.entries[0].configHash, computeConfigHash(first));
  // A selector over the moved model does the same, rather than excluding it.
  const selected = await resolveConfigurationSpec(withFirst, "hermes:openrouter/google/*@auto+free", { env: moved.env });
  assert.deepEqual(selected.entries.map((entry) => entry.configuration.id), ["hermes-openrouter-google-gemma-4-31b-it-free-chutes-high-clean"]);
  assert.deepEqual(selected.unsupported.map((item) => item.model), ["google/lyria-3-pro-preview"], "the moved model is not excluded as a clash");
  // A hand-written entry keeps its id: a spec that names it by hash resolves to it as it is.
  const existing = await resolveConfigurationSpec(catalog, "hermes:openrouter/anthropic/claude-opus-5.5@high", { env });
  assert.equal(existing.entries[0].configuration.id, "hermes-openrouter-opus-5-5-high-clean");
});

test("a spec or selector on any key route resolves through the route template; a route Kitchen cannot proxy says why", async (t) => {
  const { env } = await discoveryEnv(t);
  const catalog = await loadCatalog(repoRoot);
  const now = () => new Date("2026-11-09T12:00:00Z");
  const one = await resolveConfigurationSpec(catalog, "hermes:opencode-go/glm-5.3@high", { env, now });
  const [entry] = one.entries;
  assert.equal(entry.status, "materialize");
  const glm = entry.configuration;
  assert.deepEqual([glm.id, glm.label, glm.provider, glm.model, glm.reasoningEffort], ["hermes-opencode-go-glm-5-3-high-clean", "GLM-5.3 · High · via Hermes · clean (OpenCode Go)", "z-ai", "glm-5.3", "high"]);
  assert.deepEqual([glm.executionProfile.id, glm.executionProfile.route, glm.executionProfile.environment, glm.executionProfile.upstream], ["hermes-linux-host-clean-route-v1", "opencode-go", "clean", undefined]);
  assert.deepEqual(glm.materialized, { template: "hermes-route-clean", spec: "hermes:opencode-go/glm-5.3@high:clean", at: "2026-11-09T12:00:00.000Z", contextLength: 200000, source: "hermes:provider_models_cache.json" });
  assert.deepEqual(materializedProblems(glm), []);
  assert.match(materializedProblems({ ...glm, materialized: { ...glm.materialized, spec: "hermes:nous/glm-5.3@high:clean" } }).join(";"), /does not name this configuration/);
  assert.doesNotThrow(() => resolveHarnessAdapter(glm));
  assert.equal(hermesRoute(glm).auth, KEY_PROXY_AUTH);
  // A model nobody has a maker for keeps the route as its provider: the route is all Kitchen knows of where it comes from.
  const free = await resolveConfigurationSpec(catalog, "hermes:opencode-go/*@auto+free", { env, now });
  assert.deepEqual(free.entries.map((item) => [item.configuration.id, item.configuration.provider, item.configuration.reasoningEffort, item.configuration.materialized.free]), [["hermes-opencode-go-beam-free-high-clean", "opencode-go", "high", true]]);
  const all = await resolveConfigurationSpec(catalog, "hermes:opencode-go/*@auto", { env, now });
  assert.deepEqual(all.unsupported, [{ model: "mimo-v2.5", reason: "no tool calling, which Hermes's file and terminal tools need" }]);
  await assert.rejects(resolveConfigurationSpec(catalog, "hermes:opencode-go/nothing@high", { env }), /Hermes lists no nothing on the opencode-go route/);
  await assert.rejects(resolveConfigurationSpec(catalog, "hermes:opencode-go/glm-5.3@high", { env, upstream: "z-ai" }), /--upstream applies only to the OpenRouter route/);
  await assert.rejects(resolveConfigurationSpec(catalog, "hermes:nous/x-ai/grok-4.7@high", { env }), /nous.*OAuth/);
  await assert.rejects(resolveConfigurationSpec(catalog, "hermes:opencode-go/glm-5.3@high:snapshot", { env }), /No configuration template for hermes on the opencode-go route in the snapshot environment/);
});

test("a Menu that declares its configurations is cooked with them when no --config is given", async (t) => {
  const { env } = await discoveryEnv(t);
  const root = await fixtureRepository(t);
  const recipe = JSON.parse(await readFile(path.join(root, "catalog", "recipes", "ui-visual", "responsive-product-launch", "recipe.json"), "utf8"));
  const menu = { schemaVersion: 1, id: "free-launch", title: "Free models launch a product", summary: "One launch page, every free model.", cuisines: recipe.cuisines, recipes: [recipe.id], configurations: ["hermes:openrouter/google/*@auto+free", "hermes-openrouter-opus-5-5-high-clean"] };
  await writeFile(path.join(root, "catalog", "menus", "free-launch.json"), `${JSON.stringify(menu, null, 2)}\n`);
  const planned = await plan(root, { menuId: "free-launch", env });
  assert.deepEqual(planned.configurations, menu.configurations);
  assert.deepEqual(planned.plans.map((item) => item.configuration), menu.configurations);
  assert.deepEqual(planned.plans[0].configurationSpec.configurations.map((item) => item.id), ["hermes-openrouter-google-gemma-4-31b-it-free-google-ai-studio-high-clean"]);
  assert.equal(planned.plans[1].variant.id, "hermes-openrouter-opus-5-5-high-clean");
  const before = await readFile(path.join(root, "catalog", "configurations.json"), "utf8");
  const dry = await cook(root, { menuId: "free-launch", env, intent: "fill-missing" });
  assert.equal(dry.mode, "dry-run");
  assert.deepEqual(dry.cooks.map((item) => item.configuration), menu.configurations);
  assert.equal(dry.cooks[0].cooks[0].planned.length, 1);
  assert.equal(await readFile(path.join(root, "catalog", "configurations.json"), "utf8"), before, "a dry run writes nothing");
  // An explicit --config still wins, and a Menu that declares none needs one.
  assert.equal((await plan(root, { menuId: "free-launch", configurationId: "hermes-openrouter-opus-5-5-high-clean", env })).variant.id, "hermes-openrouter-opus-5-5-high-clean");
  await assert.rejects(plan(root, { menuId: "standard-web", env }), /Menu standard-web declares no configurations; name one with --config/);
});
