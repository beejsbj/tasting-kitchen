import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { extractObservedIdentity, serviceTiersMatch, verifyObservedIdentity } from "../lib/taste/identity.mjs";

const THREAD_ID = "01901234-5678-7abc-8def-0123456789ab";

test("extracts effective identity only from private rollout settings", () => {
  const text = [
    { type: "session_meta", payload: { cli_version: "codex-cli 0.145.0", model_provider: "openai" } },
    { type: "event_msg", payload: { type: "thread_settings_applied", thread_settings: { model: "gpt-5.6-luna", model_provider_id: "openai", reasoning_effort: "xhigh", personality: "none", service_tier: "fast" } } },
    { type: "turn_context", payload: { model: "gpt-5.6-luna", effort: "xhigh", personality: "none", comp_hash: "catalog-3000" } },
  ].map(JSON.stringify).join("\n");
  assert.deepEqual(extractObservedIdentity(text), {
    model: "gpt-5.6-luna",
    provider: "openai",
    reasoningEffort: "xhigh",
    personality: "none",
    serviceTier: "fast",
    compHash: "catalog-3000",
    cliVersion: "codex-cli 0.145.0",
    verifiedBy: "thread_settings_applied",
  });
});

test("service-tier comparison aliases only requested fast to observed priority", () => {
  assert.equal(serviceTiersMatch("fast", "priority"), true);
  assert.equal(serviceTiersMatch("fast", "fast"), false);
  assert.equal(serviceTiersMatch("fast", "default"), false);
  assert.equal(serviceTiersMatch("default", "default"), true);
  assert.equal(serviceTiersMatch("priority", "priority"), true);
  assert.equal(serviceTiersMatch("flex", "flex"), true);
  assert.equal(serviceTiersMatch("priority", "fast"), false);
});

async function verifyFixture(t, { requestedTier, observedTier, observedModel = "gpt-5.6-luna" }) {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "taste-identity-"));
  t.after(() => rm(codexHome, { recursive: true, force: true }));
  const sessions = path.join(codexHome, "sessions");
  await mkdir(sessions);
  await writeFile(path.join(sessions, "rollout.jsonl"), [
    { type: "session_meta", payload: { id: THREAD_ID, cli_version: "0.145.0", model_provider: "openai" } },
    { type: "event_msg", payload: { type: "thread_settings_applied", thread_settings: { model: observedModel, model_provider_id: "openai", reasoning_effort: "low", personality: "none", service_tier: observedTier } } },
  ].map(JSON.stringify).join("\n") + "\n");
  return verifyObservedIdentity({
    codexHome,
    threadId: THREAD_ID,
    cliVersion: "codex-cli 0.145.0",
    variant: { model: "gpt-5.6-luna", provider: "openai", reasoningEffort: "low", personality: "none", serviceTier: requestedTier },
  });
}

test("verified identity preserves requested fast and observed priority separately", async (t) => {
  const identity = await verifyFixture(t, { requestedTier: "fast", observedTier: "priority" });
  assert.equal(identity.requestedServiceTier, "fast");
  assert.equal(identity.observedServiceTier, "priority");
  assert.equal(identity.serviceTier, "priority");
});

test("identity verifier rejects reverse tier alias and unrelated identity drift", async (t) => {
  await assert.rejects(verifyFixture(t, { requestedTier: "priority", observedTier: "fast" }), /tier requested priority, observed fast/);
  await assert.rejects(verifyFixture(t, { requestedTier: "fast", observedTier: "priority", observedModel: "gpt-5.6-sol" }), /model requested gpt-5\.6-luna/);
});
