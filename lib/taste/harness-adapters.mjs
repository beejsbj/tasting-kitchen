import { readdir, stat, symlink } from "node:fs/promises";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";

import { buildClaudeTurnArgs, CLAUDE_CODE_EFFORTS, claudeRequestedExecution, cleanupClaudeAttempt, currentClaudeSetupDigest, parseClaudeJsonl, prepareClaudeAttempt, runClaudeSession, verifyClaudeIdentity } from "./claude-code.mjs";
import { buildCodexTurnArgs, codexLiveHome, codexRequestedExecution, codexUserHome, parseCodexJsonl, prepareCodexLiveAttempt, runCodexSession } from "./codex.mjs";
import { buildCursorTurnArgs, cursorEnv, cursorModelsEquivalent, cursorRequestedExecution, parseCursorJsonl, runCursorSession, verifyCursorIdentity } from "./cursor.mjs";
import { ensurePrivateDirectory } from "./files.mjs";
import {
  HERMES_EFFORTS, HERMES_MODELS, buildHermesTurnArgs, cleanupHermesAttempt, currentHermesSetupDigest, hermesRequestedExecution, hermesRoute, prepareHermesAttempt,
  reconstructHermesTurn, runHermesSession, verifyHermesIdentity,
} from "./hermes.mjs";
import { verifyObservedIdentity } from "./identity.mjs";
import { ENVIRONMENT_TOGGLES, ENVIRONMENTS, NEVER_LIVE_PROFILES, PERSONAL_ENVIRONMENTS, TOGGLE_VALUES } from "./environments.mjs";
import {
  DIRECT_API_EFFORTS, directApiModelsEquivalent, directApiRequestedExecution, prepareDirectApiAttempt,
  reconstructDirectApiTurn, runDirectApiSession, verifyDirectApiIdentity,
} from "./direct-api.mjs";
import { assertOpenRouterModel, OPENROUTER_ROUTE, openRouterKeyProxy } from "./openrouter.mjs";
import { KEY_PROXY_AUTH } from "./key-proxy.mjs";
import { cleanupT3Attempt, prepareT3Attempt, reconstructT3Turn, runT3Session, T3_INNER, t3Inner, t3RequestedExecution, verifyT3Identity } from "./t3.mjs";

const CAPABILITIES = ["files", "shell"];
/** The model alone: no tools, so no capability a Recipe could require. */
const NO_CAPABILITIES = [];

export { ENVIRONMENTS, isPersonalEnvironment } from "./environments.mjs";

/** Execution-profile keys a configuration may carry beyond the fixed ones a profile pins. */
export const OPTIONAL_PROFILE_KEYS = ["environment", "harnessProfile", "route", "upstream", ...ENVIRONMENT_TOGGLES];

/**
 * Each harness lists the execution profiles it can honour; a configuration must match one exactly.
 * Every Run cooks outside the Kitchen repo (runtime-root.mjs). Environment is enforced, not a label:
 * a profile declares the one environment its adapter truly implements (or none), and `offers` lists
 * the toggle values the harness can actually honour. Codex declares `clean` for a fresh CODEX_HOME
 * and HOME; its original profile keeps the real HOME and declares no environment, so its
 * configurations and Dishes keep their hashes. Cursor's original profile declares none: it runs with
 * the real home, and account-level rules can reach it from the server with the login. Live is offered
 * wherever it means something: Claude Code, Codex, Cursor Agent and Hermes (named profiles only, and
 * never `rose`). Hermes `rose` stays snapshot-only; T3 offers no live, since that would be his real
 * app and threads. `offers.harnessProfile` marks a live profile that names a harness profile.
 */
