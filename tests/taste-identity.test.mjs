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

test("service-tier comparison aliases only fast to priority and default to standard", () => {
  assert.equal(serviceTiersMatch("fast", "priority"), true);
  assert.equal(serviceTiersMatch("fast", "fast"), false);
  assert.equal(serviceTiersMatch("fast", "default"), false);
  assert.equal(serviceTiersMatch("default", "default"), true);
  assert.equal(serviceTiersMatch("default", "standard"), true);
  assert.equal(serviceTiersMatch("default", "priority"), false);
  assert.equal(serviceTiersMatch("fast", "standard"), false);
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

test("default-tier identity remains explicit when the rollout omits the observed tier", async (t) => {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "taste-identity-"));
  t.after(() => rm(codexHome, { recursive: true, force: true }));
  const sessions = path.join(codexHome, "sessions");
  await mkdir(sessions);
  await writeFile(path.join(sessions, "rollout.jsonl"), [
    { type: "session_meta", payload: { id: THREAD_ID, cli_version: "0.151.0", model_provider: "openai" } },
    { type: "turn_context", payload: { model: "gpt-5.6-luna", effort: "xhigh", personality: "none" } },
  ].map(JSON.stringify).join("\n") + "\n");

  const identity = await verifyObservedIdentity({
    codexHome,
    threadId: THREAD_ID,
    cliVersion: "codex-cli 0.151.0",
    variant: { model: "gpt-5.6-luna", provider: "openai", reasoningEffort: "xhigh", personality: "none", serviceTier: "default" },
  });

  assert.equal(identity.serviceTier, "default");
  assert.equal(identity.requestedServiceTier, "default");
  assert.equal(identity.observedServiceTier, undefined);
  assert.equal(identity.serviceTierEvidence, "requested-default");
});

test("identity verifier rejects reverse tier alias and unrelated identity drift", async (t) => {
  await assert.rejects(verifyFixture(t, { requestedTier: "priority", observedTier: "fast" }), /tier requested priority, observed fast/);
  await assert.rejects(verifyFixture(t, { requestedTier: "fast", observedTier: "priority", observedModel: "gpt-5.6-sol" }), /model requested gpt-5\.6-luna/);
});

// A clean Codex Run proves its own isolation from the context its rollout recorded (#45).
const message = (role, text) => ({ type: "response_item", payload: { type: "message", role, content: [{ type: "input_text", text }] } });
const skillIndex = (roots, entries) => `<skills_instructions>\n## Skills\nA skill is a set of local instructions.\n### Skill roots\n${roots.map((root, index) => `- \`r${index}\` = \`${root}\``).join("\n")}\n### Available skills\n${entries.join("\n")}\n</skills_instructions>`;

async function cleanFixture(t, context, { files = {} } = {}) {
  const cook = await mkdtemp(path.join(os.tmpdir(), "taste-isolation-"));
  t.after(() => rm(cook, { recursive: true, force: true }));
  const codexHome = path.join(cook, "codex-home");
  const workspace = path.join(cook, "workspace");
  await mkdir(path.join(codexHome, "sessions"), { recursive: true });
  await mkdir(workspace, { recursive: true });
  for (const [relative, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(cook, relative)), { recursive: true });
    await writeFile(path.join(cook, relative), text);
  }
  const records = [
    { type: "session_meta", payload: { id: THREAD_ID, cwd: workspace, cli_version: "0.165.0", model_provider: "openai" } },
    ...context({ cook, codexHome, workspace }),
    { type: "turn_context", payload: { cwd: workspace, model: "gpt-5.6-luna", effort: "low", personality: "none" } },
  ];
  await writeFile(path.join(codexHome, "sessions", `rollout-${THREAD_ID}.jsonl`), `${records.map(JSON.stringify).join("\n")}\n`);
  const variant = { model: "gpt-5.6-luna", provider: "openai", reasoningEffort: "low", personality: "none", serviceTier: "default", executionProfile: { environment: "clean" } };
  return { cook, codexHome, workspace, verify: (overrides = {}) => verifyObservedIdentity({ codexHome, threadId: THREAD_ID, cliVersion: "codex-cli 0.165.0", variant: { ...variant, ...overrides } }) };
}

