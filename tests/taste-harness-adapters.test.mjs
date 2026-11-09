import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { computeConfigHash, planSelection } from "../lib/taste/catalog.mjs";
import { OPTIONAL_PROFILE_KEYS, assertHarnessPath, assertProfileMatch, getHarnessAdapter, isPersonalEnvironment, resolveHarnessAdapter } from "../lib/taste/harness-adapters.mjs";

const profile = { id: "codex-linux-host-unsandboxed-v1", label: "via Codex CLI · host-unsandboxed fallback", runtime: "linux-host", sandbox: "danger-full-access", approvalPolicy: "never", nativeWeb: "disabled", networkPolicy: "not-enforced", filesystemBoundary: "not-a-secrecy-boundary" };
const variant = { id: "codex", provider: "openai", model: "gpt-5.6-sol", harness: "codex-cli", reasoningEffort: "high", serviceTier: "default", personality: "none", capabilities: ["files", "shell"], executionProfile: profile, configHash: "sha256:test" };
const recipe = { id: "r", version: "1.0.0", recipeHash: "sha256:r", status: "ready", harness: { web: "disabled", capabilities: [] } };
const UUID = "01901234-5678-7abc-8def-0123456789ab";

test("adapter boundary is allowlisted, copied, and planning visibly refuses invalid configurations", () => {
  const resolved = resolveHarnessAdapter(variant);
  assert.notEqual(resolved.variant, variant);
  assert.notEqual(resolved.variant.executionProfile, profile);
  assert.throws(() => resolveHarnessAdapter({ ...variant, harness: "anything-from-config" }), /Unsupported execution harness/);
  assert.throws(() => resolveHarnessAdapter({ ...variant, capabilities: ["files"] }), /declares exactly/);

  const catalog = { catalogHash: "sha256:catalog", configurations: [{ ...variant, harness: "anything-from-config" }], recipes: [recipe], cuisines: [] };
  const plan = planSelection(catalog, { configurationId: "codex", recipeIds: ["r"] });
  assert.equal(plan.supported.length, 0);
  assert.match(plan.unsupported[0].reasons.join("\n"), /Unsupported execution harness/);
});

test("Cursor auth preflight rejects logged-out exit-zero status and discards account output", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "taste-adapter-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const executable = path.join(root, "cursor");
  const preflight = (options = {}) => getHarnessAdapter("cursor-agent").prepareAttempt({ executable, cwd: root, ...options });
  const fake = async (body) => {
    await writeFile(executable, "#!" + process.execPath + "\n" +
      'if (JSON.stringify(process.argv.slice(2)) !== JSON.stringify(["status", "--format", "json"])) process.exit(99);\n' + body);
    await chmod(executable, 0o755);
  };
  await fake('console.log(JSON.stringify({status:"authenticated",isAuthenticated:true,userInfo:{email:"private@example.invalid"}}));');
  await preflight();
  for (const result of [
    { status: "unauthenticated", isAuthenticated: false },
    { status: "partially-authenticated", isAuthenticated: false },
    { status: "authenticated", isAuthenticated: "true" },
    { status: "unauthenticated", isAuthenticated: true },
  ]) {
    await fake('console.log(' + JSON.stringify(JSON.stringify({ ...result, userInfo: { email: "private@example.invalid" } })) + ');');
    await assert.rejects(preflight(), (error) => /authentication preflight/.test(error.message) && !error.message.includes("private@example.invalid"));
  }
  await fake('console.log("private invalid JSON");');
  await assert.rejects(preflight(), /authentication preflight/);
  await fake('setInterval(() => {}, 1000);');
  await assert.rejects(preflight({ preflightTimeoutMs: 50 }), /authentication preflight/);
  await assert.rejects(preflight({ executable: path.join(root, "missing") }), /authentication preflight/);
});

