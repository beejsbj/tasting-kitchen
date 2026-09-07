import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildCursorTurnArgs, parseCursorJsonl, runCursorSession, verifyCursorIdentity } from "../lib/taste/cursor.mjs";

const SESSION_ID = "28d38cf9-c737-4662-a2b6-0b1105f755b6";
const variant = {
  id: "cursor-composer-2-5",
  provider: "cursor",
  model: "composer-2.5[fast=false]",
  harness: "cursor-agent",
  reasoningEffort: "adaptive",
  serviceTier: "default",
  personality: "default",
  executionProfile: { sandbox: "disabled", approvalPolicy: "force" },
};

test("Cursor plans pin Composer 2.5 non-fast and exact session resume", () => {
  const fresh = buildCursorTurnArgs({ variant, workspace: "/tmp/work", prompt: "Cook" });
  assert.deepEqual(fresh.slice(0, 12), ["--print", "--output-format", "stream-json", "--trust", "--force", "--sandbox", "disabled", "--model", "composer-2.5[fast=false]", "--workspace", "/tmp/work", "Cook"]);
  const resumed = buildCursorTurnArgs({ variant, workspace: "/tmp/work", prompt: "Correct", threadId: SESSION_ID });
  assert.equal(resumed[resumed.indexOf("--resume") + 1], SESSION_ID);
  assert.equal(resumed.at(-1), "Correct");
});

test("Cursor JSONL requires matching init and successful result evidence", () => {
  const parsed = parseCursorJsonl([
    JSON.stringify({ type: "system", subtype: "init", session_id: SESSION_ID, model: "Composer 2.5" }),
    JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "Done", session_id: SESSION_ID, usage: { inputTokens: 2, outputTokens: 1 } }),
  ].join("\n"));
  assert.equal(parsed.threadId, SESSION_ID);
  assert.equal(parsed.model, "Composer 2.5");
  assert.equal(parsed.finalMessage, "Done");
  assert.throws(() => parseCursorJsonl(JSON.stringify({ type: "result", subtype: "error", is_error: true, result: "No" })), /failure/);
});

test("Cursor runs fixed turns in one session and verifies observed model identity", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "taste-cursor-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = path.join(root, "workspace");
  const privateDir = path.join(root, "raw");
  const executable = path.join(root, "fake-cursor.mjs");
  const log = path.join(root, "calls.jsonl");
  await mkdir(workspace);
  await writeFile(executable, `#!/usr/bin/env node
import { appendFile } from "node:fs/promises";
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("2026.08.25-fake"); process.exit(0); }
await appendFile(process.env.FAKE_LOG, JSON.stringify(args) + "\\n");
const resume = args.indexOf("--resume");
const session = resume >= 0 ? args[resume + 1] : process.env.FAKE_SESSION;
console.log(JSON.stringify({ type: "system", subtype: "init", session_id: session, model: "Composer 2.5" }));
console.log(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: args.at(-1), session_id: session, usage: { inputTokens: 5, outputTokens: 2 } }));
`, "utf8");
  await chmod(executable, 0o755);
  const recipe = { setup: { instructions: "Set the table." }, turns: [{ id: "make", content: "Cook" }, { id: "correct", content: "Correct" }] };
  const result = await runCursorSession({ variant, recipe, workspace, privateDir, executable, env: { FAKE_LOG: log, FAKE_SESSION: SESSION_ID } });
  assert.equal(result.threadId, SESSION_ID);
  assert.equal(result.observedModel, "Composer 2.5");
  assert.equal(result.turns.length, 2);
  assert.equal(result.turns[0].finalMessage, "Set the table.\n\nCook");
  const calls = (await readFile(log, "utf8")).trim().split("\n").map(JSON.parse);
  assert.equal(calls[0].includes("--resume"), false);
  assert.equal(calls[1][calls[1].indexOf("--resume") + 1], SESSION_ID);
  const observed = await verifyCursorIdentity({ variant, result, cliVersion: result.cliVersion });
  assert.equal(observed.model, "Composer 2.5");
  assert.equal(observed.reasoningEffort, "adaptive");
  assert.equal(observed.serviceTierEvidence, "pinned-fast-false-argv");
});