test("a clean Codex rollout that loaded only cook-directory skills records its isolation", async (t) => {
  const f = await cleanFixture(t, ({ codexHome, workspace }) => [
    message("developer", skillIndex([path.join(codexHome, "skills"), path.join(codexHome, "skills/.system")], ["- imagegen: Make images. (file: r1/imagegen/SKILL.md)", `- skill-creator: Make skills. (file: ${path.join(codexHome, "skills/.system/skill-creator/SKILL.md")})`])),
    message("user", `<environment_context>\n  <cwd>${workspace}</cwd>\n</environment_context>`),
  ]);
  const observed = await f.verify();
  assert.deepEqual(observed.isolation, { evidence: "codex-rollout", skills: ["imagegen", "skill-creator"], skillRoots: 2, instructions: 0 });
  assert.equal(JSON.stringify(observed.isolation).includes(f.cook), false, "the record names skills, never paths");
});

test("a clean Codex rollout naming an outside skill root, skill file or AGENTS.md fails verification", async (t) => {
  const outside = "/home/someone/.agents/skills";
  const rootOutside = await cleanFixture(t, ({ codexHome }) => [message("developer", skillIndex([path.join(codexHome, "skills"), outside], ["- cockpit: Coordinate. (file: r1/cockpit/SKILL.md)"]))]);
  await assert.rejects(rootOutside.verify(), /clean Codex run loaded a skill root outside the cook directory/);
  const fileOutside = await cleanFixture(t, () => [message("developer", "<skills_instructions>\n### Available skills\n- tdd: Red, green. (file: /home/someone/.codex/skills/tdd/SKILL.md)\n</skills_instructions>")]);
  await assert.rejects(fileOutside.verify(), /skill tdd from outside the cook directory/);
  const pluginOutside = await cleanFixture(t, ({ codexHome }) => [message("developer", skillIndex([path.join(codexHome, "skills"), "/home/someone/.codex/plugins/cache/work-pets/skills"], ["- work-pets:pets: Pets. (file: r1/pets/SKILL.md)"]))]);
  await assert.rejects(pluginOutside.verify(), /skill root outside/);
  const pluginFileOutside = await cleanFixture(t, () => [message("developer", "- work-pets:pets: Pets. (file: /home/someone/.codex/plugins/pets/SKILL.md)")]);
  await assert.rejects(pluginFileOutside.verify(), /skill work-pets:pets from outside the cook directory/);
  const kitchenAgents = await cleanFixture(t, () => [message("user", "# AGENTS.md instructions for /srv/tasting-kitchen\n\n<INSTRUCTIONS>\n# Tasting Kitchen agent guidance\n</INSTRUCTIONS>")]);
  await assert.rejects(kitchenAgents.verify(), /AGENTS\.md instructions for a directory outside the cook directory/);
  const elsewhere = await cleanFixture(t, ({ workspace }) => [message("user", `<environment_context>\n  <cwd>/home/someone</cwd>\n</environment_context>`), message("user", `<environment_context><cwd>${workspace}</cwd></environment_context>`)]);
  await assert.rejects(elsewhere.verify(), /working directory outside the cook directory/);
  // Inside the cook directory, but nothing there could have supplied it: his global AGENTS.md read from the real home.
  const unaccounted = await cleanFixture(t, ({ workspace }) => [message("user", `# AGENTS.md instructions for ${workspace}\n\n<INSTRUCTIONS>\n# Prime\n</INSTRUCTIONS>`)]);
  await assert.rejects(unaccounted.verify(), /AGENTS\.md instructions no file in the cook directory accounts for/);
  const legacy = await cleanFixture(t, () => [message("user", "<user_instructions>\n# Prime\n</user_instructions>")]);
  await assert.rejects(legacy.verify(), /AGENTS\.md instructions no file in the cook directory accounts for/);
});

test("a clean Codex rollout may carry AGENTS.md instructions a cook-directory file supplies; personal environments are not held to it", async (t) => {
  const mounted = await cleanFixture(t, ({ workspace }) => [message("user", `# AGENTS.md instructions for ${workspace}\n\n<INSTRUCTIONS>\nUse tabs.\n</INSTRUCTIONS>`)], { files: { "workspace/AGENTS.md": "Use tabs.\n" } });
  assert.equal((await mounted.verify()).isolation.instructions, 1);
  const personal = await cleanFixture(t, () => [message("developer", skillIndex(["/home/someone/.agents/skills"], ["- cockpit: Coordinate. (file: r0/cockpit/SKILL.md)"]))]);
  for (const environment of ["snapshot", "live", undefined]) {
    const observed = await personal.verify({ executionProfile: environment ? { environment } : {} });
    assert.equal(observed.isolation, undefined, `${environment ?? "legacy"} records no clean isolation`);
  }
});