const BOTH = ["on", "off"];
const CLAUDE_CODE_BASE = {
  runtime: "linux-host", sandbox: "disabled", approvalPolicy: "bypass-permissions", nativeWeb: "disabled",
  networkPolicy: "not-enforced", filesystemBoundary: "not-a-secrecy-boundary",
};
const HERMES_BASE = {
  runtime: "linux-host", sandbox: "disabled", approvalPolicy: "yolo", nativeWeb: "disabled",
  networkPolicy: "not-enforced", filesystemBoundary: "not-a-secrecy-boundary",
};
const PROFILES = {
  "codex-cli": [{
    id: "codex-linux-host-unsandboxed-v1", label: "via Codex CLI · host-unsandboxed fallback",
    runtime: "linux-host", sandbox: "danger-full-access", approvalPolicy: "never", nativeWeb: "disabled",
    networkPolicy: "not-enforced", filesystemBoundary: "not-a-secrecy-boundary",
  }, {
    id: "codex-linux-host-clean-v1", label: "via Codex CLI · clean", environment: "clean",
    runtime: "linux-host", sandbox: "danger-full-access", approvalPolicy: "never", nativeWeb: "disabled",
    networkPolicy: "not-enforced", filesystemBoundary: "not-a-secrecy-boundary",
  }, {
    id: "codex-linux-host-live-v1", label: "via Codex CLI · live", environment: "live", offers: { memory: BOTH, connections: BOTH },
    runtime: "linux-host", sandbox: "danger-full-access", approvalPolicy: "never", nativeWeb: "disabled",
    networkPolicy: "not-enforced", filesystemBoundary: "not-a-secrecy-boundary",
  }],
  "cursor-agent": [{
    id: "cursor-linux-host-unsandboxed-v1", label: "via Cursor Agent · host-unsandboxed",
    runtime: "linux-host", sandbox: "disabled", approvalPolicy: "force", nativeWeb: "not-enforced",
    networkPolicy: "not-enforced", filesystemBoundary: "not-a-secrecy-boundary",
  }, {
    // Cursor has no switch for its memory, and approval only gates a workspace's own MCP servers: his ~/.cursor/mcp.json
    // servers and plugins load whatever Kitchen does. So live offers memory and connections `on` only, and the Cook must pass --allow-connections.
    id: "cursor-linux-host-live-v1", label: "via Cursor Agent · live", environment: "live", offers: { memory: ["on"], connections: ["on"] },
    runtime: "linux-host", sandbox: "disabled", approvalPolicy: "force", nativeWeb: "not-enforced",
    networkPolicy: "not-enforced", filesystemBoundary: "not-a-secrecy-boundary",
  }],
  // All run unsandboxed on the host with permissions bypassed; web tools are
  // withheld from the tool list, but shell network access is not blocked.
  "claude-code": [
    { id: "claude-code-linux-host-clean-v1", label: "via Claude Code · clean", environment: "clean", ...CLAUDE_CODE_BASE },
    { id: "claude-code-linux-host-snapshot-v1", label: "via Claude Code · snapshot", environment: "snapshot", offers: { memory: BOTH, connections: BOTH }, ...CLAUDE_CODE_BASE },
    { id: "claude-code-linux-host-live-v1", label: "via Claude Code · live", environment: "live", offers: { memory: BOTH, connections: BOTH }, ...CLAUDE_CODE_BASE },
  ],
  // The route (here Anthropic, reached through the borrowed Claude Code login or
  // the OpenRouter key) is part of the profile id and so of the hash.
  hermes: [
    { id: "hermes-linux-host-clean-anthropic-v1", label: "via Hermes · clean home · Anthropic route", ...HERMES_BASE, environment: "clean" },
    { id: "hermes-linux-host-snapshot-anthropic-v1", label: "via Hermes · profile snapshot · Anthropic route", ...HERMES_BASE, environment: "snapshot", offers: { memory: BOTH, connections: BOTH } },
    // Live runs a named profile in place, on the route that profile itself uses (OpenAI through its Codex login).
    // Hermes has no switch for memory alone, so live keeps it on; `connections` is whether the model is given his MCP and plugin tools.
    { id: "hermes-linux-host-live-openai-codex-v1", label: "via Hermes · live profile · OpenAI Codex route", ...HERMES_BASE, environment: "live", offers: { memory: ["on"], connections: BOTH, harnessProfile: true } },
    // A declared `route` names an inference route other than the provider's own.
    { id: "hermes-linux-host-clean-openrouter-v1", label: "via Hermes · clean home · OpenRouter route", ...HERMES_BASE, environment: "clean", route: OPENROUTER_ROUTE },
  ],
  // T3 wrapping a provider harness, on a throwaway T3 server per attempt. Web
  // is not enforced: Claude Code's WebFetch/WebSearch are denied in its home, but
  // Codex's web search is not switched off, and T3's own tool surface (its MCP
  // tools, a project clone, Claude's Agent tool) stays open.
  t3: [{
    id: "t3-linux-host-clean-v1", label: "via T3 · scratch server · clean inner home", environment: "clean",
    runtime: "linux-host", sandbox: "disabled", approvalPolicy: "full-access", nativeWeb: "not-enforced",
    networkPolicy: "not-enforced", filesystemBoundary: "not-a-secrecy-boundary",
  }],
  // No harness: the model answers plain HTTP turns with no tools and no workspace.
  "direct-api": [{
    id: "direct-api-openrouter-v1", label: "Direct API · OpenRouter route · no harness",
    runtime: "linux-host", sandbox: "no-tools", approvalPolicy: "no-tools", nativeWeb: "disabled",
    networkPolicy: "no-tools", filesystemBoundary: "no-workspace", environment: "clean", route: OPENROUTER_ROUTE,
  }],
};

