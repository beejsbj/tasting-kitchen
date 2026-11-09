import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { refusalIn } from "./faults.mjs";
import { KEY_PROXY_AUTH } from "./key-proxy.mjs";
import { underTestRunner } from "./runtime-root.mjs";
import { OPENROUTER_BASE_URL, OPENROUTER_EFFORTS, OPENROUTER_ROUTE, OPENROUTER_UPSTREAMS, isPinnedUpstream, openRouterProviderPin, requireOpenRouterKey } from "./openrouter.mjs";

/**
 * Direct API: the model with no harness around it.
 *
 * No system prompt, no tools, no workspace. Each Recipe turn is one HTTP
 * request carrying the whole conversation so far (the opening instructions and
 * prompt as the first user message, then every earlier reply and prompt), so a
 * staged Recipe is a real multi-turn conversation. It is the baseline every
 * harness is measured against, which is also why it serves only Recipes that
 * need no capabilities and mount no files.
 *
 * Each turn's raw evidence is one JSONL file: the request (without the key) and
 * the response. The observed model is the response's own `model` field.
 *
 * Under the runner, requests go through the attempt's key proxy (key-proxy.mjs),
 * like every bearer-key route, so the key lives only in the proxy; the recorded
 * endpoint is the upstream the proxy forwards to.
 */

export const DIRECT_API_VERSION = "kitchen-direct-api/1";
export const DIRECT_API_EFFORTS = OPENROUTER_EFFORTS;
const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;
const CONVERSATION_PATTERN = /^direct_[0-9a-f-]{36}$/u;

// The route is part of what is tasted, so it lives in the execution profile.
const ROUTES = {
  [OPENROUTER_ROUTE]: { route: OPENROUTER_ROUTE, endpoint: `${OPENROUTER_BASE_URL}/chat/completions` },
};