test("adapters expose pure fresh and exact-resume turn plans", () => {
  const codex = getHarnessAdapter("codex-cli");
  const freshCodex = codex.planTurn({ variant, recipe, workspace: "/tmp/work", finalPath: "/tmp/final" });
  const resumedCodex = codex.planTurn({ variant, recipe, workspace: "/tmp/work", finalPath: "/tmp/final", threadId: UUID });
  assert.equal(freshCodex.includes("resume"), false);
  assert.equal(resumedCodex[resumedCodex.indexOf("resume") + 1], UUID);
  const cursorVariant = { ...variant, provider: "cursor", model: "composer-2.5[fast=false]", harness: "cursor-agent", reasoningEffort: "adaptive", personality: "default", executionProfile: { id: "cursor-linux-host-unsandboxed-v1", label: "via Cursor Agent · host-unsandboxed", runtime: "linux-host", sandbox: "disabled", approvalPolicy: "force", nativeWeb: "not-enforced", networkPolicy: "not-enforced", filesystemBoundary: "not-a-secrecy-boundary" } };
  const freshCursor = getHarnessAdapter("cursor-agent").planTurn({ variant: cursorVariant, workspace: "/tmp/work", prompt: "cook" });
  const resumedCursor = getHarnessAdapter("cursor-agent").planTurn({ variant: cursorVariant, workspace: "/tmp/work", prompt: "correct", threadId: UUID });
  assert.equal(freshCursor.includes("--resume"), false);
  assert.equal(resumedCursor[resumedCursor.indexOf("--resume") + 1], UUID);
});

test("the original Codex and Cursor profiles declare no environment, so they reject clean, snapshot and live", () => {
  const withProfile = (extra) => ({ ...variant, executionProfile: { ...profile, ...extra } });
  assert.doesNotThrow(() => resolveHarnessAdapter(variant));
  assert.throws(() => resolveHarnessAdapter(withProfile({ environment: "clean" })), /declares no environment/);
  assert.throws(() => resolveHarnessAdapter(withProfile({ environment: "snapshot", harnessProfile: "rose", memory: "on", connections: "off" })), /declares no environment/);
  assert.throws(() => resolveHarnessAdapter(withProfile({ environment: "live", memory: "on", connections: "off" })), /declares no environment/);
  // The retired value is refused outright, not mistaken for either personal environment.
  assert.throws(() => resolveHarnessAdapter(withProfile({ environment: "personal" })), /environment must be one of clean, snapshot, live/);
  assert.throws(() => resolveHarnessAdapter(withProfile({ harnessProfile: "rose" })), /requires the snapshot environment/);
  assert.throws(() => resolveHarnessAdapter(withProfile({ memory: "on" })), /applies only to the snapshot and live environments/);
  assert.throws(() => resolveHarnessAdapter(withProfile({ id: "unknown-profile" })), /profile\.id must be one of/);
  const cursorProfile = { id: "cursor-linux-host-unsandboxed-v1", label: "via Cursor Agent · host-unsandboxed", runtime: "linux-host", sandbox: "disabled", approvalPolicy: "force", nativeWeb: "not-enforced", networkPolicy: "not-enforced", filesystemBoundary: "not-a-secrecy-boundary" };
  const cursor = { ...variant, provider: "cursor", model: "composer-2.5[fast=false]", harness: "cursor-agent", reasoningEffort: "adaptive", personality: "default" };
  assert.doesNotThrow(() => resolveHarnessAdapter({ ...cursor, executionProfile: cursorProfile }));
  assert.throws(() => resolveHarnessAdapter({ ...cursor, executionProfile: { ...cursorProfile, environment: "clean" } }), /declares no environment/);
  // Snapshot and live both carry his setup; clean and undeclared do not.
  assert.equal(isPersonalEnvironment(withProfile({ environment: "snapshot" })), true);
  assert.equal(isPersonalEnvironment(withProfile({ environment: "live" })), true);
  assert.equal(isPersonalEnvironment(withProfile({ environment: "clean" })), false);
  assert.equal(isPersonalEnvironment(variant), false);
});

test("Codex offers a clean profile beside its original one; it accepts exactly clean", () => {
  const cleanProfile = { ...profile, id: "codex-linux-host-clean-v1", label: "via Codex CLI · clean", environment: "clean" };
  assert.doesNotThrow(() => resolveHarnessAdapter({ ...variant, executionProfile: cleanProfile }));
  assert.throws(() => resolveHarnessAdapter({ ...variant, executionProfile: { ...cleanProfile, environment: undefined } }), /environment must be clean \(omitted\)/);
  assert.throws(() => resolveHarnessAdapter({ ...variant, executionProfile: { ...cleanProfile, environment: "snapshot" } }), /environment must be clean \(got snapshot\)/);
  assert.throws(() => resolveHarnessAdapter({ ...variant, executionProfile: { ...cleanProfile, sandbox: "workspace-write" } }), /sandbox must be danger-full-access/);
});