/** Pure rule set: does `profile` match the profile `expected` that a harness declares? Throws a clear message if not. */
export function assertProfileMatch(harness, expected, profile) {
  const { offers = {}, ...pinned } = expected;
  // Enforced before anything else, so no profile id or harness can route around it.
  if (profile.environment === "live" && NEVER_LIVE_PROFILES.includes(profile.harnessProfile)) {
    throw new Error(`${harness} profile ${profile.harnessProfile} is never live: run it as a snapshot, which copies it without writing to it`);
  }
  for (const [key, value] of Object.entries(pinned)) {
    if (OPTIONAL_PROFILE_KEYS.includes(key)) continue;
    if (profile[key] !== value) throw new Error(`${harness} execution profile.${key} must be ${value}`);
  }
  if (profile.environment !== undefined && !ENVIRONMENTS.includes(profile.environment)) {
    throw new Error(`${harness} execution profile.environment must be one of ${ENVIRONMENTS.join(", ")}`);
  }
  if (profile.environment !== expected.environment) {
    throw new Error(expected.environment === undefined
      ? `${harness} execution profile ${expected.id} declares no environment, so a configuration must omit environment (got ${profile.environment})`
      : `${harness} execution profile.environment must be ${expected.environment}${profile.environment === undefined ? " (omitted)" : ` (got ${profile.environment})`}`);
  }
  if (profile.harnessProfile !== undefined && (typeof profile.harnessProfile !== "string" || !/^[a-z0-9][a-z0-9_-]*$/u.test(profile.harnessProfile))) {
    throw new Error(`${harness} execution profile.harnessProfile must be a plain profile name`);
  }
  if (profile.route !== expected.route) {
    throw new Error(expected.route === undefined
      ? `${harness} execution profile ${expected.id} uses the provider's own route, so a configuration must omit route (got ${profile.route})`
      : `${harness} execution profile.route must be ${expected.route}${profile.route === undefined ? " (omitted)" : ` (got ${profile.route})`}`);
  }
  // The upstream pin is per model, so the profile only says whether one is required.
  if (expected.route === undefined && profile.upstream !== undefined) throw new Error(`${harness} execution profile ${expected.id} has no route, so a configuration must omit upstream (got ${profile.upstream})`);
  const namesLiveProfile = profile.environment === "live" && offers.harnessProfile === true;
  if (profile.harnessProfile !== undefined && profile.environment !== "snapshot" && !namesLiveProfile) {
    throw new Error(`${harness} execution profile.harnessProfile requires the snapshot environment${expected.environment === "snapshot" ? "" : `, which ${expected.id} does not declare`}`);
  }
  // A personal environment states every toggle, and only values its harness can honour; clean and undeclared carry none.
  const personal = PERSONAL_ENVIRONMENTS.includes(profile.environment);
  for (const toggle of ENVIRONMENT_TOGGLES) {
    const value = profile[toggle];
    if (!personal) {
      if (value !== undefined) throw new Error(`${harness} execution profile.${toggle} applies only to the snapshot and live environments`);
      continue;
    }
    if (!TOGGLE_VALUES.includes(value)) throw new Error(`${harness} ${profile.environment} execution profile must set ${toggle} to on or off`);
    if (!(offers[toggle] ?? []).includes(value)) throw new Error(`${harness} ${profile.environment} execution profile cannot honour ${toggle} ${value}`);
  }
}