function requiredString(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} must be a non-empty string`);
  return value;
}

export function directApiRoute(variant) {
  const route = ROUTES[variant?.executionProfile?.route];
  if (!route) throw new Error(`Direct API execution profile has no known route: ${variant?.executionProfile?.route}`);
  return route;
}

/** The exact request body for one turn. The whole conversation travels every time. */
export function buildDirectApiRequest({ variant, messages }) {
  if (!variant || variant.harness !== "direct-api") throw new Error("Direct API adapter requires a direct-api configuration");
  if (!DIRECT_API_EFFORTS.includes(variant.reasoningEffort)) throw new Error(`Direct API reasoning effort must be one of ${DIRECT_API_EFFORTS.join(", ")}`);
  if (!Array.isArray(messages) || messages.length === 0 || messages.at(-1).role !== "user") throw new Error("Direct API request must end with a user message");
  return {
    model: requiredString(variant.model, "variant.model"),
    messages: messages.map(({ role, content }) => ({ role, content })),
    reasoning: { effort: variant.reasoningEffort },
    // Only the pinned upstream may serve it, with no fallbacks, and only if it honours
    // every parameter (the effort above). No prompt transform may rewrite the conversation.
    provider: { ...openRouterProviderPin(variant.executionProfile?.upstream), require_parameters: true },
    transforms: [],
    usage: { include: true },
    stream: false,
  };
}

/** The assistant's text from a chat-completions response body, or a thrown reason. */
export function directApiReply(body) {
  if (!body || typeof body !== "object") throw new Error("Direct API response is not a JSON object");
  if (body.error) throw new Error(`Direct API reported an error: ${typeof body.error === "object" ? body.error.message ?? body.error.code ?? "unknown" : body.error}`);
  const choices = Array.isArray(body.choices) ? body.choices : [];
  if (choices.length !== 1) throw new Error(`Direct API response held ${choices.length} choices; expected exactly one`);
  const [choice] = choices;
  if (choice.error) throw new Error(`Direct API choice failed: ${choice.error.message ?? choice.error.code ?? "unknown"}`);
  if (choice.finish_reason === "length") throw new Error("Direct API response was cut off at the output limit");
  if (choice.finish_reason !== "stop") throw new Error(`Direct API response did not end normally (finish_reason ${choice.finish_reason ?? "absent"})`);
  const content = choice.message?.content;
  const text = typeof content === "string" ? content
    : Array.isArray(content) ? content.filter((part) => part?.type === "text" && typeof part.text === "string").map((part) => part.text).join("")
      : null;
  if (typeof text !== "string" || text.trim() === "") throw new Error("Direct API response has no assistant text");
  if (typeof body.model !== "string" || body.model.trim() === "") throw new Error("Direct API response does not name the model that served it");
  return text;
}

/** Parse one turn's evidence file: exactly one request, then exactly one response. */
export function parseDirectApiJsonl(text) {
  if (typeof text !== "string") throw new TypeError("Direct API evidence must be a string");
  const events = text.split(/\r?\n/u).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); }
    catch (error) { throw new Error(`Invalid Direct API JSONL on line ${index + 1}: ${error.message}`); }
  });
  const requests = events.filter((event) => event?.type === "request");
  const responses = events.filter((event) => event?.type === "response");
  if (requests.length !== 1 || responses.length !== 1) throw new Error(`Direct API evidence held ${requests.length} requests and ${responses.length} responses; expected one of each`);
  const [request] = requests;
  const [response] = responses;
  if (events.indexOf(request) > events.indexOf(response)) throw new Error("Direct API response appeared before its request");
  if (!CONVERSATION_PATTERN.test(request.conversationId ?? "")) throw new Error("Direct API request lacks a valid conversation id");
  if (!Number.isInteger(response.status) || response.status < 200 || response.status >= 300) throw new Error(`Direct API returned HTTP ${response.status}`);
  const finalMessage = directApiReply(response.body);
  return { events, request, response, threadId: request.conversationId, model: response.body.model, finalMessage, usage: response.body.usage ?? null };
}

/**
 * The served model matches the request when it is the same slug, or that slug
 * with a release-date suffix (a route may report the dated snapshot it served).
 */
export function directApiModelsEquivalent(requested, observed) {
  if (requested === observed) return true;
  if (typeof requested !== "string" || typeof observed !== "string" || !observed.startsWith(`${requested}-`)) return false;
  return /^(?:\d{8}|\d{4}-\d{2}-\d{2}|\d{4})$/u.test(observed.slice(requested.length + 1));
}

/**
 * The provider that served a response: its top-level `provider`, and the selected
 * endpoint of OpenRouter's documented `openrouter_metadata`. Both are read; if they
 * disagree, or neither is present, no upstream is observed.
 */
export function observedUpstream(body) {
  const named = [body?.provider, body?.openrouter_metadata?.endpoints?.available?.find((endpoint) => endpoint?.selected === true)?.provider]
    .filter((name) => typeof name === "string" && name !== "");
  return named.length > 0 && named.every((name) => name === named[0]) ? named[0] : null;
}

function upstreamLabel(upstream) {
  return typeof upstream === "string" && upstream ? upstream : "an unreported provider";
}

/** The response came from the requested model through the pinned upstream: only then is its refusal the model's. */
function servedAsPinned(variant, body) {
  return directApiModelsEquivalent(variant.model, body?.model) && isPinnedUpstream(variant.executionProfile?.upstream, observedUpstream(body));
}

export class DirectApiExecutionError extends Error {
  constructor(message, result, options) {
    super(message, options);
    this.name = "DirectApiExecutionError";
    this.result = result;
  }
}

/** POST one JSON body. No retries: a retry is a second paid call, so failure stays visible. */
export async function postJson(url, body, { apiKey, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = globalThis.fetch } = {}) {
  // Mirrors the key proxy's guard: with the real fetch, a test can send nothing to a real provider.
  if (fetchImpl === globalThis.fetch && underTestRunner() && new URL(url).hostname !== "127.0.0.1") throw new Error(`Refusing a real request to ${new URL(url).origin} under the test runner; use a loopback fake or fetchImpl`);
  let response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", "x-title": "Tasting Kitchen" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    // The key is only in the header; the message names the URL and cause alone.
    throw new Error(`Direct API request to ${url} failed: ${error?.name === "TimeoutError" ? `no response within ${timeoutMs} ms` : error?.message ?? "unknown error"}`, { cause: error });
  }
  const text = await response.text();
  let parsed;
  try { parsed = JSON.parse(text); }
  catch { parsed = { error: { message: `non-JSON body (${text.length} bytes)` } }; }
  return { status: response.status, body: parsed };
}

function timeoutFrom(env) {
  const raw = env.TASTE_DIRECT_API_TIMEOUT_MS ?? process.env.TASTE_DIRECT_API_TIMEOUT_MS;
  const value = raw === undefined ? DEFAULT_TIMEOUT_MS : Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error("TASTE_DIRECT_API_TIMEOUT_MS must be a positive integer");
  return value;
}

/** The conversation so far for turn `index`: each turn's prompt and every earlier reply. */
function conversationMessages(recipe, replies, index) {
  const messages = [];
  for (let turn = 0; turn <= index; turn += 1) {
    const content = requiredString(recipe.turns[turn]?.content, `recipe.turns[${turn}].content`);
    messages.push({ role: "user", content: turn === 0 ? `${requiredString(recipe.setup?.instructions, "recipe.setup.instructions")}\n\n${content}` : content });
    if (turn < index) messages.push({ role: "assistant", content: replies[turn] });
  }
  return messages;
}

function invocation(endpoint, body) {
  return ["POST", endpoint, `model=${body.model}`, `reasoning.effort=${body.reasoning.effort}`, `messages=${body.messages.length}`];
}

/**
 * Run every Recipe turn as one conversation. The runner passes the attempt's
 * key `proxy`; `endpoint` and `fetchImpl` exist for tests against a fake server.
 */
export async function runDirectApiSession({ variant, recipe, privateDir, env = {}, endpoint, fetchImpl, onPlan, proxy = null } = {}) {
  if (!Array.isArray(recipe?.turns) || recipe.turns.length === 0) throw new TypeError("recipe.turns must be a non-empty array");
  if (typeof privateDir !== "string" || !path.isAbsolute(privateDir)) throw new TypeError("privateDir must be an absolute path");
  const route = directApiRoute(variant);
  // Through the proxy, the request reaches its loopback URL, but the endpoint on record is the upstream it forwards to.
  const recordedEndpoint = proxy ? `${proxy.upstream}/chat/completions` : (endpoint ?? route.endpoint);
  const url = proxy ? `${proxy.baseUrl}/chat/completions` : recordedEndpoint;
  const apiKey = proxy ? proxy.token : requireOpenRouterKey(env, "Direct API");
  const timeoutMs = timeoutFrom(env);
  const conversationId = `direct_${randomUUID()}`;
  const replies = [];
  const turns = [];
  let observedModel = null;
  let failure = null;
  for (const [index, turn] of recipe.turns.entries()) {
    const turnId = requiredString(turn?.id, `recipe.turns[${index}].id`);
    requiredString(turn?.content, `recipe.turns[${index}].content`);
    const body = buildDirectApiRequest({ variant, messages: conversationMessages(recipe, replies, index) });
    const turnDir = path.join(privateDir, "turns", `${String(index + 1).padStart(3, "0")}-${turnId}`);
    const paths = { events: path.join(turnDir, "exchange.jsonl"), stderr: path.join(turnDir, "error.txt"), final: path.join(turnDir, "final.txt") };
    const argv = invocation(recordedEndpoint, body);
    if (onPlan) await onPlan({ turnId, argv, eventsPath: paths.events, stderrPath: paths.stderr, finalPath: paths.final, threadId: conversationId });
    await mkdir(turnDir, { recursive: true });
    const request = { type: "request", conversationId, endpoint: recordedEndpoint, body };
    let response = null;
    try {
      const reply = await postJson(url, body, { apiKey, timeoutMs, fetchImpl });
      response = { type: "response", status: reply.status, body: reply.body };
      await writeFile(paths.events, `${JSON.stringify(request)}\n${JSON.stringify(response)}\n`, "utf8");
      const parsed = parseDirectApiJsonl(`${JSON.stringify(request)}\n${JSON.stringify(response)}\n`);
      if (observedModel !== null && parsed.model !== observedModel) throw new Error(`Direct API served ${parsed.model} after ${observedModel} in the same conversation`);
      // Stop at the first turn that is not the pinned model and upstream: later turns would be paid for nothing.
      if (!directApiModelsEquivalent(variant.model, parsed.model)) throw new Error(`model requested ${variant.model}, served ${parsed.model}`);
      if (!isPinnedUpstream(variant.executionProfile.upstream, observedUpstream(parsed.response.body))) throw new Error(`upstream pinned to ${OPENROUTER_UPSTREAMS[variant.executionProfile.upstream]}, served by ${upstreamLabel(observedUpstream(parsed.response.body))}`);
      observedModel = parsed.model;
      await writeFile(paths.final, parsed.finalMessage, "utf8");
      replies.push(parsed.finalMessage);
      turns.push({ turnId, argv, eventsPath: paths.events, stderrPath: paths.stderr, finalPath: paths.final, events: parsed.events, finalMessage: parsed.finalMessage, usage: parsed.usage });
    } catch (error) {
      if (!response) await writeFile(paths.events, `${JSON.stringify(request)}\n`, "utf8");
      await writeFile(paths.stderr, `${error.message}\n`, "utf8");
      turns.push({ turnId, argv, eventsPath: paths.events, stderrPath: paths.stderr, finalPath: paths.final, events: [], finalMessage: null, usage: null });
      // A response that carries the model's own refusal is the one turn failure that is the model's.
      failure = { turnId, message: error.message, exitCode: null, signal: null, httpStatus: response?.status ?? null, ...(response && refusalIn([response]) && servedAsPinned(variant, response.body) ? { chefFault: "refused" } : {}) };
      break;
    }
  }
  return { threadId: conversationId, cliVersion: DIRECT_API_VERSION, observedModel, turns, failure };
}

export async function prepareDirectApiAttempt({ variant, env = {} } = {}) {
  directApiRoute(variant);
  requireOpenRouterKey(env, "Direct API");
}

export function directApiRequestedExecution(variant) {
  const route = directApiRoute(variant);
  return { route: route.route, endpoint: route.endpoint, upstreamPin: variant.executionProfile.upstream, providerAuth: KEY_PROXY_AUTH, systemPrompt: "none", tools: "none", conversation: "resent-each-turn" };
}

export function reconstructDirectApiTurn(eventsText) {
  return parseDirectApiJsonl(eventsText);
}

/**
 * Verify every turn from its own request and response: one conversation, the
 * pinned model and effort in every request, each request replaying the earlier
 * replies exactly, and one served model throughout.
 */
export async function verifyDirectApiIdentity({ variant, cliVersion, result, endpoint, recipe } = {}) {
  if (!Array.isArray(recipe?.turns) || recipe.turns.length !== result?.turns?.length) throw new Error("Direct API identity requires the recipe whose turns were sent");
  if (result?.failure) throw new Error("Direct API execution contains a failed turn");
  if (!CONVERSATION_PATTERN.test(result?.threadId ?? "")) throw new Error("Direct API identity requires a valid conversation id");
  if (!Array.isArray(result.turns) || result.turns.length === 0) throw new Error("Direct API identity requires evidence for every turn");
  if (result.cliVersion !== cliVersion || cliVersion !== DIRECT_API_VERSION) throw new Error(`Direct API version evidence mismatch: ${cliVersion} versus ${result.cliVersion}`);
  const route = directApiRoute(variant);
  const expectedEndpoint = endpoint ?? route.endpoint;
  const mismatches = [];
  const replies = [];
  const upstreams = new Set();
  const pin = variant.executionProfile?.upstream;
  let observed = null;
  for (const [index, turn] of result.turns.entries()) {
    const parsed = parseDirectApiJsonl((turn.events ?? []).map((event) => JSON.stringify(event)).join("\n"));
    const { body } = parsed.request;
    if (parsed.threadId !== result.threadId) mismatches.push(`turn ${turn.turnId} belongs to conversation ${parsed.threadId}`);
    if (parsed.request.endpoint !== expectedEndpoint) mismatches.push(`endpoint requested ${expectedEndpoint}, recorded ${parsed.request.endpoint}`);
    if (body.model !== variant.model) mismatches.push(`model requested ${variant.model}, sent ${body.model}`);
    if (body.reasoning?.effort !== variant.reasoningEffort) mismatches.push(`effort requested ${variant.reasoningEffort}, sent ${body.reasoning?.effort ?? "none"}`);
    // The recorded request must be exactly the one the recipe and the earlier replies call for: no other prompt, system message, tool or sampling parameter.
    if (!isDeepStrictEqual(body, buildDirectApiRequest({ variant, messages: conversationMessages(recipe, replies, index) }))) mismatches.push(`turn ${turn.turnId} request is not the recipe's conversation so far`);
    if (body.messages.length !== index * 2 + 1) mismatches.push(`turn ${turn.turnId} sent ${body.messages.length} messages, not the ${index * 2 + 1} of the conversation so far`);
    for (const [reply, text] of replies.entries()) {
      const sent = body.messages[reply * 2 + 1];
      if (sent?.role !== "assistant" || sent.content !== text) mismatches.push(`turn ${turn.turnId} did not replay reply ${reply + 1} exactly`);
    }
    if (turn.finalMessage !== parsed.finalMessage) mismatches.push(`turn ${turn.turnId} final message does not match its response`);
    if (!directApiModelsEquivalent(variant.model, parsed.model)) mismatches.push(`model requested ${variant.model}, served ${parsed.model}`);
    if (observed !== null && parsed.model !== observed) mismatches.push(`served ${parsed.model} after ${observed}`);
    observed = parsed.model;
    const upstream = observedUpstream(parsed.response.body);
    if (typeof upstream === "string") upstreams.add(upstream);
    if (!isDeepStrictEqual(body.provider, { ...openRouterProviderPin(pin), require_parameters: true })) mismatches.push(`turn ${turn.turnId} did not send the upstream pin ${pin}`);
    if (!isPinnedUpstream(pin, upstream)) mismatches.push(`upstream pinned to ${OPENROUTER_UPSTREAMS[pin]}, served by ${upstreamLabel(upstream)}`);
    replies.push(parsed.finalMessage);
  }
  if (mismatches.length) throw new Error(`Effective Direct API identity mismatch: ${[...new Set(mismatches)].join("; ")}`);
  return {
    model: observed,
    provider: variant.provider,
    route: route.route,
    endpoint: expectedEndpoint,
    // The pinned upstream, and the host OpenRouter reported for each turn (verified equal).
    upstreamPin: pin,
    upstreamProviders: [...upstreams],
    reasoningEffort: variant.reasoningEffort,
    reasoningEffortEvidence: "request-body",
    personality: variant.personality,
    serviceTier: variant.serviceTier,
    requestedServiceTier: variant.serviceTier,
    serviceTierEvidence: "requested-default",
    environment: "clean",
    turns: result.turns.length,
    verifiedBy: "direct-api-response-model",
  };
}
