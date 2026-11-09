import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { CREDENTIAL_ENV, harnessEnv } from "../lib/taste/child-env.mjs";
import { claudeChildEnv } from "../lib/taste/claude-code.mjs";
import { planCodexTurn } from "../lib/taste/codex.mjs";
import { cursorEnv } from "../lib/taste/cursor.mjs";
import { hermesProcessEnv } from "../lib/taste/hermes.mjs";
import { scrubbedEnv } from "../lib/taste/t3.mjs";

// What a Kitchen started from Burooj's shell (or from a Claude Code or T3 session) may hold.
const AMBIENT = {
  PATH: "/usr/bin:/bin", HOME: "/home/me", LANG: "en_CA.UTF-8", LC_TIME: "en_GB.UTF-8", TMPDIR: "/tmp",
  HTTPS_PROXY: "http://proxy.local:3128", XDG_CONFIG_HOME: "/home/me/.config",
  GH_TOKEN: "gh-secret", GITHUB_TOKEN: "gh-secret", OPENROUTER_API_KEY: "or-secret", ANTHROPIC_API_KEY: "ant-secret", OPENAI_API_KEY: "oa-secret",
  BWS_ACCESS_TOKEN: "bws-secret", AWS_ACCESS_KEY_ID: "aws", AWS_SECRET_ACCESS_KEY: "aws-secret", SSH_AUTH_SOCK: "/run/user/1000/ssh-agent",
  DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus", CLAUDECODE: "1", CLAUDE_CODE_MESSAGING_TOKEN: "session-secret",
  CLAUDE_CONFIG_DIR: "/home/me/.claude", T3CODE_HOME: "/home/me/.t3", T3_BOOT_SERVICE_UNIT: "t3.service", TASTE_ALLOW_MODEL_RUNS: "1",
  // A name nobody has thought of yet: an allowlist keeps it out by default.
  TK_CANARY_FUTURE_SECRET: "future-secret",
};
const NEVER = Object.keys(AMBIENT).filter((key) => !["PATH", "HOME", "LANG", "LC_TIME", "TMPDIR", "HTTPS_PROXY", "XDG_CONFIG_HOME"].includes(key));

/** Run `body` with AMBIENT as the whole process environment, restoring the real one after. */
function withAmbient(body) {
  const saved = { ...process.env };
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, AMBIENT);
  try { return body(); }
  finally {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, saved);
  }
}

function assertNoneLeaked(child, label) {
  // An adapter may set a name itself (CLAUDE_CONFIG_DIR to its own home); the ambient value never arrives.
  for (const key of NEVER) assert.notEqual(child[key], AMBIENT[key], `${label}: ${key} reached the child`);
  for (const value of Object.values(child)) assert.equal(/secret/u.test(value), false, `${label}: a secret value reached the child`);
}

const claudeVariant = (environment) => ({ harness: "claude-code", executionProfile: { environment, ...(environment === "clean" ? {} : { memory: "on", connections: "off" }) } });

test("harnessEnv passes the base names, the locale and what the adapter allows; explicit credential names are scrubbed; set values win", () => {
  const child = harnessEnv({
    base: AMBIENT,
    allow: ["HTTPS_PROXY"],
    env: { FAKE_LOG: "/tmp/log", GH_TOKEN: "explicit-secret", TASTE_CLAUDE_CREDENTIALS_PATH: "/x", TMPDIR: "/cook/tmp" },
    set: { HOME: "/cook/home", LANG: undefined },
  });
  assert.deepEqual(child, { PATH: "/usr/bin:/bin", HOME: "/cook/home", LC_TIME: "en_GB.UTF-8", TMPDIR: "/cook/tmp", HTTPS_PROXY: "http://proxy.local:3128", FAKE_LOG: "/tmp/log" });
  for (const name of ["GH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN", "OPENROUTER_API_KEY", "TASTE_ALLOW_MODEL_RUNS", "SSH_AUTH_SOCK", "T3CODE_HOME", "HERMES_HOME", "CODEX_HOME"]) assert.match(name, CREDENTIAL_ENV);
});