function matchProfile(harness, profile) {
  const allowed = PROFILES[harness] ?? [];
  const expected = allowed.find((candidate) => candidate.id === profile?.id);
  if (!expected) throw new Error(`${harness} execution profile.id must be one of ${allowed.map((candidate) => candidate.id).join(", ")}`);
  assertProfileMatch(harness, expected, profile);
}

function copyConfiguration(variant) {
  return {
    ...variant, capabilities: [...variant.capabilities], executionProfile: { ...variant.executionProfile },
    ...(variant.harnessPath !== undefined ? { harnessPath: [...variant.harnessPath] } : {}),
  };
}

/**
 * A harness path names layers outermost first: `["t3", "claude-code"]` is T3
 * wrapping Claude Code, driven through the outer layer's adapter. Absent means
 * the harness runs alone. A path is only valid when the outer adapter says it
 * can wrap exactly that inner path.
 */
export function assertHarnessPath(variant, adapter) {
  const harnessPath = variant.harnessPath;
  if (harnessPath === undefined) {
    if (adapter.requiresInner) throw new Error(`${variant.harness} wraps another harness, so a configuration must name its harnessPath`);
    return;
  }
  if (!Array.isArray(harnessPath) || harnessPath.length < 2 || harnessPath.some((layer) => typeof layer !== "string")) throw new Error("harnessPath must list at least an outer and an inner harness");
  if (harnessPath[0] !== variant.harness) throw new Error(`harnessPath must start with the configuration's harness ${variant.harness}`);
  if (new Set(harnessPath).size !== harnessPath.length) throw new Error("harnessPath must not repeat a harness");
  for (const layer of harnessPath) if (!adapters.has(layer)) throw new Error(`harnessPath names an unknown harness: ${layer}`);
  const inner = harnessPath.slice(1).join(">");
  if (!(adapter.wraps ?? []).includes(inner)) throw new Error(`${variant.harness} cannot wrap ${harnessPath.slice(1).join(" → ")}`);
}

function validateConfiguration(variant, harness) {
  if (!variant || variant.harness !== harness) throw new Error(`${harness} adapter requires a ${harness} configuration`);
  const expected = adapters.get(harness).capabilities;
  if (!Array.isArray(variant.capabilities) || JSON.stringify(variant.capabilities) !== JSON.stringify(expected)) {
    throw new Error(expected.length ? `${harness} adapter declares exactly ${expected.join(" and ")} capabilities` : `${harness} adapter declares no capabilities`);
  }
  matchProfile(harness, variant.executionProfile);
  assertHarnessPath(variant, adapters.get(harness));
  if (harness === "cursor-agent" && (variant.model !== "composer-2.5[fast=false]" || variant.reasoningEffort !== "adaptive" || variant.serviceTier !== "default" || variant.personality !== "default")) {
    throw new Error("cursor-agent adapter requires Composer 2.5 with fast=false, adaptive effort, default tier, and default personality");
  }
  if (harness === "claude-code") validateClaudeCodeConfiguration(variant);
  if (harness === "hermes") {
    const live = variant.executionProfile.environment === "live";
    if (variant.executionProfile.route === OPENROUTER_ROUTE) assertOpenRouterModel(variant, "hermes");
    // Live runs the model its profile uses, on the route the profile itself reaches it by (OpenAI through its Codex login).
    else if (live) {
      if (variant.provider !== "openai" || !/^gpt-[a-z0-9.-]+$/u.test(variant.model ?? "")) throw new Error("hermes live execution profile requires provider openai and a gpt-* model id");
    } else if (variant.provider !== "anthropic" || !HERMES_MODELS.includes(variant.model)) throw new Error(`hermes adapter requires an Anthropic model: ${HERMES_MODELS.join(", ")}`);
    if (!HERMES_EFFORTS.includes(variant.reasoningEffort)) throw new Error(`hermes reasoning effort must be one of ${HERMES_EFFORTS.join(", ")}`);
    if (variant.serviceTier !== "default" || variant.personality !== "none") throw new Error("hermes adapter requires the default tier and no personality");
    if ((variant.executionProfile.environment === "snapshot" || live) && variant.executionProfile.harnessProfile === undefined) {
      throw new Error(`hermes ${variant.executionProfile.environment} execution profile must name the harnessProfile it ${live ? "runs" : "copies"}`);
    }
  }
  if (harness === "t3") validateT3Configuration(variant);
  if (harness === "direct-api") {
    assertOpenRouterModel(variant, "direct-api");
    if (!DIRECT_API_EFFORTS.includes(variant.reasoningEffort)) throw new Error(`direct-api reasoning effort must be one of ${DIRECT_API_EFFORTS.join(", ")}`);
    if (variant.serviceTier !== "default" || variant.personality !== "none") throw new Error("direct-api adapter requires the default tier and no personality");
    if (variant.executionProfile.harnessProfile !== undefined) throw new Error("direct-api adapter has no harness profile");
  }
  return copyConfiguration(variant);
}

