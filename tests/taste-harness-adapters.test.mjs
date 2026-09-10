import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { planSelection } from "../lib/taste/catalog.mjs";
import { getHarnessAdapter, resolveHarnessAdapter } from "../lib/taste/harness-adapters.mjs";

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

test("Cursor auth preflight uses noninteractive status and never exposes its output", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "taste-adapter-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const executable = path.join(root, "cursor");
  await writeFile(executable, "#!/bin/sh\n[ \"$1\" = status ] && exit 0\nexit 99\n");
  await chmod(executable, 0o755);
  await getHarnessAdapter("cursor-agent").prepareAttempt({ executable, cwd: root });
  await assert.rejects(getHarnessAdapter("cursor-agent").prepareAttempt({ executable: path.join(root, "missing"), cwd: root }), /authentication preflight/);
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