test("a profile that declares an environment accepts exactly that one, with exactly the toggles it can honour", () => {
  const both = ["on", "off"];
  const declared = (environment, offers) => ({ ...profile, ...(environment ? { environment } : {}), ...(offers ? { offers } : {}) });
  const config = (environment, extra = {}) => ({ ...profile, ...(environment ? { environment } : {}), ...extra });
  const toggles = { memory: "on", connections: "off" };
  const match = (expected, candidate) => assertProfileMatch("test-harness", expected, candidate);
  for (const key of ["environment", "harnessProfile", "memory", "connections"]) assert.ok(OPTIONAL_PROFILE_KEYS.includes(key), key);
  assert.doesNotThrow(() => match(declared("clean"), config("clean")));
  assert.throws(() => match(declared("clean"), config("snapshot", toggles)), /environment must be clean \(got snapshot\)/);
  assert.throws(() => match(declared("clean"), config()), /environment must be clean \(omitted\)/);
  assert.throws(() => match(declared("clean"), config("clean", { harnessProfile: "rose" })), /requires the snapshot environment/);
  // Clean has no memory or connections to switch.
  assert.throws(() => match(declared("clean"), config("clean", { memory: "off" })), /memory applies only to the snapshot and live/);
  const snapshot = declared("snapshot", { memory: both, connections: both });
  assert.doesNotThrow(() => match(snapshot, config("snapshot", { harnessProfile: "rose", ...toggles })));
  assert.doesNotThrow(() => match(snapshot, config("snapshot", { memory: "off", connections: "on" })));
  assert.throws(() => match(snapshot, config("snapshot", { harnessProfile: "../rose", ...toggles })), /plain profile name/);
  assert.throws(() => match(snapshot, config("snapshot", { connections: "off" })), /must set memory to on or off/);
  assert.throws(() => match(snapshot, config("snapshot", { memory: true, connections: "off" })), /must set memory to on or off/);
  assert.throws(() => match(snapshot, config("clean")), /environment must be snapshot/);
  // A harness that cannot switch something off does not offer that combination.
  const memoryAlwaysOn = declared("live", { memory: ["on"], connections: both });
  assert.doesNotThrow(() => match(memoryAlwaysOn, config("live", toggles)));
  assert.throws(() => match(memoryAlwaysOn, config("live", { memory: "off", connections: "off" })), /cannot honour memory off/);
  // A harness profile belongs to a snapshot, or to a live profile that declares it runs a named one in place.
  assert.throws(() => match(declared("live", { memory: both, connections: both }), config("live", { harnessProfile: "otto", ...toggles })), /requires the snapshot environment/);
  assert.doesNotThrow(() => match(declared("live", { memory: both, connections: both, harnessProfile: true }), config("live", { harnessProfile: "otto", ...toggles })));
  // Rose is never live, whichever profile or harness would run her.
  assert.throws(() => match(declared("live", { memory: both, connections: both, harnessProfile: true }), config("live", { harnessProfile: "rose", ...toggles })), /rose is never live/);
  assert.throws(() => match(declared("live", { memory: both, connections: both }), config("live", { harnessProfile: "rose", ...toggles })), /rose is never live/);
  assert.throws(() => match(declared("clean"), config("mine")), /must be one of clean, snapshot, live/);
  // Absent stays absent: a profile with no environment accepts only a configuration without one.
  assert.doesNotThrow(() => match(declared(), config()));
  assert.throws(() => match(declared(), config("clean")), /declares no environment/);
});