test("no adapter's child inherits an unknown or credential-bearing variable", () => withAmbient(() => {
  const children = {
    "claude-code clean": claudeChildEnv({ variant: claudeVariant("clean"), harnessHome: "/cook/claude-home", env: { TMPDIR: "/cook/tmp" } }),
    "claude-code snapshot": claudeChildEnv({ variant: claudeVariant("snapshot"), harnessHome: "/cook/claude-home" }),
    "codex clean": planCodexTurn({ prompt: "x", model: "gpt-5.6-sol", reasoningEffort: "high", serviceTier: "default", workspace: "/cook/workspace", codexHome: "/cook/codex-home", home: "/cook/home", artifactDir: "/cook/raw" }).env,
    "codex original": planCodexTurn({ prompt: "x", model: "gpt-5.6-sol", reasoningEffort: "high", serviceTier: "default", workspace: "/cook/workspace", codexHome: "/cook/codex-home", artifactDir: "/cook/raw" }).env,
    cursor: cursorEnv({}),
    "t3 → claude-code": scrubbedEnv({}),
    "t3 → codex-cli": scrubbedEnv({}, { userHome: "/cook/codex-user-home" }),
    "hermes anthropic": hermesProcessEnv({ variant: { harness: "hermes", executionProfile: { id: "hermes-linux-host-clean-anthropic-v1", environment: "clean" } }, hermesHome: "/cook/hermes-home" }),
    "hermes openrouter": hermesProcessEnv({ variant: { harness: "hermes", executionProfile: { id: "hermes-linux-host-clean-openrouter-v1", environment: "clean" } }, hermesHome: "/cook/hermes-home", proxy: { token: "tk-proxy-dummy", baseUrl: "http://127.0.0.1:9/api/v1" } }),
  };
  for (const [label, child] of Object.entries(children)) {
    assertNoneLeaked(child, label);
    assert.equal(child.PATH, AMBIENT.PATH, label);
    assert.equal(child.HTTPS_PROXY, AMBIENT.HTTPS_PROXY, `${label} keeps the host's network proxy`);
  }
  // Only what each adapter sets on purpose.
  assert.equal(children["claude-code clean"].CLAUDE_CONFIG_DIR, "/cook/claude-home");
  assert.equal(children["claude-code clean"].TMPDIR, "/cook/tmp", "the runner's scratch directory reaches the harness");
  assert.equal(children["hermes anthropic"].CLAUDE_CONFIG_DIR, "/cook/hermes-home/claude-login");
  assert.equal(children["hermes openrouter"].OPENROUTER_API_KEY, "tk-proxy-dummy");
  assert.match(children["hermes openrouter"].NO_PROXY, /(^|,)127\.0\.0\.1$/u, "the loopback key proxy bypasses the host proxy");
  // A replaced home takes no XDG directory from the real one; a kept home keeps them.
  for (const label of ["codex clean", "t3 → codex-cli"]) assert.equal(children[label].XDG_CONFIG_HOME, undefined, label);
  for (const label of ["codex original", "cursor", "t3 → claude-code"]) assert.equal(children[label].XDG_CONFIG_HOME, AMBIENT.XDG_CONFIG_HOME, label);
  assert.equal(children["codex clean"].HOME, "/cook/home");
  assert.equal(children["t3 → codex-cli"].HOME, "/cook/codex-user-home");
}));

test("live Claude Code runs as he runs claude: his environment, minus a parent Claude session", () => withAmbient(() => {
  const live = claudeChildEnv({ variant: claudeVariant("live") });
  assert.equal(live.GH_TOKEN, "gh-secret", "live keeps his environment, as he runs it");
  for (const key of ["CLAUDECODE", "CLAUDE_CODE_MESSAGING_TOKEN", "CLAUDE_CONFIG_DIR", "ANTHROPIC_API_KEY"]) assert.equal(live[key], undefined, key);
}));

test("acceptance checks run the model's code with the allowlisted environment, not the Kitchen's", async (t) => {
  const { runChecks } = await import("../lib/taste/checks.mjs");
  const { mkdtemp, rm } = await import("node:fs/promises");
  const workspace = await mkdtemp(path.join(os.tmpdir(), "taste-checks-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  process.env.ZZ_UNKNOWN_CANARY = "leak";
  t.after(() => { delete process.env.ZZ_UNKNOWN_CANARY; });
  const script = "const leaked = Object.keys(process.env).filter((key) => /CANARY|GH_TOKEN|OPENROUTER/.test(key)); process.exit(leaked.length ? 1 : 0)";
  const recipe = { validation: { checks: [{ id: "env", type: "command", required: true, argv: [process.execPath, "-e", script] }] } };
  const result = await runChecks(recipe, workspace, { env: { GH_TOKEN: "x", OPENROUTER_API_KEY: "y" } });
  assert.equal(result.passed, true, JSON.stringify(result.checks));
});