/**
 * What a model with no tools can be given: a conversation. Its Dish is the
 * runner-written session transcript, so the Recipe must mount no files, ask
 * for no artifact the model would have to write, and layer no skill in the workspace.
 */
function directApiRecipeSupport(recipe) {
  const reasons = [];
  if (recipe?.output?.kind !== "session") reasons.push(`direct-api serves only session Recipes; this one produces ${recipe?.output?.kind}`);
  if ((recipe?.setup?.fixtures ?? []).length) reasons.push("direct-api has no workspace to mount the recipe's fixtures in");
  return reasons;
}

/** A skill layer the harness cannot read is not a layer of this configuration. */
export function skillDeliverySupport(variant, skill) {
  if (!skill || skill.delivery === "prompt") return [];
  const adapter = adapters.get(variant?.harness);
  return adapter && !adapter.capabilities.includes("files") ? [`${variant.harness} cannot read a workspace skill layer; ${skill.id} must ride in the prompt`] : [];
}

function validateT3Configuration(variant) {
  const { inner, efforts } = t3Inner(variant);
  if (!efforts.includes(variant.reasoningEffort)) throw new Error(`t3 → ${inner} effort must be one of ${efforts.join(", ")}`);
  if (variant.serviceTier !== "default") throw new Error("t3 adapter requires the default service tier");
  if (variant.executionProfile.harnessProfile !== undefined) throw new Error("t3 adapter does not support a named harness profile");
  if (inner === "claude-code") {
    if (variant.provider !== "anthropic" || !/^claude-[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(variant.model ?? "")) throw new Error("t3 → claude-code requires provider anthropic and a full claude-* model id");
    if (variant.personality !== "default") throw new Error("t3 → claude-code requires the default personality");
  } else {
    if (variant.provider !== "openai" || !/^gpt-[a-z0-9.-]+$/u.test(variant.model ?? "")) throw new Error("t3 → codex-cli requires provider openai and a gpt-* model id");
    if (variant.personality !== "none") throw new Error("t3 → codex-cli requires no personality");
  }
}

function validateClaudeCodeConfiguration(variant) {
  if (variant.provider !== "anthropic") throw new Error("claude-code adapter requires provider anthropic");
  if (!/^claude-[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(variant.model ?? "")) throw new Error("claude-code adapter requires a full claude-* model id, not an alias");
  if (!CLAUDE_CODE_EFFORTS.includes(variant.reasoningEffort)) throw new Error(`claude-code adapter effort must be one of ${CLAUDE_CODE_EFFORTS.join(", ")}`);
  if (variant.serviceTier !== "default" || variant.personality !== "default") throw new Error("claude-code adapter requires the default service tier and default personality");
  if (variant.executionProfile.harnessProfile !== undefined) throw new Error("claude-code adapter does not support a named harness profile");
}

async function prepareCodexAttempt({ variant, codexHome, authPath, env = {}, executable, cwd }) {
  if (variant.executionProfile.environment === "live") return prepareCodexLiveAttempt({ variant, executable, env, cwd });
  const home = codexUserHome(variant, codexHome);
  if (home) {
    await ensurePrivateDirectory(home);
    if ((await readdir(home)).length !== 0) throw new Error("Fresh attempt home must start empty");
  }
  const authSource = authPath ?? env.TASTE_CODEX_AUTH_PATH ?? path.join(os.homedir(), ".codex", "auth.json");
  await ensurePrivateDirectory(codexHome);
  const source = path.resolve(authSource);
  let info;
  try { info = await stat(source); }
  catch (error) { throw new Error(`Codex auth source is unavailable: ${source}`, { cause: error }); }
  if (!info.isFile()) throw new Error(`Codex auth source is not a regular file: ${source}`);
  await symlink(source, path.join(codexHome, "auth.json"));
  const entries = await readdir(codexHome);
  if (entries.length !== 1 || entries[0] !== "auth.json") throw new Error("Fresh attempt Codex home may contain only auth.json before launch");
}

function reconstructCodexTurn(eventsText) {
  return parseCodexJsonl(eventsText);
}

function reconstructCursorTurn(eventsText) {
  return parseCursorJsonl(eventsText);
}

function reconstructClaudeTurn(eventsText) {
  return parseClaudeJsonl(eventsText);
}

async function prepareCursorAttempt({ variant, executable = "cursor-agent", env = {}, cwd = process.cwd(), preflightTimeoutMs = 10_000 }) {
  await new Promise((resolve, reject) => {
    const refuse = () => reject(new Error("Cursor authentication preflight failed; check the existing Cursor login before cooking"));
    execFile(executable, ["status", "--format", "json"], {
      cwd, env: cursorEnv(env, variant), shell: false, encoding: "utf8",
      timeout: preflightTimeoutMs, killSignal: "SIGKILL", maxBuffer: 64 * 1024,
    }, (error, stdout) => {
      if (error) return refuse();
      try {
        const status = JSON.parse(stdout);
        // Cursor exits zero even when logged out. Discard account details and
        // require its explicit credential-presence result; the model run still
        // has to authenticate remotely and pass observed-identity verification.
        if (status?.status !== "authenticated" || status.isAuthenticated !== true) return refuse();
        resolve();
      } catch {
        refuse();
      }
    });
  });
  // Live touches nothing: it runs in his real home, which the receipt says by its record.
  if (variant?.executionProfile?.environment === "live") {
    return { setup: { environment: "live", memory: variant.executionProfile.memory, connections: variant.executionProfile.connections, home: "real" } };
  }
}

/** Pure recipe/configuration gate shared by planning and immediate execution. */
export function compatibilityFor({ variant, recipe, allowStatuses = ["ready"] } = {}) {
  const reasons = [];
  const adapterReason = adapterSupport(variant);
  if (adapterReason) reasons.push(adapterReason);
  const recipeSupport = adapters.get(variant?.harness)?.recipeSupport;
  if (recipeSupport) reasons.push(...recipeSupport(recipe));
  const available = new Set(variant?.capabilities ?? []);
  const requiredCapabilities = [...new Set(recipe?.harness?.capabilities ?? [])].sort();
  const missingCapabilities = requiredCapabilities.filter((capability) => !available.has(capability));
  if (!new Set(allowStatuses).has(recipe?.status)) reasons.push(`recipe status is ${recipe?.status}, not an allowed runnable status`);
  for (const capability of missingCapabilities) reasons.push(`variant lacks required capability: ${capability}`);
  if (recipe?.harness?.web === "enabled" && variant?.executionProfile?.nativeWeb === "disabled") reasons.push("variant execution profile disables native web");
  if (recipe?.presentation !== undefined && recipe.presentation.profile !== "static-web-v1") reasons.push(`presentation profile ${recipe.presentation.profile} is not supported by Kitchen v1`);
  if (recipe?.presentation !== undefined && recipe.presentation.semanticRuntime !== null) reasons.push("presentation semantic runtime is not supported by Kitchen v1");
  return { supported: reasons.length === 0, reasons, requiredCapabilities, missingCapabilities };
}

const adapters = new Map([
  ["codex-cli", {
    harness: "codex-cli",
    capabilities: CAPABILITIES,
    validate: (variant) => validateConfiguration(variant, "codex-cli"),
    planTurn: buildCodexTurnArgs,
    executable: "codex",
    requestedExecution: codexRequestedExecution,
    prepareAttempt: prepareCodexAttempt,
    execute: runCodexSession,
    // A live Run's rollout is in his real home, not the attempt's.
    verifyIdentity: (options) => verifyObservedIdentity(options.variant?.executionProfile?.environment === "live" ? { ...options, codexHome: codexLiveHome(options.env) } : options),
    reconstructTurn: reconstructCodexTurn,
    modelsEquivalent: (left, right) => left === right,
  }],
  ["cursor-agent", {
    harness: "cursor-agent",
    capabilities: CAPABILITIES,
    validate: (variant) => validateConfiguration(variant, "cursor-agent"),
    planTurn: buildCursorTurnArgs,
    executable: "cursor-agent",
    requestedExecution: cursorRequestedExecution,
    prepareAttempt: prepareCursorAttempt,
    execute: runCursorSession,
    verifyIdentity: verifyCursorIdentity,
    reconstructTurn: reconstructCursorTurn,
    modelsEquivalent: cursorModelsEquivalent,
  }],
  ["claude-code", {
    harness: "claude-code",
    capabilities: CAPABILITIES,
    validate: (variant) => validateConfiguration(variant, "claude-code"),
    planTurn: buildClaudeTurnArgs,
    executable: "claude",
    homeDirectory: "claude-home",
    requestedExecution: claudeRequestedExecution,
    prepareAttempt: prepareClaudeAttempt,
    currentSetupDigest: currentClaudeSetupDigest,
    cleanupAttempt: cleanupClaudeAttempt,
    execute: runClaudeSession,
    verifyIdentity: verifyClaudeIdentity,
    reconstructTurn: reconstructClaudeTurn,
    modelsEquivalent: (left, right) => left === right,
  }],
  ["hermes", {
    harness: "hermes",
    capabilities: CAPABILITIES,
    validate: (variant) => validateConfiguration(variant, "hermes"),
    planTurn: buildHermesTurnArgs,
    executable: "hermes",
    requestedExecution: hermesRequestedExecution,
    prepareAttempt: prepareHermesAttempt,
    currentSetupDigest: currentHermesSetupDigest,
    cleanupAttempt: cleanupHermesAttempt,
    // A bearer-key route runs behind the runner's loopback key proxy: Hermes never holds the key.
    keyProxy: (variant, env) => hermesRoute(variant).auth === KEY_PROXY_AUTH ? openRouterKeyProxy(env, "Hermes") : null,
    execute: runHermesSession,
    verifyIdentity: verifyHermesIdentity,
    reconstructTurn: reconstructHermesTurn,
    modelsEquivalent: (left, right) => left === right,
  }],
  ["t3", {
    harness: "t3",
    capabilities: CAPABILITIES,
    wraps: Object.keys(T3_INNER),
    requiresInner: true,
    validate: (variant) => validateConfiguration(variant, "t3"),
    executable: "t3",
    homeDirectory: "t3-home",
    requestedExecution: t3RequestedExecution,
    prepareAttempt: prepareT3Attempt,
    cleanupAttempt: cleanupT3Attempt,
    execute: runT3Session,
    verifyIdentity: verifyT3Identity,
    reconstructTurn: reconstructT3Turn,
    modelsEquivalent: (left, right) => left === right,
  }],
  ["direct-api", {
    harness: "direct-api",
    capabilities: NO_CAPABILITIES,
    validate: (variant) => validateConfiguration(variant, "direct-api"),
    recipeSupport: directApiRecipeSupport,
    // No process: the version is the Kitchen's own client.
    executable: null,
    requestedExecution: directApiRequestedExecution,
    prepareAttempt: prepareDirectApiAttempt,
    keyProxy: (variant, env) => openRouterKeyProxy(env, "Direct API"),
    execute: runDirectApiSession,
    verifyIdentity: verifyDirectApiIdentity,
    reconstructTurn: reconstructDirectApiTurn,
    modelsEquivalent: directApiModelsEquivalent,
  }],
]);

/** Internal, fixed runner allowlist. Catalog data cannot install adapters or executables. */
export function getHarnessAdapter(harness) {
  const adapter = adapters.get(harness);
  if (!adapter) throw new Error(`Unsupported execution harness: ${String(harness)}`);
  return adapter;
}

/** Validate and copy configuration without touching credentials, disk, or a model process. */
export function resolveHarnessAdapter(variant) {
  const adapter = getHarnessAdapter(variant?.harness);
  return { adapter, variant: adapter.validate(variant) };
}

export function adapterSupport(variant) {
  try {
    resolveHarnessAdapter(variant);
    return null;
  } catch (error) {
    return error.message;
  }
}