test("Hermes offers clean and snapshot only, and a snapshot must name the profile it copies; Claude Code offers live but no harness profile", () => {
  const hermesBase = { runtime: "linux-host", sandbox: "disabled", approvalPolicy: "yolo", nativeWeb: "disabled", networkPolicy: "not-enforced", filesystemBoundary: "not-a-secrecy-boundary" };
  const hermes = (executionProfile) => ({ id: "h", provider: "anthropic", model: "claude-opus-5-5", harness: "hermes", reasoningEffort: "high", serviceTier: "default", personality: "none", capabilities: ["files", "shell"], executionProfile });
  const snapshot = { id: "hermes-linux-host-snapshot-anthropic-v1", label: "via Hermes · profile snapshot · Anthropic route", ...hermesBase, environment: "snapshot", memory: "on", connections: "off" };
  assert.doesNotThrow(() => resolveHarnessAdapter(hermes({ ...snapshot, harnessProfile: "rose" })));
  assert.throws(() => resolveHarnessAdapter(hermes(snapshot)), /must name the harnessProfile it copies/);
  assert.throws(() => resolveHarnessAdapter(hermes({ ...snapshot, id: "hermes-linux-host-live-anthropic-v1", harnessProfile: "rose", environment: "live" })), /profile\.id must be one of/);
  assert.throws(() => resolveHarnessAdapter(hermes({ ...snapshot, id: "hermes-linux-host-personal-anthropic-v1", environment: "personal" })), /profile\.id must be one of/);
  const claudeBase = { runtime: "linux-host", sandbox: "disabled", approvalPolicy: "bypass-permissions", nativeWeb: "disabled", networkPolicy: "not-enforced", filesystemBoundary: "not-a-secrecy-boundary" };
  const claude = (executionProfile) => ({ id: "c", provider: "anthropic", model: "claude-opus-5-5", harness: "claude-code", reasoningEffort: "high", serviceTier: "default", personality: "default", capabilities: ["files", "shell"], executionProfile });
  const live = { id: "claude-code-linux-host-live-v1", label: "via Claude Code · live", ...claudeBase, environment: "live", memory: "off", connections: "on" };
  assert.doesNotThrow(() => resolveHarnessAdapter(claude(live)));
  assert.throws(() => resolveHarnessAdapter(claude({ ...live, id: "claude-code-linux-host-snapshot-v1", label: "via Claude Code · snapshot", environment: "snapshot", harnessProfile: "work" })), /does not support a named harness profile/);
});

test("a harness path names layers outermost first and only an outer adapter that wraps that inner path accepts it", () => {
  const alone = { harness: "claude-code" };
  assert.doesNotThrow(() => assertHarnessPath(alone, { wraps: [] }));
  assert.throws(() => assertHarnessPath(alone, { requiresInner: true }), /must name its harnessPath/);
  const wrapper = { wraps: ["claude-code", "codex-cli"] };
  assert.doesNotThrow(() => assertHarnessPath({ harness: "hermes", harnessPath: ["hermes", "claude-code"] }, wrapper));
  assert.throws(() => assertHarnessPath({ harness: "hermes", harnessPath: ["claude-code"] }, wrapper), /outer and an inner/);
  assert.throws(() => assertHarnessPath({ harness: "hermes", harnessPath: ["codex-cli", "claude-code"] }, wrapper), /start with the configuration's harness hermes/);
  assert.throws(() => assertHarnessPath({ harness: "hermes", harnessPath: ["hermes", "nowhere"] }, wrapper), /unknown harness: nowhere/);
  assert.throws(() => assertHarnessPath({ harness: "hermes", harnessPath: ["hermes", "hermes"] }, wrapper), /repeat/);
  assert.throws(() => assertHarnessPath({ harness: "hermes", harnessPath: ["hermes", "cursor-agent"] }, wrapper), /cannot wrap cursor-agent/);
});

test("a harness path is part of the configuration hash only when present", () => {
  const configuration = { provider: "anthropic", model: "claude-opus-5-5", harness: "claude-code", reasoningEffort: "high", serviceTier: "default", personality: "default", capabilities: ["files", "shell"], executionProfile: { id: "p", label: "x" } };
  const alone = computeConfigHash(configuration);
  assert.equal(computeConfigHash({ ...configuration, harnessPath: undefined }), alone, "absent leaves existing hashes alone");
  const wrapped = computeConfigHash({ ...configuration, harness: "t3", harnessPath: ["t3", "claude-code"] });
  assert.notEqual(wrapped, computeConfigHash({ ...configuration, harness: "t3" }));
  assert.notEqual(wrapped, computeConfigHash({ ...configuration, harness: "t3", harnessPath: ["t3", "codex-cli"] }));
});
