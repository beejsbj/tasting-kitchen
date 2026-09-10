import assert from "node:assert/strict";
import test from "node:test";

import { planSelection } from "../lib/taste/catalog.mjs";
import { resolveHarnessAdapter } from "../lib/taste/harness-adapters.mjs";

const profile = { id: "codex-linux-host-unsandboxed-v1", label: "via Codex CLI · host-unsandboxed fallback", runtime: "linux-host", sandbox: "danger-full-access", approvalPolicy: "never", nativeWeb: "disabled", networkPolicy: "not-enforced", filesystemBoundary: "not-a-secrecy-boundary" };
const variant = { id: "codex", provider: "openai", model: "gpt-5.6-sol", harness: "codex-cli", reasoningEffort: "high", serviceTier: "default", personality: "none", capabilities: ["files", "shell"], executionProfile: profile, configHash: "sha256:test" };
const recipe = { id: "r", version: "1.0.0", recipeHash: "sha256:r", status: "ready", harness: { web: "disabled", capabilities: [] } };

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
